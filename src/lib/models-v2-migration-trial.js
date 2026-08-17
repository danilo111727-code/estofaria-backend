'use strict'

const crypto = require('crypto')
const storeLib = require('./store')
const db = require('./models-v2-db')
const r2 = require('./r2-storage')

const FIXTURE_IMAGE_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

function parseDataUrl(dataUrl) {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) return null
  const match = dataUrl.match(/^data:(image\/(?:jpeg|jpg|png|webp));base64,(.+)$/i)
  if (!match) return null
  try {
    const buffer = Buffer.from(match[2], 'base64')
    if (!buffer.length) return null
    const contentType = match[1].toLowerCase() === 'image/jpg' ? 'image/jpeg' : match[1].toLowerCase()
    return { buffer, contentType }
  } catch (_) {
    return null
  }
}

function legacyImage(model) {
  return parseDataUrl(
    model?.image_data_url || model?.imageDataUrl ||
    model?.foto_data_url || model?.fotoDataUrl ||
    model?.photo_data_url || model?.photoDataUrl ||
    model?.image || model?.foto || model?.photo || ''
  )
}

function stableHash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function cents(value) {
  const n = Number(value || 0)
  return Number.isFinite(n) ? Math.round(n) : 0
}

function num(value) {
  const n = Number(value || 0)
  return Number.isFinite(n) ? n : 0
}

function normalizeMaterial(material = {}) {
  return {
    material_id: String(material.material_id ?? material.materialId ?? material.id ?? ''),
    material_name: String(material.material_name ?? material.materialName ?? material.name ?? material.nome ?? ''),
    unit: String(material.unit ?? material.unidade ?? ''),
    quantity: Number(num(material.quantity ?? material.quantidade ?? material.qtd).toFixed(4)),
    unit_price_cents: cents(material.unit_price_cents ?? material.unitPriceCents ?? material.preco_unitario_cents),
    total_cents: cents(material.total_cents ?? material.totalCents ?? ((num(material.quantity ?? material.quantidade ?? material.qtd)) * cents(material.unit_price_cents ?? material.unitPriceCents ?? material.preco_unitario_cents)))
  }
}

function normalizeMaterials(list) {
  return (Array.isArray(list) ? list : []).map(normalizeMaterial)
}

function sameJson(a, b) {
  return JSON.stringify(a) === JSON.stringify(b)
}

function compareModel(legacy, migrated) {
  const source = db.normalizeModelInput(legacy)
  const failures = []

  const checks = [
    ['name', source.name, migrated?.name],
    ['description', source.description, migrated?.description],
    ['base_meters', Number(source.baseMeters.toFixed(2)), Number(num(migrated?.base_meters).toFixed(2))],
    ['spacing_cm', source.spacingCm, num(migrated?.spacing_cm)],
    ['total_cost_cents', source.totalCostCents, cents(migrated?.total_cost_cents)],
    ['target_profit_cents', source.targetProfitCents, cents(migrated?.target_profit_cents)],
    ['sale_price_cents', source.salePriceCents, cents(migrated?.sale_price_cents)],
    ['value_per_spacing_cents', source.valuePerSpacingCents, cents(migrated?.valor_por_espacamento_cents)]
  ]

  for (const [field, expected, actual] of checks) {
    if (expected !== actual) failures.push(`${field}: esperado=${JSON.stringify(expected)} atual=${JSON.stringify(actual)}`)
  }

  const expectedMaterials = normalizeMaterials(source.materials)
  const actualMaterials = normalizeMaterials(migrated?.materials)
  if (!sameJson(expectedMaterials, actualMaterials)) {
    failures.push(`materials: esperado=${expectedMaterials.length} atual=${actualMaterials.length}`)
  }

  return failures
}

function chooseCompany(store) {
  const models = Array.isArray(store.models) ? store.models : []
  const groups = new Map()
  for (const model of models) {
    const companyId = String(model?.company_id || '').trim()
    const legacyId = String(model?.id ?? '').trim()
    if (!companyId || !legacyId) continue
    const current = groups.get(companyId) || { companyId, models: [], withImages: 0 }
    current.models.push(model)
    if (legacyImage(model)) current.withImages += 1
    groups.set(companyId, current)
  }
  return Array.from(groups.values()).sort((a, b) => {
    if (b.withImages !== a.withImages) return b.withImages - a.withImages
    return b.models.length - a.models.length
  })[0] || null
}

