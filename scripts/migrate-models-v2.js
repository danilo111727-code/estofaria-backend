'use strict'

const pgStore = require('../src/lib/store-pg')
const db = require('../src/lib/models-v2-db')
const r2 = require('../src/lib/r2-storage')

function parseArgs(argv) {
  const args = new Set(argv.slice(2))
  const companyArg = argv.slice(2).find(arg => arg.startsWith('--company='))
  return {
    apply: args.has('--apply'),
    forceImages: args.has('--force-images'),
    companyId: companyArg ? companyArg.split('=').slice(1).join('=').trim() : ''
  }
}

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

async function main() {
  const options = parseArgs(process.argv)
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL é obrigatória para a migração Models V2.')

  await pgStore.init()
  await db.ensureSchema()
  const store = pgStore.readStore()
  const allModels = Array.isArray(store.models) ? store.models : []
  const models = options.companyId
    ? allModels.filter(model => String(model.company_id || '') === options.companyId)
    : allModels

  const withImages = models.filter(model => parseDataUrl(model.image_data_url || model.imageDataUrl || model.foto_data_url || model.fotoDataUrl))

  console.log('[models-v2] Modo:', options.apply ? 'APLICAR' : 'DRY-RUN')
  console.log('[models-v2] Modelos encontrados:', models.length)
  console.log('[models-v2] Modelos com imagem:', withImages.length)
  if (options.companyId) console.log('[models-v2] Empresa filtrada:', options.companyId)

  if (!options.apply) {
    console.log('[models-v2] Nenhuma alteração feita. Use --apply para executar a migração.')
    return
  }

  if (withImages.length && !r2.isConfigured()) {
    throw new Error('Há modelos com imagem, mas o R2 não está configurado. Configure R2 antes de usar --apply.')
  }

  let migratedModels = 0
  let uploadedImages = 0
  let skippedImages = 0

  for (const legacy of models) {
    const companyId = String(legacy.company_id || '').trim()
    const legacyId = String(legacy.id ?? '').trim()
    if (!companyId || !legacyId) {
      console.warn('[models-v2] Ignorando modelo sem company_id/id:', legacy?.name || legacyId)
      continue
    }

    const model = await db.upsertMigratedModel(companyId, legacyId, legacy)
    migratedModels += 1

    const image = parseDataUrl(legacy.image_data_url || legacy.imageDataUrl || legacy.foto_data_url || legacy.fotoDataUrl)
    if (!image) continue

    const existingImage = await db.getImageMeta(companyId, model.id, 'original')
    if (existingImage && !options.forceImages) {
      skippedImages += 1
      continue
    }

    const objectKey = r2.buildModelImageKey({ companyId, modelId: model.id, variant: 'original', contentType: image.contentType })
    const sha256 = r2.sha256Hex(image.buffer)
    const uploaded = await r2.putObject(objectKey, image.buffer, image.contentType, {
      company_id: companyId,
      model_id: model.id,
      legacy_id: legacyId,
      variant: 'original',
      sha256
    })

    await db.upsertImageMeta(companyId, model.id, 'original', {
      objectKey,
      contentType: image.contentType,
      sizeBytes: uploaded.sizeBytes,
      sha256,
      etag: uploaded.etag
    })
    uploadedImages += 1
  }

  console.log('[models-v2] Concluído.')
  console.log('[models-v2] Modelos migrados/atualizados:', migratedModels)
  console.log('[models-v2] Imagens enviadas:', uploadedImages)
  console.log('[models-v2] Imagens já existentes ignoradas:', skippedImages)
  console.log('[models-v2] O kv_store não foi alterado nem apagado.')
}

main()
  .catch(err => {
    console.error('[models-v2] Falha:', err.message)
    process.exitCode = 1
  })
  .finally(async () => {
    await pgStore.pool.end().catch(() => {})
  })
