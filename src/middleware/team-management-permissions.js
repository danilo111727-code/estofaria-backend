'use strict'

const { requireAuth } = require('./auth')
const { hasMasterAccess } = require('../lib/policies')

function normalizeList(value){
  if(!value) return []
  if(Array.isArray(value)) return value
  if(typeof value === 'object') return Object.keys(value).filter(key => value[key])
  return String(value).split(/[\s,;|]+/).map(item => item.trim()).filter(Boolean)
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

function teamManagementPermissions(req, res, next){
  const method = String(req.method || '').toUpperCase()
  if(['GET','HEAD','OPTIONS'].includes(method)) return next()

  return requireAuth(req, res, () => {
    if(canManageTeam(req.user)) return next()
    return res.status(403).json({
      error:'forbidden',
      message:'Somente o proprietário, um administrador da empresa ou um perfil autorizado pode gerenciar a equipe.'
    })
  })
}

teamManagementPermissions.canManageTeam = canManageTeam

module.exports = teamManagementPermissions
