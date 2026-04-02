const { readStore } = require('../lib/store')
const { decodeToken, sanitizeUser } = require('../lib/auth')
const { hasMasterAccess, hasPermission } = require('../lib/policies')

function enrichUserWithCompany(store, user){
  const company = store.companies.find(item => String(item.id) === String(user.company_id || '')) || null
  if(!company) return user
  return {
    ...user,
    empresa: user.empresa || company.name || '',
    company_name: user.company_name || company.name || '',
    business_name: user.business_name || company.name || '',
    company: typeof user.company === 'object'
      ? { ...(user.company || {}), id: company.id, name: user.company?.name || company.name || '' }
      : { id: company.id, name: company.name || '' }
  }
}

function getBearerToken(req){
  const header = req.headers.authorization || ''
  const match = header.match(/^Bearer\s+(.+)$/i)
  return match ? match[1] : ''
}

function requireAuth(req, res, next){
  try {
    const token = getBearerToken(req)
    if(!token) return res.status(401).json({ error:'unauthorized', message:'Token ausente.' })
    const payload = decodeToken(token)
    const store = readStore()
    const user = store.users.find(item => String(item.id) === String(payload.id) && item.is_active !== false)
    if(!user) return res.status(401).json({ error:'unauthorized', message:'Sessão inválida.' })
    req.user = sanitizeUser(enrichUserWithCompany(store, user))
    req.store = store
    next()
  } catch (_) {
    return res.status(401).json({ error:'unauthorized', message:'Token inválido ou expirado.' })
  }
}

function optionalAuth(req, _res, next){
  try {
    const token = getBearerToken(req)
    if(!token) return next()
    const payload = decodeToken(token)
    const store = readStore()
    const user = store.users.find(item => String(item.id) === String(payload.id) && item.is_active !== false)
    if(user) req.user = sanitizeUser(enrichUserWithCompany(store, user))
  } catch (_) {}
  next()
}

function requireMaster(req, res, next){
  if(!hasMasterAccess(req.user)) return res.status(403).json({ error:'forbidden', message:'Acesso Master obrigatório.' })
  next()
}

function requirePermission(permission){
  return function(req, res, next){
    if(!hasPermission(req.user, permission)) return res.status(403).json({ error:'forbidden', message:'Permissão insuficiente.' })
    next()
  }
}

module.exports = {
  requireAuth,
  optionalAuth,
  requireMaster,
  requirePermission
}