function makeFixture(companyId) {
  return {
    id: `migration-trial-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
    company_id: companyId,
    name: 'Modelo Legado Teste Migração',
    descricao_modelo: 'Registro temporário criado apenas para validar a migração legado → V2.',
    base_meters: 2.4,
    spacing_cm: 10,
    total_cost_cents: 123450,
    target_profit_cents: 45670,
    sale_price_cents: 169120,
    valor_por_espacamento_cents: 7047,
    materials: [
      {
        material_id: 'fixture-espuma-d33',
        material_name: 'Espuma D33 - teste',
        unit: 'placa',
        quantity: 2.5,
        unit_price_cents: 25000,
        total_cents: 62500
      },
      {
        material_id: 'fixture-tecido',
        material_name: 'Tecido - teste',
        unit: 'metro',
        quantity: 8,
        unit_price_cents: 4500,
        total_cents: 36000
      }
    ],
    image_data_url: FIXTURE_IMAGE_DATA_URL,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  }
}

async function persistFixtureIfNeeded(originalStore) {
  const selected = chooseCompany(originalStore)
  if (selected) return { selected, fixture: null }

  const company = (originalStore.companies || []).find(item => String(item?.id || '').trim())
  if (!company) return { selected: null, fixture: null }

  const fixture = makeFixture(String(company.id))
  const nextStore = storeLib.readStore()
  nextStore.models = Array.isArray(nextStore.models) ? nextStore.models : []
  nextStore.models.push(fixture)
  storeLib.writeStore(nextStore)
  if (storeLib._pg?.flushNow) await storeLib._pg.flushNow()

  const persisted = storeLib.readStore()
  const savedFixture = (persisted.models || []).find(item => String(item.id) === fixture.id)
  if (!savedFixture) throw new Error('Não foi possível persistir o modelo legado temporário no backend dev.')

  console.log('[models-v2-migration-trial] Backend dev não tinha modelos legados; criado 1 modelo legado temporário para testar a migração real.')
  return {
    selected: { companyId: String(company.id), models: [savedFixture], withImages: 1 },
    fixture: savedFixture
  }
}

async function cleanupFixture(fixture) {
  if (!fixture) return
  const companyId = String(fixture.company_id)
  const modelId = db.deterministicLegacyId(companyId, String(fixture.id))

  try {
    const imageMeta = await db.getImageMeta(companyId, modelId, 'original')
    if (imageMeta?.object_key && r2.isConfigured()) {
      await r2.deleteObject(imageMeta.object_key).catch(() => {})
    }
  } catch (_) {}

  try {
    const pool = storeLib._pg?.pool
    if (pool) await pool.query('DELETE FROM app_models_v2 WHERE company_id = $1 AND id = $2', [companyId, modelId])
  } catch (_) {}

  const store = storeLib.readStore()
  store.models = (Array.isArray(store.models) ? store.models : []).filter(item => String(item.id) !== String(fixture.id))
  storeLib.writeStore(store)
  if (storeLib._pg?.flushNow) await storeLib._pg.flushNow()
}

async function migrateImage(companyId, modelId, legacyId, legacy) {
  const image = legacyImage(legacy)
  const existing = await db.getImageMeta(companyId, modelId, 'original')

  if (!image) {
    return { sourceHasImage: false, targetHasImage: Boolean(existing), uploaded: false, verified: !existing }
  }
  if (!r2.isConfigured()) throw new Error('R2 não configurado para migrar a foto do modelo.')

  const sha256 = r2.sha256Hex(image.buffer)
  if (existing?.object_key && existing.sha256 === sha256) {
    const head = await r2.headObject(existing.object_key)
    if (head.exists && head.sizeBytes === image.buffer.length) {
      return { sourceHasImage: true, targetHasImage: true, uploaded: false, verified: true }
    }
  }

  const objectKey = r2.buildModelImageKey({ companyId, modelId, variant: 'original', contentType: image.contentType })
  const uploaded = await r2.putObject(objectKey, image.buffer, image.contentType, {
    company_id: companyId,
    model_id: modelId,
    legacy_id: legacyId,
    variant: 'original',
    sha256
  })
  await db.upsertImageMeta(companyId, modelId, 'original', {
    objectKey,
    contentType: image.contentType,
    sizeBytes: uploaded.sizeBytes,
    sha256,
    etag: uploaded.etag
  })

  const head = await r2.headObject(objectKey)
  return {
    sourceHasImage: true,
    targetHasImage: head.exists,
    uploaded: true,
    verified: head.exists && head.sizeBytes === image.buffer.length
  }
}

async function runModelsV2MigrationTrial() {
  const originalStore = storeLib.readStore()
  const originalLegacyHash = stableHash(Array.isArray(originalStore.models) ? originalStore.models : [])
  let fixture = null
  const failures = []

  try {
    const prepared = await persistFixtureIfNeeded(originalStore)
    const selected = prepared.selected
    fixture = prepared.fixture

    if (!selected) {
      console.log('[models-v2-migration-trial] SKIP: nenhuma empresa disponível no backend dev para o teste.')
      return { ok: true, skipped: true, reason: 'no_company' }
    }

    const migrationStore = storeLib.readStore()
    const migrationLegacyHashBefore = stableHash(Array.isArray(migrationStore.models) ? migrationStore.models : [])
    const company = (migrationStore.companies || []).find(item => String(item.id) === selected.companyId)
    console.log(`[models-v2-migration-trial] Empresa selecionada: ${company?.name || 'sem nome'} | modelos=${selected.models.length} | com_foto=${selected.withImages}`)

    let migratedCount = 0
    let uploadedImages = 0

    for (const legacy of selected.models) {
      const legacyId = String(legacy.id)
      const migrated = await db.upsertMigratedModel(selected.companyId, legacyId, legacy)
      migratedCount += 1

      const imageResult = await migrateImage(selected.companyId, migrated.id, legacyId, legacy)
      if (imageResult.uploaded) uploadedImages += 1
      if (!imageResult.verified) failures.push(`${legacyId}: imagem não conferiu entre legado e R2`)

      const reread = await db.getModel(selected.companyId, migrated.id, { includeInactive: true })
      failures.push(...compareModel(legacy, reread).map(message => `${legacyId}: ${message}`))

      if (String(reread?.company_id || '') !== selected.companyId) {
        failures.push(`${legacyId}: company_id divergente após migração`)
      }
    }

    const v2List = await db.listModels(selected.companyId, { includeInactive: true, limit: 200 })
    const selectedLegacyIds = new Set(selected.models.map(model => String(model.id)))
    const migratedLegacyIds = new Set(v2List.items.filter(item => item.legacy_id != null).map(item => String(item.legacy_id)))
    for (const legacyId of selectedLegacyIds) {
      if (!migratedLegacyIds.has(legacyId)) failures.push(`${legacyId}: não encontrado na listagem V2 da empresa`)
    }
    if (v2List.items.some(item => String(item.company_id) !== selected.companyId)) {
      failures.push('listModels retornou registro de outra empresa')
    }

    const afterMigrationStore = storeLib.readStore()
    const migrationLegacyHashAfter = stableHash(Array.isArray(afterMigrationStore.models) ? afterMigrationStore.models : [])
    if (migrationLegacyHashBefore !== migrationLegacyHashAfter) {
      failures.push('store.models legado foi alterado durante a migração experimental')
    }

    if (failures.length) {
      throw new Error(`Migração experimental falhou em ${failures.length} conferência(ões): ${failures.join(' | ')}`)
    }

    console.log(`[models-v2-migration-trial] PASS: ${migratedCount} modelo(s) migrado(s), ${uploadedImages} foto(s) enviada(s), comparação 100% e legado preservado.${fixture ? ' Fixture temporária será removida.' : ''}`)
    return {
      ok: true,
      companyId: selected.companyId,
      migratedCount,
      uploadedImages,
      legacyPreserved: true,
      fixtureUsed: Boolean(fixture)
    }
  } finally {
    if (fixture) {
      await cleanupFixture(fixture)
      const finalStore = storeLib.readStore()
      const finalHash = stableHash(Array.isArray(finalStore.models) ? finalStore.models : [])
      if (finalHash !== originalLegacyHash) {
        console.error('[models-v2-migration-trial] ALERTA: limpeza da fixture não restaurou exatamente store.models original.')
      } else {
        console.log('[models-v2-migration-trial] Limpeza concluída: fixture removida do legado, V2 e R2; estado original restaurado.')
      }
    }
  }
}

module.exports = { runModelsV2MigrationTrial }
