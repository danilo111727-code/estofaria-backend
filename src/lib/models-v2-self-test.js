'use strict'

const crypto = require('crypto')
const db = require('./models-v2-db')
const r2 = require('./r2-storage')
const storeLib = require('./store')

const TEST_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
)

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function runModelsV2SelfTest() {
  const token = crypto.randomBytes(6).toString('hex')
  const companyA = `selftest-a-${token}`
  const companyB = `selftest-b-${token}`
  const objectKeys = []
  let modelA = null
  let modelB = null

  console.log('[models-v2-selftest] Iniciando teste de CRUD, foto e isolamento...')

  try {
    modelA = await db.createModel(companyA, {
      name: 'Modelo Teste A',
      description: 'Criado automaticamente para validação do Models V2.',
      base_meters: 2.4,
      spacing_cm: 10,
      total_cost_cents: 25000,
      target_profit_cents: 15000,
      sale_price_cents: 40000,
      value_per_spacing_cents: 1800,
      materials: [
        {
          material_id: 'mat-selftest',
          material_name: 'Espuma Teste',
          unit: 'placa',
          quantity: 2,
          unit_price_cents: 5000,
          total_cents: 10000
        }
      ]
    })

    modelB = await db.createModel(companyB, {
      name: 'Modelo Teste B',
      base_meters: 1.8,
      sale_price_cents: 30000,
      materials: []
    })

    assert(modelA && modelA.company_id === companyA, 'Modelo A não foi criado na empresa A.')
    assert(modelB && modelB.company_id === companyB, 'Modelo B não foi criado na empresa B.')
    assert(modelA.materials.length === 1, 'Material do Modelo A não foi persistido.')

    const listA = await db.listModels(companyA)
    const listB = await db.listModels(companyB)
    assert(listA.items.some(item => item.id === modelA.id), 'Empresa A não enxerga o próprio modelo.')
    assert(!listA.items.some(item => item.id === modelB.id), 'Empresa A enxergou modelo da empresa B.')
    assert(listB.items.some(item => item.id === modelB.id), 'Empresa B não enxerga o próprio modelo.')
    assert(!listB.items.some(item => item.id === modelA.id), 'Empresa B enxergou modelo da empresa A.')

    const foreignReadA = await db.getModel(companyB, modelA.id)
    const foreignReadB = await db.getModel(companyA, modelB.id)
    assert(foreignReadA === null, 'Empresa B conseguiu ler diretamente o modelo da empresa A.')
    assert(foreignReadB === null, 'Empresa A conseguiu ler diretamente o modelo da empresa B.')

    const objectKey = r2.buildModelImageKey({
      companyId: companyA,
      modelId: modelA.id,
      variant: 'original',
      contentType: 'image/png'
    })
    objectKeys.push(objectKey)

    const uploaded = await r2.putObject(objectKey, TEST_PNG, 'image/png', {
      purpose: 'models-v2-selftest'
    })
    assert(uploaded.sizeBytes === TEST_PNG.length, 'Upload da foto retornou tamanho inesperado.')

    await db.upsertImageMeta(companyA, modelA.id, 'original', {
      objectKey,
      contentType: 'image/png',
      sizeBytes: TEST_PNG.length,
      sha256: r2.sha256Hex(TEST_PNG),
      etag: uploaded.etag || null
    })

    const loadedWithImage = await db.getModel(companyA, modelA.id)
    assert(loadedWithImage?.images?.original?.object_key === objectKey, 'Metadados da foto não foram vinculados ao modelo.')
    assert(await db.getImageMeta(companyB, modelA.id, 'original') === null, 'Empresa B conseguiu acessar metadados da foto da empresa A.')

    const signedUrl = await r2.presignGetUrl(objectKey, 60)
    const response = await fetch(signedUrl)
    assert(response.ok, `Leitura da foto assinada falhou com HTTP ${response.status}.`)
    const downloaded = Buffer.from(await response.arrayBuffer())
    assert(downloaded.equals(TEST_PNG), 'Foto lida do R2 não corresponde ao arquivo enviado.')

    const edited = await db.updateModel(companyA, modelA.id, {
      name: 'Modelo Teste A Editado',
      sale_price_cents: 45500,
      materials: [
        {
          material_id: 'mat-selftest',
          material_name: 'Espuma Teste Editada',
          unit: 'placa',
          quantity: 3,
          unit_price_cents: 5000,
          total_cents: 15000
        }
      ]
    })
    assert(edited?.name === 'Modelo Teste A Editado', 'Edição do nome não persistiu.')
    assert(Number(edited?.sale_price_cents) === 45500, 'Edição do valor não persistiu.')
    assert(edited?.materials?.[0]?.material_name === 'Espuma Teste Editada', 'Edição dos materiais não persistiu.')

    const deactivated = await db.deactivateModel(companyA, modelA.id)
    assert(deactivated, 'Exclusão lógica do modelo falhou.')
    assert(await db.getModel(companyA, modelA.id) === null, 'Modelo excluído continua aparecendo como ativo.')
    const inactive = await db.getModel(companyA, modelA.id, { includeInactive: true })
    assert(inactive && inactive.active === false, 'Modelo excluído não ficou disponível como inativo para auditoria.')

    console.log('[models-v2-selftest] PASS: criar, reler, foto R2, editar, excluir e isolamento entre empresas funcionando.')
    return { ok: true }
  } finally {
    for (const key of objectKeys) {
      await r2.deleteObject(key).catch(err => {
        console.warn('[models-v2-selftest] Falha ao limpar objeto temporário do R2:', err.message)
      })
    }

    const pool = storeLib?._pg?.pool
    if (pool) {
      await pool.query(
        'DELETE FROM app_models_v2 WHERE company_id = ANY($1::text[])',
        [[companyA, companyB]]
      ).catch(err => {
        console.warn('[models-v2-selftest] Falha ao limpar dados temporários do banco:', err.message)
      })
    }
  }
}

module.exports = { runModelsV2SelfTest }
