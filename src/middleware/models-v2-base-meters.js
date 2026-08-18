'use strict'

function number(value, fallback = 0) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function normalizeBaseMeters(value) {
  const n = Math.max(0, number(value, 0))
  if (!(n > 0)) return 0
  return n > 10 ? Number((n / 100).toFixed(2)) : Number(n.toFixed(2))
}

function normalizeModelsV2BaseMeters(req, _res, next) {
  const method = String(req.method || 'GET').toUpperCase()
  if (!['POST', 'PUT', 'PATCH'].includes(method) || !req.body || typeof req.body !== 'object') {
    return next()
  }

  const raw = req.body.base_meters ?? req.body.baseMeters ?? req.body.metragem_base
  if (raw === undefined || raw === null || raw === '') return next()

  const normalized = normalizeBaseMeters(raw)
  if (normalized > 0) {
    req.body.base_meters = normalized
    if ('baseMeters' in req.body) req.body.baseMeters = normalized
    if ('metragem_base' in req.body) req.body.metragem_base = normalized
  }

  next()
}

module.exports = normalizeModelsV2BaseMeters
module.exports.normalizeBaseMeters = normalizeBaseMeters
