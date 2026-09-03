'use strict'

const express = require('express')
const { requireAuth } = require('../middleware/auth')
const { hasMasterAccess, hasPermission } = require('../lib/policies')
const modelsDb = require('../lib/models-v2-db')
const personalizationDb = require('../lib/personalization-v2-db')

const router = express.Router()
router.use(requireAuth)

function canRead(user) {
  return hasMasterAccess(user) || [
    'itens-personalizacao',
    'vendedor',
    'precificacao',
    'catalogo'
  ].some(permission => hasPermission(user, permission))
}

function canWrite(user) {
  return hasMasterAccess(user) || hasPermission(user, 'itens-personalizacao')
}

function requireRead(req, res, next) {
  if (!canRead(req.user)) {
    return res.status(403).json({ error: 'forbidden', message: 'Sem acesso aos itens de personalização.' })
  }
  next()
}

function requireWrite(req, res, next) {
  if (!canWrite(req.user)) {
    return res.status(403).json({ error: 'forbidden', message: 'Sem permissão para alterar itens de personalização.' })
  }
  next()
}

function companyIdFor(req) {
  if (hasMasterAccess(req.user)) {
    return String(req.query?.company_id || req.body?.company_id || req.user?.company_id || '').trim()
  }
  // Usuário comum nunca escolhe a empresa pelo navegador.
  return String(req.user?.company_id || '').trim()
}

function requireCompany(req, res, next) {
  const companyId = companyIdFor(req)
  if (!companyId) {
    return res.status(400).json({ error: 'company_required', message: 'Empresa não identificada.' })
  }
  req.personalizationV2CompanyId = companyId
  next()
}

async function requireModel(req, res, next) {
  try {
    const model = await modelsDb.getModel(req.personalizationV2CompanyId, req.params.id, { includeInactive: false })
    if (!model) {
      return res.status(404).json({ error: 'not_found', message: 'Modelo não encontrado para esta empresa.' })
    }
    req.personalizationV2Model = model
    next()
  } catch (err) {
    next(err)
  }
}

function expectedRevision(body) {
  const raw = body?.revision ?? body?.expected_revision ?? body?.expectedRevision
  if (raw === undefined || raw === null || raw === '') return null
  const n = Number(raw)
  return Number.isInteger(n) && n >= 0 ? n : null
}

function handleWriteError(err, res, next) {
  if (err?.code === 'revision_conflict') {
    return res.status(409).json({
      error: 'revision_conflict',
      message: err.message,
      current_revision: Number(err.currentRevision || 0)
    })
  }
  next(err)
}

router.get('/personalization/config', requireRead, requireCompany, async (req, res, next) => {
  try {
    const data = await personalizationDb.getCatalog(req.personalizationV2CompanyId)
    return res.json(data)
  } catch (err) {
    next(err)
  }
})

router.put('/personalization/config', requireWrite, requireCompany, async (req, res, next) => {
  try {
    const data = await personalizationDb.saveCatalog(
      req.personalizationV2CompanyId,
      req.body || {},
      expectedRevision(req.body)
    )
    return res.json(data)
  } catch (err) {
    return handleWriteError(err, res, next)
  }
})

router.get('/models/:id/personalization-config', requireRead, requireCompany, requireModel, async (req, res, next) => {
  try {
    const data = await personalizationDb.getModelConfig(req.personalizationV2CompanyId, req.params.id)
    return res.json(data)
  } catch (err) {
    next(err)
  }
})

router.put('/models/:id/personalization-config', requireWrite, requireCompany, requireModel, async (req, res, next) => {
  try {
    const data = await personalizationDb.saveModelConfig(
      req.personalizationV2CompanyId,
      req.params.id,
      req.body || {},
      expectedRevision(req.body)
    )
    return res.json(data)
  } catch (err) {
    return handleWriteError(err, res, next)
  }
})

router.get('/models/:id/personalization-items', requireRead, requireCompany, requireModel, async (req, res, next) => {
  try {
    const [catalog, modelConfig] = await Promise.all([
      personalizationDb.getCatalog(req.personalizationV2CompanyId),
      personalizationDb.getModelConfig(req.personalizationV2CompanyId, req.params.id)
    ])

    const items = catalog.items.map(item => {
      const key = String(item.name || '').trim().toLowerCase()
      const consumos = modelConfig.consumos?.[key] || {}
      return {
        ...item,
        model_id: req.params.id,
        consumos,
        values: { padrao: Number(item.price_cents || 0) },
        value_cents: Number(item.price_cents || 0)
      }
    })

    const fabricItems = []
    for (const album of catalog.albums || []) {
      const albumName = String(album?.nome || album?.name || '').trim()
      if (!albumName) continue
      const albumKey = albumName.toLowerCase()
      const albumColumn = (catalog.items || []).find(item =>
        Boolean(item?.isAlbum || item?.is_album) &&
        String(item?.name || '').trim().toLowerCase() === albumKey
      )
      const consumos = modelConfig.consumos?.[albumKey] || {}
      const albumPriceCents = Math.max(0, Math.round(Number(album?.custo || 0) * 100))
      const priceMode = String(album?.price_mode || 'album').toLowerCase() === 'individual'
        ? 'individual'
        : 'album'
      const fabrics = Array.isArray(album?.itens) ? album.itens : []

      if (!fabrics.length) {
        fabricItems.push({
          ...(albumColumn || {}),
          id: `fabric_album_${String(album.id || albumKey)}`,
          name: albumName,
          unit: String(album?.unidade || albumColumn?.unit || 'unidade'),
          price_cents: albumPriceCents,
          value_cents: albumPriceCents,
          category: 'tecido',
          isAlbum: true,
          isFabric: true,
          album_id: String(album?.id || ''),
          album_name: albumName,
          fabric_code: '',
          model_id: req.params.id,
          consumos,
          values: { padrao: albumPriceCents }
        })
        continue
      }

      fabrics.forEach((fabric, index) => {
        const fabricName = String(fabric?.nome || fabric?.name || '').trim()
        const fabricCode = String(fabric?.codigo || fabric?.code || '').trim()
        if (!fabricName && !fabricCode) return
        const individualPrice = Math.max(0, Math.round(Number(
          fabric?.price_cents ?? fabric?.value_cents ?? 0
        )))
        const priceCents = priceMode === 'individual' ? individualPrice : albumPriceCents
        fabricItems.push({
          id: `fabric_${String(album.id || albumKey)}_${index}`,
          name: fabricName || fabricCode,
          unit: String(album?.unidade || albumColumn?.unit || 'unidade'),
          price_cents: priceCents,
          value_cents: priceCents,
          category: 'tecido',
          isAlbum: false,
          isFabric: true,
          album_id: String(album?.id || ''),
          album_name: albumName,
          fabric_code: fabricCode,
          model_id: req.params.id,
          consumos,
          values: { padrao: priceCents }
        })
      })
    }

    return res.json({
      items: [...items, ...fabricItems],
      model_id: req.params.id,
      catalog_revision: catalog.revision,
      model_revision: modelConfig.revision,
      metragens: modelConfig.metragens
    })
  } catch (err) {
    next(err)
  }
})

module.exports = router
