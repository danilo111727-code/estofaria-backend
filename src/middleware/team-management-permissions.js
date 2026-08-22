'use strict'

const storeLib = require('../lib/store')
const { requireAuth } = require('./auth')
const { hasMasterAccess } = require('../lib/policies')

function normalizeList(value){
  if(!value) return []
  if(Array.isArray(value)) return value
  if(typeof value === 'object') return Object.keys(value).filter(key => value[key])
  return String(value).split(/[\s,;|]+/).map(item => item.trim()).filter(Boolean)
}

function normalizeEmail(value){
  return String(value || '').trim().toLowerCase()
}

function looksLikeEmail(value){
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim())
}

function canManageTeam(user){
  if(!user) return false
  if(hasMasterAccess(user)) return true
  if(user.is_owner) return true

  const role = String(user.role || '').trim().toLowerCase()
  if(['owner','admin','administrator','administrador'].includes(role)) return true

  const permissions = [
    ...normalizeList(user.permissions),
    ...normalizeList(user.allowed_modules),
    ...normalizeList(user.app_metadata?.permissions),
    ...normalizeList(user.app_metadata?.modules)
  ].map(item => String(item || '').trim().toLowerCase())

  return ['equipe','team.manage','team_management','equipe.gerenciar'].some(permission => permissions.includes(permission))
}

function companyIdFor(req){
  if(hasMasterAccess(req.user)){
    const explicit = String(req.query?.company_id || '').trim()
    if(explicit) return explicit
  }
  return String(req.user?.company_id || '').trim()
}

function emailConflict(store, companyId, email, currentUserId = ''){
  const normalized = normalizeEmail(email)
  const target = (store.users || []).find(item =>
    normalizeEmail(item.email) === normalized
    && String(item.id) !== String(currentUserId || '')
  )
  if(!target) return null

  const cid = String(companyId || '')
  const targetCompanyId = String(target.company_id || '').trim()
  const memberships = (store.companyUsers || []).filter(item => String(item.user_id) === String(target.id))
  const belongsToAnotherCompany =
    (targetCompanyId && targetCompanyId !== cid)
    || memberships.some(item => String(item.company_id) !== cid)

  return {
    target,
    belongsToAnotherCompany
  }
}

function validateTeamEmail(req, res){
  const method = String(req.method || '').toUpperCase()
  const path = String(req.originalUrl || req.url || '').split('?')[0].replace(/\/+$/, '')
  const isInvite = method === 'POST' && path === '/api/auth/team/invite'
  const editMatch = method === 'PATCH' && path.match(/^\/api\/auth\/team\/users\/([^/]+)$/)
  if(!isInvite && !editMatch) return false

  const email = normalizeEmail(req.body?.email)
  if(!email) return false
  if(!looksLikeEmail(email)){
    res.status(400).json({ error:'invalid_request', message:'Informe um e-mail válido.' })
    return true
  }

  const companyId = companyIdFor(req)
  if(!companyId) return false

  const store = storeLib.readStore()
  const currentUserId = editMatch ? decodeURIComponent(editMatch[1]) : ''
  const conflict = emailConflict(store, companyId, email, currentUserId)
  if(!conflict) return false

  if(conflict.belongsToAnotherCompany){
    res.status(409).json({
      error:'email_belongs_to_another_company',
      message:'Este e-mail já está vinculado a outra empresa e não pode ser adicionado aqui.'
    })
    return true
  }

  if(editMatch){
    res.status(409).json({
      error:'email_already_in_use',
      message:'Este e-mail já está sendo usado por outro acesso desta empresa.'
    })
    return true
  }

  return false
}

function teamManagementPermissions(req, res, next){
  const method = String(req.method || '').toUpperCase()
  if(['GET','HEAD','OPTIONS'].includes(method)) return next()

  return requireAuth(req, res, () => {
    if(!canManageTeam(req.user)){
      return res.status(403).json({
        error:'forbidden',
        message:'Somente o proprietário, um administrador da empresa ou um perfil autorizado pode gerenciar a equipe.'
      })
    }
    if(validateTeamEmail(req, res)) return
    return next()
  })
}

teamManagementPermissions.canManageTeam = canManageTeam
teamManagementPermissions.emailConflict = emailConflict

module.exports = teamManagementPermissions
