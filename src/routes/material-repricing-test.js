'use strict'

const express = require('express')
const { requireAuth } = require('../middleware/auth')
const { hasMasterAccess, hasPermission } = require('../lib/policies')
const db = require('../lib/models-v2-db')
const r2 = require('../lib/r2-storage')

// O reajuste automático de materiais continua fora do escopo.
// Este router temporário atende somente o upload de imagem do Models V2 no ambiente de teste.
const router = express.Router()
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
const MAX_BYTES = { original: 5 * 1024 * 1024, thumb: 1024 * 1024 }

function canWrite(user) {
  return hasMasterAccess(user) || hasPermission(user, 'precificacao')
}

function companyIdFor(req) {
  if (hasMasterAccess(req.user)) {
    return String(req.query?.company_id || req.user?.company_id || '').trim()
  }
  return String(req.user?.company_id || '').trim()
}

router.post('/v2/models/:id/images/:variant/upload', requireAuth, async (req, res, next) => {
  try {
    if (!canWrite(req.user)) return res.status(403).json({ error:'forbidden', message:'Sem permissão para alterar modelos.' })
    const companyId = companyIdFor(req)
    if (!companyId) return res.status(400).json({ error:'company_required', message:'Empresa não identificada.' })

    const variant = String(req.params.variant || '')
    if (!Object.prototype.hasOwnProperty.call(MAX_BYTES, variant)) {
      return res.status(400).json({ error:'invalid_variant', message:'Variante inválida.' })
    }
    if (!r2.isConfigured()) return res.status(503).json({ error:'r2_not_configured', message:'Armazenamento de imagens ainda não foi configurado.' })

    const model = await db.getModel(companyId, req.params.id, { includeInactive:false })
    if (!model) return res.status(404).json({ error:'not_found', message:'Modelo não encontrado.' })

    const contentType = String(req.headers['content-type'] || '').toLowerCase().split(';')[0].trim()
    if (!IMAGE_TYPES.has(contentType)) return res.status(415).json({ error:'unsupported_image_type', message:'Use JPG, PNG ou WebP.' })

    const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0)
    if (!body.length) return res.status(400).json({ error:'image_required', message:'Imagem não recebida.' })
    if (body.length > MAX_BYTES[variant]) return res.status(413).json({ error:'image_too_large', message:`Imagem acima do limite para ${variant}.` })

    const objectKey = r2.buildModelImageKey({ companyId, modelId:req.params.id, variant, contentType })
    const previous = await db.getImageMeta(companyId, req.params.id, variant)
    const stored = await r2.putObject(objectKey, body, contentType)
    const meta = await db.upsertImageMeta(companyId, req.params.id, variant, {
      objectKey,
      contentType,
      sizeBytes:stored.sizeBytes,
      etag:stored.etag || null
    })

    if (previous?.object_key && previous.object_key !== objectKey) {
      await r2.deleteObject(previous.object_key).catch(() => {})
    }

    return res.status(201).json({
      ...meta,
      url: await r2.presignGetUrl(objectKey, 300)
    })
  } catch (err) {
    next(err)
  }
})

module.exports = router
