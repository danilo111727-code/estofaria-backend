'use strict'

const { requireAuth } = require('./auth')
const { hasPermission } = require('../lib/policies')

const MODEL_READ_PERMISSIONS = ['precificacao', 'catalogo', 'vendedor', 'itens-personalizacao']
const TEMPLATE_PERMISSIONS = ['vendedor', 'precificacao', 'catalogo', 'configuracao']

function isReadMethod(method) {
  return ['GET', 'HEAD'].includes(String(method || '').toUpperCase())
}

function apiPath(req) {
  const original = String(req.originalUrl || req.url || '').split('?')[0]
  let path = original
  if (path === '/api') path = '/'
  else if (path.startsWith('/api/')) path = path.slice(4)
  if (path.length > 1) path = path.replace(/\/+$/, '')
  return path || '/'
}

function requiredPermissionsFor(method, path) {
  const read = isReadMethod(method)

  if (path === '/material-units') return read ? ['material', 'precificacao'] : ['material']

  if (path === '/materials' || path.startsWith('/materials/')) {
    return read ? ['material', 'precificacao'] : ['material']
  }

  if (/^\/models\/[^/]+\/personalization-items(?:\/[^/]+)?$/.test(path)) {
    return read ? MODEL_READ_PERMISSIONS : ['itens-personalizacao']
  }

  if (path === '/models' || /^\/models\/[^/]+$/.test(path)) {
    return read ? MODEL_READ_PERMISSIONS : ['precificacao']
  }

  if (path === '/agenda/orders') return read ? ['agenda', 'painel'] : ['agenda']
  if (path.startsWith('/agenda/')) return ['agenda']

  if (path === '/quotes' || path.startsWith('/quotes/')) return ['vendedor']
  if (path === '/dashboard/summary') return ['painel']
  if (path === '/calendar/holidays') return ['agenda']

  if (path === '/templates' || path.startsWith('/templates/')) return TEMPLATE_PERMISSIONS

  if (path === '/financial/entries' || path.startsWith('/financial/entries/')) return ['financeiro']

  return null
}

function legacyApiPermissions(req, res, next) {
  const permissions = requiredPermissionsFor(req.method, apiPath(req))
  if (!permissions) return next()

  return requireAuth(req, res, () => {
    if (permissions.some(permission => hasPermission(req.user, permission))) return next()
    return res.status(403).json({
      error: 'forbidden',
      message: 'Permissão insuficiente para este módulo.'
    })
  })
}

legacyApiPermissions.requiredPermissionsFor = requiredPermissionsFor
legacyApiPermissions.apiPath = apiPath

module.exports = legacyApiPermissions
