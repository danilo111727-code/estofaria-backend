'use strict'

const express = require('express')
const { requireAuth } = require('../middleware/auth')
const { hasMasterAccess, hasPermission } = require('../lib/policies')
const db = require('../lib/models-v2-db')
const r2 = require('../lib/r2-storage')

const router = express.Router()
const IMAGE_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp'])
const MAX_ORIGINAL_BYTES = 5 * 1024 * 1024
const MAX_THUMB_BYTES = 1024 * 1024

router.use(requireAuth)

function modelReadAllowed(user) {
  return hasMasterAccess(user) || ['precificacao', 'catalogo', 'vendedor', 'itens-personalizacao'].some(permission => hasPermission(user, permission))
}

function modelWriteAllowed(user) {
  return hasMasterAccess(user) || hasPermission(user, 'precificacao')
}

function requireModelRead(req, res, next) {
  if (!modelReadAllowed(req.user)) return res.status(403).json({ error: 'forbidden', message: 'Sem acesso aos modelos.' })
  next()
}

function requireModelWrite(req, res, next) {
  if (!modelWriteAllowed(req.user)) return res.status(403).json({ error: 'forbidden', message: 'Sem permissão para alterar modelos.' })
  next()
}

function companyIdFor(req) {
  if (hasMasterAccess(req.user)) {
    return String(req.query?.company_id || req.body?.company_id || req.user?.company_id || '').trim()
  }
  return String(req.user?.company_id || '').trim()
}

function requireCompany(req, res, next) {
  const companyId = companyIdFor(req)
  if (!companyId) return res.status(400).json({ error: 'company_required', message: 'Empresa não identificada.' })
  req.modelsV2CompanyId = companyId
  next()
}

function hasInlineImage(body) {
  if (!body || typeof body !== 'object') return false
  const keys = ['image_data_url', 'imageDataUrl', 'foto_data_url', 'fotoDataUrl', 'photo_data_url', 'photoDataUrl', 'image', 'foto', 'photo']
  return keys.some(key => {
    const value = body[key]
    return typeof value === 'string' && value.trim().startsWith('data:image')
  })
}

function decorateImages(model) {
  if (!model) return model
  const images = model.images || {}
  const decorated = {}
  for (const variant of ['original', 'thumb']) {
    const meta = images[variant]
    if (!meta) continue
    decorated[variant] = {
      ...meta,
      url: r2.isConfigured() ? r2.presignGetUrl(meta.object_key, 300) : null
    }
  }
  const preferred = decorated.thumb || decorated.original || null
  return {
    ...model,
    images: decorated,
    image_url: preferred?.url || null,
    image_variant: preferred?.variant || null,
    image_available: Boolean(preferred)
  }
}

router.get('/models', requireModelRead, requireCompany, async (req, res, next) => {
  try {
    const result = await db.listModels(req.modelsV2CompanyId, {
      limit: req.query.limit,
      offset: req.query.offset,
      includeInactive: String(req.query.include_inactive || '') === '1',
      search: req.query.search || ''
    })
    return res.json({ ...result, items: result.items.map(decorateImages) })
  } catch (err) {
    next(err)
  }
})

router.get('/models/:id', requireModelRead, requireCompany, async (req, res, next) => {
  try {
    const model = await db.getModel(req.modelsV2CompanyId, req.params.id, {
      includeInactive: String(req.query.include_inactive || '') === '1'
    })
    if (!model) return res.status(404).json({ error: 'not_found', message: 'Modelo não encontrado.' })
    return res.json(decorateImages(model))
  } catch (err) {
    next(err)
  }
})

router.post('/models', requireModelWrite, requireCompany, async (req, res, next) => {
  try {
    if (hasInlineImage(req.body)) {
      return res.status(400).json({
        error: 'image_must_be_uploaded_separately',
        message: 'A imagem deve ser enviada pela rota de imagem, não dentro do JSON do modelo.'
      })
    }
    const model = await db.createModel(req.modelsV2CompanyId, req.body || {})
    return res.status(201).json(decorateImages(model))
  } catch (err) {
    if (err?.code === 'invalid_model_name') return res.status(400).json({ error: err.code, message: err.message })
    next(err)
  }
})

router.put('/models/:id', requireModelWrite, requireCompany, async (req, res, next) => {
  try {
    if (hasInlineImage(req.body)) {
      return res.status(400).json({
        error: 'image_must_be_uploaded_separately',
        message: 'A imagem deve ser enviada pela rota de imagem, não dentro do JSON do modelo.'
      })
    }
    const model = await db.updateModel(req.modelsV2CompanyId, req.params.id, req.body || {})
    if (!model) return res.status(404).json({ error: 'not_found', message: 'Modelo não encontrado.' })
    return res.json(decorateImages(model))
  } catch (err) {
    if (err?.code === 'invalid_model_name') return res.status(400).json({ error: err.code, message: err.message })
    next(err)
  }
})

