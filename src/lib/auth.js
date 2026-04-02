const jwt = require('jsonwebtoken')

const JWT_SECRET = process.env.JWT_SECRET || 'troque-este-segredo-em-producao'
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '12h'

function normalizeArray(value){
  if(!value) return []
  if(Array.isArray(value)) return value.filter(Boolean)
  if(typeof value === 'object') return Object.keys(value).filter(key => value[key])
  return String(value).split(/[\s,;|]+/).map(item => item.trim()).filter(Boolean)
}

function sanitizeUser(user){
  if(!user) return null
  const companyName = user.empresa || user.empresa_nome || user.company_name || user.business_name || user.companyName || (user.company && user.company.name) || ''
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    company_id: user.company_id || null,
    empresa: companyName || '',
    company_name: companyName || '',
    business_name: companyName || '',
    company: companyName ? { ...(typeof user.company === 'object' ? user.company : {}), name: companyName } : (user.company || null),
    role: user.role || 'user',
    is_master: Boolean(user.is_master),
    is_superadmin: Boolean(user.is_superadmin),
    master_access: Boolean(user.master_access),
    saas_admin: Boolean(user.saas_admin),
    is_admin: Boolean(user.is_admin),
    is_owner: Boolean(user.is_owner),
    full_access: Boolean(user.full_access),
    all_access: Boolean(user.all_access),
    permissions: normalizeArray(user.permissions),
    allowed_modules: normalizeArray(user.allowed_modules),
    app_metadata: user.app_metadata || {
      is_master: Boolean(user.is_master),
      is_superadmin: Boolean(user.is_superadmin),
      saas_admin: Boolean(user.saas_admin),
      permissions: normalizeArray(user.permissions),
      modules: normalizeArray(user.allowed_modules)
    }
  }
}

function issueToken(user){
  const payload = sanitizeUser(user)
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN })
}

function decodeToken(token){
  return jwt.verify(token, JWT_SECRET)
}

module.exports = {
  sanitizeUser,
  issueToken,
  decodeToken,
  normalizeArray
}
