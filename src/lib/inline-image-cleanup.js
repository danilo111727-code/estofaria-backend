'use strict'

const crypto = require('crypto')

const INLINE_IMAGE_KEYS = [
  'image_data_url', 'imageDataUrl',
  'foto_data_url', 'fotoDataUrl',
  'photo_data_url', 'photoDataUrl',
  'image', 'foto', 'photo'
]

const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])

function text(value) {
  return String(value ?? '').trim()
}

function confirmationFor(companyId, legacyModelId) {
  return `ARCHIVE-INLINE-IMAGE:${text(companyId)}:${text(legacyModelId)}`
}

function parseInlineImage(value) {
  const match = text(value).match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=\r\n]+)$/i)
  if (!match) return null
  const contentType = match[1].toLowerCase()
  if (!ALLOWED_IMAGE_TYPES.has(contentType)) return null
  const body = Buffer.from(match[2].replace(/\s+/g, ''), 'base64')
  if (!body.length) return null
  return { contentType, body, sha256: crypto.createHash('sha256').update(body).digest('hex') }
}

function findInlineImage(model) {
  for (const key of INLINE_IMAGE_KEYS) {
    const parsed = parseInlineImage(model?.[key])
    if (parsed) return { key, ...parsed }
  }
  return null
}

function extensionFor(contentType) {
  if (contentType === 'image/jpeg') return 'jpg'
  if (contentType === 'image/png') return 'png'
  if (contentType === 'image/webp') return 'webp'
  throw new Error('inline_image_content_type_invalid')
}

function archiveKey({ companyId, v2ModelId, sha256, contentType }) {
  return `companies/${text(companyId)}/models/${text(v2ModelId)}/legacy-inline/${sha256}.${extensionFor(contentType)}`
}

function withoutInlineImages(model) {
  const cleaned = { ...model }
  for (const key of INLINE_IMAGE_KEYS) {
    if (parseInlineImage(cleaned[key])) delete cleaned[key]
  }
  return cleaned
}

async function putAndVerifyArchive(r2, key, image, metadata) {
  await r2.putObject(key, image.body, image.contentType, metadata)
  const head = await r2.headObject(key)
  if (!head.exists || Number(head.sizeBytes) !== image.body.length) {
    throw new Error('inline_image_archive_head_mismatch')
  }
  const downloaded = await r2.getObjectBuffer(key)
  const restoredHash = crypto.createHash('sha256').update(downloaded.body).digest('hex')
  if (Number(downloaded.sizeBytes) !== image.body.length || restoredHash !== image.sha256) {
    throw new Error('inline_image_archive_hash_mismatch')
  }
}

