const { normalizeArray } = require('./auth')

function hasMasterAccess(user){
  if(!user) return false
  if(user.is_superadmin || user.is_master || user.master_access || user.saas_admin) return true
  const role = String(user.role || '').toLowerCase()
  if(['platform_admin','superadmin','saas_admin'].includes(role)) return true
  const permissions = normalizeArray(user.permissions)
  return permissions.includes('master') || permissions.some(item => item.startsWith('saas.'))
}

function hasPermission(user, permission){
  if(hasMasterAccess(user)) return true
  const permissions = normalizeArray(user.permissions)
  return permissions.includes(permission)
}

module.exports = {
  hasMasterAccess,
  hasPermission
}
