'use strict'

const storeLib = require('../lib/store')
const { repriceModelsByMaterial } = require('../lib/material-repricing')

function isMaterialUpdate(req) {
  const method = String(req.method || '').toUpperCase()
  const path = String(req.path || '')
  return ['PUT', 'PATCH'].includes(method) && /^\/materials\/[^/]+$/.test(path)
}

function cloneRow(row) {
  return row && typeof row === 'object' ? { ...row } : null
}

function restoreMaterialSnapshot(snapshot) {
  if (!snapshot) return
  const store = storeLib.readStore()
  if (!Array.isArray(store.materials)) return
  const index = store.materials.findIndex(item =>
    String(item.company_id) === String(snapshot.company_id)
    && String(item.id) === String(snapshot.id)
  )
  if (index === -1) return
  store.materials[index] = { ...snapshot }
  storeLib.writeStore(store)
}

function materialRepricingAfterSave(req, res, next) {
  if (!isMaterialUpdate(req)) return next()

  const materialId = String(req.params?.id || '').trim()
  const beforeStore = storeLib.readStore()
  const beforeCandidates = (Array.isArray(beforeStore.materials) ? beforeStore.materials : [])
    .filter(item => String(item.id) === materialId)
    .map(cloneRow)

  const originalJson = res.json.bind(res)
  let intercepted = false

  res.json = function materialRepricingJson(payload) {
    if (intercepted || !payload || typeof payload !== 'object' || payload.id == null || payload.company_id == null) {
      return originalJson(payload)
    }

    intercepted = true
    const savedMaterial = { ...payload }
    const snapshot = beforeCandidates.find(item =>
      String(item.company_id) === String(savedMaterial.company_id)
      && String(item.id) === String(savedMaterial.id)
    ) || null

    Promise.resolve()
      .then(() => repriceModelsByMaterial(savedMaterial.company_id, savedMaterial))
      .then(result => {
        if (res.headersSent) return
        return originalJson({
          ...savedMaterial,
          models_v2_repriced: Number(result?.affectedModels || 0),
          models_v2_match: result?.matchMode || 'none'
        })
      })
      .catch(error => {
        console.error('[material-repricing] Falha após salvar material; restaurando valor anterior.', error)
        try {
          restoreMaterialSnapshot(snapshot)
        } catch (rollbackError) {
          console.error('[material-repricing] Falha ao restaurar material após erro de recálculo.', rollbackError)
        }
        if (res.headersSent) return
        res.status(500)
        return originalJson({
          error: 'material_repricing_failed',
          message: 'Não foi possível concluir o reajuste dos modelos. A alteração do material foi desfeita.'
        })
      })

    return res
  }

  return next()
}

module.exports = materialRepricingAfterSave