router.patch('/models/:id', requireModelWrite, requireCompany, async (req, res, next) => {
  try {
    if (hasInlineImage(req.body)) {
      return res.status(400).json({
        error: 'image_must_be_uploaded_separately',
        message: 'A imagem deve ser enviada pela rota de imagem, não dentro do JSON do modelo.'
      })
    }
    const model = await db.updateModel(req.modelsV2CompanyId, req.params.id, req.body || {})
    if (!model) return res.status(404).json({ error: 'not_found', message: 'Modelo não encontrado.' })
    return res.json(decorateImages(model))
  } catch (err) {
    if (err?.code === 'invalid_model_name') return res.status(400).json({ error: err.code, message: err.message })
    next(err)
  }
})

router.delete('/models/:id', requireModelWrite, requireCompany, async (req, res, next) => {
  try {
    const ok = await db.deactivateModel(req.modelsV2CompanyId, req.params.id)
    if (!ok) return res.status(404).json({ error: 'not_found', message: 'Modelo não encontrado.' })
    return res.json({ ok: true, soft_deleted: true })
  } catch (err) {
    next(err)
  }
})

function imageLimitFor(variant) {
  return variant === 'thumb' ? MAX_THUMB_BYTES : MAX_ORIGINAL_BYTES
}

function validVariant(value) {
  return value === 'original' || value === 'thumb'
}

router.put(
  '/models/:id/images/:variant',
  requireModelWrite,
  requireCompany,
  express.raw({ type: ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'], limit: `${MAX_ORIGINAL_BYTES}b` }),
  async (req, res, next) => {
    try {
      const variant = String(req.params.variant || '')
      if (!validVariant(variant)) return res.status(400).json({ error: 'invalid_variant', message: 'Variante inválida.' })
      if (!r2.isConfigured()) return res.status(503).json({ error: 'r2_not_configured', message: 'Armazenamento de imagens ainda não foi configurado.' })

      const model = await db.getModel(req.modelsV2CompanyId, req.params.id, { includeInactive: false })
      if (!model) return res.status(404).json({ error: 'not_found', message: 'Modelo não encontrado.' })

      const contentType = String(req.headers['content-type'] || '').toLowerCase().split(';')[0].trim()
      if (!IMAGE_TYPES.has(contentType)) return res.status(415).json({ error: 'unsupported_image_type', message: 'Use JPG, PNG ou WebP.' })
      const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0)
      if (!body.length) return res.status(400).json({ error: 'empty_image', message: 'Imagem vazia.' })
      if (body.length > imageLimitFor(variant)) {
        return res.status(413).json({ error: 'image_too_large', message: `Imagem acima do limite para ${variant}.` })
      }

      const objectKey = r2.buildModelImageKey({
        companyId: req.modelsV2CompanyId,
        modelId: req.params.id,
        variant,
        contentType
      })
      const sha256 = r2.sha256Hex(body)
      const uploaded = await r2.putObject(objectKey, body, contentType, {
        company_id: req.modelsV2CompanyId,
        model_id: req.params.id,
        variant,
        sha256
      })
      const meta = await db.upsertImageMeta(req.modelsV2CompanyId, req.params.id, variant, {
        objectKey,
        contentType,
        sizeBytes: uploaded.sizeBytes,
        sha256,
        etag: uploaded.etag
      })
      return res.status(201).json({
        ...meta,
        url: r2.presignGetUrl(objectKey, 300)
      })
    } catch (err) {
      next(err)
    }
  }
)

router.get('/models/:id/images/:variant/url', requireModelRead, requireCompany, async (req, res, next) => {
  try {
    const variant = String(req.params.variant || '')
    if (!validVariant(variant)) return res.status(400).json({ error: 'invalid_variant', message: 'Variante inválida.' })
    if (!r2.isConfigured()) return res.status(503).json({ error: 'r2_not_configured', message: 'Armazenamento de imagens ainda não foi configurado.' })

    const model = await db.getModel(req.modelsV2CompanyId, req.params.id, { includeInactive: false })
    if (!model) return res.status(404).json({ error: 'not_found', message: 'Modelo não encontrado.' })
    const meta = await db.getImageMeta(req.modelsV2CompanyId, req.params.id, variant)
    if (!meta) return res.status(404).json({ error: 'image_not_found', message: 'Imagem não encontrada.' })
    return res.json({
      variant,
      expires_in: 300,
      url: r2.presignGetUrl(meta.object_key, 300)
    })
  } catch (err) {
    next(err)
  }
})

router.delete('/models/:id/images/:variant', requireModelWrite, requireCompany, async (req, res, next) => {
  try {
    const variant = String(req.params.variant || '')
    if (!validVariant(variant)) return res.status(400).json({ error: 'invalid_variant', message: 'Variante inválida.' })
    const meta = await db.getImageMeta(req.modelsV2CompanyId, req.params.id, variant)
    if (!meta) return res.status(404).json({ error: 'image_not_found', message: 'Imagem não encontrada.' })

    if (r2.isConfigured()) await r2.deleteObject(meta.object_key)
    await db.removeImageMeta(req.modelsV2CompanyId, req.params.id, variant)
    return res.json({ ok: true })
  } catch (err) {
    next(err)
  }
})

module.exports = router