async function archiveAndRemoveInlineImage({ companyId, legacyModelId, confirmation, storeLib, r2 }) {
  const cid = text(companyId)
  const legacyId = text(legacyModelId)
  if (text(confirmation) !== confirmationFor(cid, legacyId)) {
    const error = new Error('Confirmação da limpeza de imagem inválida.')
    error.code = 'inline_image_confirmation_invalid'
    throw error
  }
  if (!r2?.isConfigured?.()) throw new Error('inline_image_r2_required')
  const pg = storeLib?._pg
  if (!pg?.pool) throw new Error('postgres_required')

  await pg.flushNow()
  const client = await pg.pool.connect()
  let cleanedStore = null

  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ')
    const storeResult = await client.query("SELECT value FROM kv_store WHERE key = 'main' FOR UPDATE")
    const rawStore = storeResult.rows[0]?.value || storeLib.readStore()
    if (!(rawStore.companies || []).some(company => text(company?.id) === cid)) {
      throw new Error('inline_image_company_not_active')
    }

    const modelIndex = (rawStore.models || []).findIndex(model =>
      text(model?.company_id || model?.companyId) === cid &&
      text(model?.id || model?.model_id || model?.modelId) === legacyId
    )
    if (modelIndex < 0) throw new Error('inline_image_legacy_model_not_found')
    const legacyModel = rawStore.models[modelIndex]
    const image = findInlineImage(legacyModel)
    if (!image) {
      await client.query('ROLLBACK')
      return { alreadyClean: true, companyId: cid, legacyModelId: legacyId }
    }

    const v2Result = await client.query(
      `SELECT id FROM app_models_v2
       WHERE company_id = $1 AND legacy_id = $2
       ORDER BY updated_at DESC LIMIT 1`,
      [cid, legacyId]
    )
    const v2ModelId = text(v2Result.rows[0]?.id)
    if (!v2ModelId) throw new Error('inline_image_v2_model_not_found')

    const currentResult = await client.query(
      `SELECT object_key FROM app_model_images_v2
       WHERE company_id = $1 AND model_id = $2 AND variant = 'original' AND status = 'active'
       LIMIT 1`,
      [cid, v2ModelId]
    )
    const currentObjectKey = text(currentResult.rows[0]?.object_key)
    if (!currentObjectKey) throw new Error('inline_image_current_r2_reference_missing')
    const currentBefore = await r2.getObjectBuffer(currentObjectKey)
    const currentHash = crypto.createHash('sha256').update(currentBefore.body).digest('hex')

    const objectKey = archiveKey({
      companyId: cid,
      v2ModelId,
      sha256: image.sha256,
      contentType: image.contentType
    })
    await putAndVerifyArchive(r2, objectKey, image, {
      company_id: cid,
      model_id: v2ModelId,
      legacy_model_id: legacyId,
      archive_type: 'legacy-inline-image',
      sha256: image.sha256
    })

    const currentAfter = await r2.getObjectBuffer(currentObjectKey)
    const currentHashAfter = crypto.createHash('sha256').update(currentAfter.body).digest('hex')
    if (currentHashAfter !== currentHash) throw new Error('inline_image_current_r2_object_changed')

    cleanedStore = structuredClone(rawStore)
    cleanedStore.models[modelIndex] = withoutInlineImages(cleanedStore.models[modelIndex])
    if (findInlineImage(cleanedStore.models[modelIndex])) throw new Error('inline_image_cleanup_verify_memory')
    await client.query(
      `UPDATE kv_store SET value = $1::jsonb, updated_at = NOW() WHERE key = 'main'`,
      [JSON.stringify(cleanedStore)]
    )
    const verifyResult = await client.query("SELECT value FROM kv_store WHERE key = 'main'")
    const verifyModel = (verifyResult.rows[0]?.value?.models || []).find(model =>
      text(model?.company_id || model?.companyId) === cid &&
      text(model?.id || model?.model_id || model?.modelId) === legacyId
    )
    if (!verifyModel || findInlineImage(verifyModel)) throw new Error('inline_image_cleanup_verify_database')
    await client.query('COMMIT')

    storeLib.writeStore(cleanedStore)
    await pg.flushNow()
    return {
      alreadyClean: false,
      companyId: cid,
      legacyModelId: legacyId,
      v2ModelId,
      archived: { objectKey, sha256: image.sha256, sizeBytes: image.body.length },
      currentR2Preserved: { objectKey: currentObjectKey, sha256: currentHash }
    }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    client.release()
  }
}

async function runControlledInlineImageCleanup({ storeLib, r2, env = process.env }) {
  const companyId = text(env.INLINE_IMAGE_CLEANUP_COMPANY_ID)
  if (!companyId) return null
  const result = await archiveAndRemoveInlineImage({
    companyId,
    legacyModelId: env.INLINE_IMAGE_CLEANUP_LEGACY_MODEL_ID,
    confirmation: env.INLINE_IMAGE_CLEANUP_CONFIRM,
    storeLib,
    r2
  })
  console.log('[inline-image-cleanup] Resultado:', JSON.stringify(result))
  return result
}

module.exports = {
  INLINE_IMAGE_KEYS,
  confirmationFor,
  parseInlineImage,
  findInlineImage,
  withoutInlineImages,
  archiveAndRemoveInlineImage,
  runControlledInlineImageCleanup
}
