const storeLib = require('../lib/store')
const { decodeToken, sanitizeUser } = require('../lib/auth')
const { hasMasterAccess, hasPermission } = require('../lib/policies')

const SUBSCRIPTION_EXEMPT_PATHS = ['/billing', '/subscription', '/assinatura', '/me', '/logout', '/team']

function readAuthStore(){
  try {
    const pg = storeLib && storeLib._pg
    if(pg && typeof pg.readAuthStore === 'function') return pg.readAuthStore()
  } catch (_) {}
  return storeLib.readStore()
}

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

function isSubscriptionExempt(req){
  const path = req.path || ''
  return SUBSCRIPTION_EXEMPT_PATHS.some(p => path.startsWith(p))
}

function hasInactiveMembership(store, user){
  if(!user || !user.company_id) return false
  const membership = store.companyUsers.find(item =>
    String(item.user_id) === String(user.id)
    && String(item.company_id) === String(user.company_id)
  )
  return Boolean(membership && String(membership.status || '').toLowerCase() === 'inactive')
}

function stripForeignCompanySelectors(req, user){
  if(hasMasterAccess(user)) return

  if(req.query && typeof req.query === 'object'){
    delete req.query.company_id
    delete req.query.companyId
  }

  if(req.body && typeof req.body === 'object' && !Array.isArray(req.body)){
    delete req.body.company_id
    delete req.body.companyId
  }
}

function requireAuth(req, res, next){
  const token = getBearerToken(req)
  if(!token) return res.status(401).json({ error:'unauthorized', message:'Token ausente.' })

  let payload
  try {
    payload = decodeToken(token)
  } catch (_) {
    return res.status(401).json({ error:'unauthorized', message:'Token inválido ou expirado.' })
  }

  let store
  try {
    store = readAuthStore()
  } catch (error) {
    console.error('[auth] Falha temporária ao carregar dados da sessão:', error && error.message ? error.message : error)
    return res.status(503).json({
      error:'auth_temporarily_unavailable',
      message:'Não foi possível validar sua sessão agora. Tente novamente em instantes.'
    })
  }

  try {
    const user = store.users.find(item => String(item.id) === String(payload.id) && item.is_active !== false)
    if(!user) return res.status(401).json({ error:'unauthorized', message:'Sessão inválida.' })
    if(!hasMasterAccess(user) && hasInactiveMembership(store, user)){
      return res.status(401).json({ error:'access_cancelled', message:'Seu acesso foi cancelado pelo administrador da empresa.' })
    }
    req.user = sanitizeUser(enrichUserWithCompany(store, user))

    // Isolamento multiempresa: usuários comuns nunca podem selecionar outra
    // empresa enviando company_id/companyId manualmente na requisição.
    // O contexto da empresa deve vir exclusivamente do usuário autenticado.
    stripForeignCompanySelectors(req, req.user)

    if(!hasMasterAccess(req.user) && !isSubscriptionExempt(req)){
      const company = store.companies.find(item => String(item.id) === String(user.company_id || ''))
      const HARD_BLOCKED = ['blocked','suspended','disabled']
      if(company && HARD_BLOCKED.includes(company.access_status)){
        return res.status(402).json({
          error:'subscription_required',
          message:'Sua assinatura está inativa. Acesse a tela de Assinatura para regularizar.',
          access_status: company.access_status,
          financial_status: company.financial_status,
          redirect: '/assinatura/'
        })
      }
    }

    next()
  } catch (error) {
    console.error('[auth] Falha temporária durante validação da sessão:', error && error.message ? error.message : error)
    return res.status(503).json({
      error:'auth_temporarily_unavailable',
      message:'Não foi possível validar sua sessão agora. Tente novamente em instantes.'
    })
  }
}

function optionalAuth(req, _res, next){
  try {
    const token = getBearerToken(req)
    if(!token) return next()
    const payload = decodeToken(token)
    const store = readAuthStore()
    const user = store.users.find(item => String(item.id) === String(payload.id) && item.is_active !== false)
    if(user && (hasMasterAccess(user) || !hasInactiveMembership(store, user))){
      req.user = sanitizeUser(enrichUserWithCompany(store, user))
      stripForeignCompanySelectors(req, req.user)
    }
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

module.exports = { requireAuth, optionalAuth, requireMaster, requirePermission }
