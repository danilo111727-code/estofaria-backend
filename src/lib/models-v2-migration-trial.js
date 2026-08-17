'use strict'

const crypto = require('crypto')
const storeLib = require('./store')
const db = require('./models-v2-db')
const r2 = require('./r2-storage')

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
  const beforeStore = storeLib.readStore()
  const selected = chooseCompany(beforeStore)
  if (!selected) {
    console.log('[models-v2-migration-trial] SKIP: nenhum modelo legado com company_id/id no backend dev.')
    return { ok: true, skipped: true, reason: 'no_legacy_models' }
  }

  const allLegacyHashBefore = stableHash(Array.isArray(beforeStore.models) ? beforeStore.models : [])
  const company = (beforeStore.companies || []).find(item => String(item.id) === selected.companyId)
  console.log(`[models-v2-migration-trial] Empresa selecionada: ${company?.name || 'sem nome'} | modelos=${selected.models.length} | com_foto=${selected.withImages}`)

  let migratedCount = 0
  let uploadedImages = 0
  const failures = []

  for (const legacy of selected.models) {
    const legacyId = String(legacy.id)
    const migrated = await db.upsertMigratedModel(selected.companyId, legacyId, legacy)
    migratedCount += 1

    const imageResult = await migrateImage(selected.companyId, migrated.id, legacyId, legacy)
    if (imageResult.uploaded) uploadedImages += 1
    if (!imageResult.verified) {
      failures.push(`${legacyId}: imagem não conferiu entre legado e R2`)
    }

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

  const afterStore = storeLib.readStore()
  const allLegacyHashAfter = stableHash(Array.isArray(afterStore.models) ? afterStore.models : [])
  if (allLegacyHashBefore !== allLegacyHashAfter) {
    failures.push('store.models legado foi alterado durante a migração experimental')
  }

  if (failures.length) {
    console.error('[models-v2-migration-trial] FAIL:', failures.join(' | '))
    const err = new Error(`Migração experimental falhou em ${failures.length} conferência(ões).`)
    err.code = 'models_v2_migration_trial_failed'
    throw err
  }

  console.log(`[models-v2-migration-trial] PASS: ${migratedCount} modelo(s) migrado(s), ${uploadedImages} foto(s) enviada(s), comparação 100% e legado preservado.`)
  return {
    ok: true,
    companyId: selected.companyId,
    migratedCount,
    uploadedImages,
    legacyPreserved: true
  }
}

module.exports = { runModelsV2MigrationTrial }
