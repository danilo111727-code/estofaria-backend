const express = require('express')
const bcrypt = require('bcryptjs')
const crypto = require('crypto')
const { v4: uuidv4 } = require('uuid')
const { readStore, writeStore, planPreset, findUserByEmail, nowIso, activeMembershipCount, upsertAudit } = require('../lib/store')
const { issueToken, sanitizeUser, normalizeArray } = require('../lib/auth')
const { requireAuth } = require('../middleware/auth')
const { hasMasterAccess } = require('../lib/policies')
const { sendEmail, welcomeEmail, passwordResetEmail } = require('../lib/email')

const router = express.Router()
const BUSINESS_MODULES = ['painel','vendedor','agenda','material','precificacao','catalogo','itens-personalizacao','assinatura','financeiro','configuracao']
const RATE_LIMIT_BUCKETS = new Map()

function normalizeText(value, max = 160){
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max)
}

function looksLikeEmail(value){
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim())
}

function sanitizeModules(value){
  const selected = normalizeArray(value)
    .map(item => String(item || '').trim().toLowerCase())
    .filter(item => BUSINESS_MODULES.includes(item))
  return Array.from(new Set(selected))
}

function takeRateLimit(key, limit, windowMs){
  const now = Date.now()
  const bucket = RATE_LIMIT_BUCKETS.get(key) || []
  const valid = bucket.filter(ts => now - ts < windowMs)
  if(valid.length >= limit){
    RATE_LIMIT_BUCKETS.set(key, valid)
    return false
  }
  valid.push(now)
  RATE_LIMIT_BUCKETS.set(key, valid)
  return true
}

function normalizeEmail(value){
  return String(value || '').trim().toLowerCase()
}

function buildTeamPassword(){
  const groups = [
    'ABCDEFGHJKLMNPQRSTUVWXYZ',
    'abcdefghijkmnopqrstuvwxyz',
    '23456789',
    '!@#$%&*'
  ]
  const all = groups.join('')
  const chars = groups.map(group => group[crypto.randomInt(0, group.length)])
  while(chars.length < 12){
    chars.push(all[crypto.randomInt(0, all.length)])
  }
  for(let i = chars.length - 1; i > 0; i -= 1){
    const j = crypto.randomInt(0, i + 1)
    ;[chars[i], chars[j]] = [chars[j], chars[i]]
  }
  return chars.join('')
}

function getUserMembership(store, user){
  if(!user || !user.company_id) return null
  return store.companyUsers.find(item =>
    String(item.user_id) === String(user.id)
    && String(item.company_id) === String(user.company_id)
  ) || null
}

function genericResetResponse(extra = {}){
  return {
    ok:true,
    message:'Se este e-mail estiver cadastrado, enviaremos as instruções para redefinir a senha.',
    ...extra
  }
}

function buildResetToken(){
  return crypto.randomBytes(24).toString('hex')
}

function hashResetToken(token){
  return crypto.createHash('sha256').update(String(token || '')).digest('hex')
}

function getResetTtlMinutes(){
  return Math.max(5, Number(process.env.RESET_TOKEN_TTL_MINUTES || 30))
}

function exposeResetToken(){
  return String(process.env.EXPOSE_RESET_TOKEN_IN_RESPONSE || '').toLowerCase() === 'true'
}

function enrichUserForResponse(store, user){
  if(!user) return user
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

function getCompanyContext(req, store){
  if(hasMasterAccess(req.user) && req.query.company_id){
    return store.companies.find(item => String(item.id) === String(req.query.company_id)) || null
  }
  return store.companies.find(item => String(item.id) === String(req.user.company_id || '')) || null
}

function teamPayload(store, company){
  if(!company) return { company:null, subscription:null, users:[] }
  const users = store.companyUsers
    .filter(item => String(item.company_id) === String(company.id))
    .map(link => {
      const user = store.users.find(item => String(item.id) === String(link.user_id)) || {}
      return {
        id: user.id || link.user_id,
        name: user.name || 'Usuário',
        email: user.email || '-',
        role: link.role || 'custom',
        status: link.status || 'pending',
        modules: Array.isArray(link.modules) ? link.modules : [],
        last_login_at: link.last_login_at || '',
        invited_at: link.invited_at || '',
        is_owner: Boolean(link.is_owner)
      }
    })
  return {
    company: { id: company.id, name: company.name },
    subscription: {
      plan_code: company.plan_code,
      plan_name: company.plan_name,
      seats_limit: company.seats_limit,
      seats_used: activeMembershipCount(store, company.id)
    },
    users
  }
}

router.post('/login', (req, res) => {
  const email = normalizeEmail(req.body?.email)
  const password = String(req.body?.password || '')
  if(!email || !password) return res.status(400).json({ error:'invalid_request', message:'Informe e-mail e senha.' })
  const rateKey = `login:${req.ip}:${email}`
  if(!takeRateLimit(rateKey, 12, 15 * 60 * 1000)){
    return res.status(429).json({ error:'rate_limited', message:'Muitas tentativas. Aguarde alguns minutos e tente novamente.' })
  }

  const store = readStore()
  const user = findUserByEmail(store, email)
  if(!user || user.is_active === false) return res.status(401).json({ error:'unauthorized', message:'E-mail ou senha inválidos.' })
  const membership = getUserMembership(store, user)
  if(membership && String(membership.status || '').toLowerCase() === 'inactive'){
    return res.status(403).json({ error:'access_cancelled', message:'Seu acesso foi cancelado pelo administrador da empresa.' })
  }
  if(!bcrypt.compareSync(password, String(user.password_hash || ''))) return res.status(401).json({ error:'unauthorized', message:'E-mail ou senha inválidos.' })
  if(membership){
    membership.status = 'active'
    membership.last_login_at = nowIso()
  }
  const token = issueToken(user)
  user.updated_at = nowIso()
  writeStore(store)
  res.json({ token, user: sanitizeUser(enrichUserForResponse(store, user)) })
})

router.post('/register', (req, res) => {
  const empresa = normalizeText(req.body?.empresa, 120)
  const nome = normalizeText(req.body?.nome, 120)
  const password = String(req.body?.password || '')
  const email = normalizeEmail(req.body?.email)
  if(!takeRateLimit(`register:${req.ip}`, 10, 60 * 60 * 1000)){
    return res.status(429).json({ error:'rate_limited', message:'Muitas tentativas de cadastro. Aguarde um pouco para continuar.' })
  }
  if(!empresa || !nome || !email || !password) return res.status(400).json({ error:'invalid_request', message:'Campos obrigatórios ausentes.' })
  if(!looksLikeEmail(email)) return res.status(400).json({ error:'invalid_request', message:'Informe um e-mail válido.' })
  if(String(password).length < 6) return res.status(400).json({ error:'invalid_request', message:'A senha deve ter pelo menos 6 caracteres.' })
  if(String(password).length > 72) return res.status(400).json({ error:'invalid_request', message:'A senha informada é longa demais para o padrão aceito.' })
  const store = readStore()
  if(findUserByEmail(store, email)) return res.status(409).json({ error:'email_exists', message:'Este e-mail já está em uso.' })

  const companyId = uuidv4()
  const userId = uuidv4()
  const plan = planPreset(store.billingConfig.default_plan_code || 'gestao')

  const user = {
    id: userId,
    name: nome,
    email,
    password_hash: bcrypt.hashSync(password, 10),
    company_id: companyId,
    role: 'owner',
    is_owner: true,
    permissions: BUSINESS_MODULES,
    allowed_modules: BUSINESS_MODULES,
    is_active: true,
    created_at: nowIso(),
    updated_at: nowIso()
  }
  store.users.push(user)
  store.companies.push({
    id: companyId,
    name: empresa,
    owner_name: nome,
    owner_email: email,
    owner_phone: '',
    plan_code: plan.code,
    plan_name: plan.name,
    billing_mode: 'stripe',
    financial_status: 'pending_payment',
    access_status: 'pending_payment',
    seats_limit: plan.seats_limit,
    monthly_price_cents: plan.monthly_price_cents,
    notes: 'Conta criada pelo fluxo de cadastro SaaS.',
    created_at: nowIso(),
    updated_at: nowIso()
  })
  store.companyUsers.push({
    id: uuidv4(),
    company_id: companyId,
    user_id: userId,
    role: 'owner',
    status: 'active',
    modules: BUSINESS_MODULES,
    invited_at: nowIso(),
    last_login_at: nowIso(),
    is_owner: true
  })
  upsertAudit(store, {
    company_id: companyId,
    action: 'register',
    message: 'Empresa criada pelo fluxo público de cadastro.',
    actor_user_id: userId,
    actor_name: nome,
    actor_email: email,
    actor_role: 'owner',
    source: 'public-register'
  })
  writeStore(store)
  sendEmail({ to: email, ...welcomeEmail(nome, empresa) }).catch(() => {})
  res.status(201).json({ token: issueToken(user), user: sanitizeUser(enrichUserForResponse(store, user)) })
})

function handleForgotPassword(req, res){
  const email = normalizeEmail(req.body?.email)
  if(!email) return res.status(400).json({ error:'invalid_request', message:'Informe um e-mail válido.' })
  if(!takeRateLimit(`forgot:${req.ip}:${email}`, 6, 60 * 60 * 1000)){
    return res.status(429).json(genericResetResponse())
  }

  const store = readStore()
  const user = findUserByEmail(store, email)
  if(!user || user.is_active === false){
    return res.json(genericResetResponse())
  }

  const token = buildResetToken()
  const expiresAt = new Date(Date.now() + getResetTtlMinutes() * 60000).toISOString()
  user.reset_token_hash = hashResetToken(token)
  user.reset_token_expires_at = expiresAt
  user.reset_requested_at = nowIso()
  user.updated_at = nowIso()

  if(user.company_id){
    upsertAudit(store, {
      company_id: user.company_id,
      action: 'password_reset_requested',
      message: 'Solicitação de redefinição de senha registrada.',
      actor_user_id: user.id,
      actor_name: user.name,
      actor_email: user.email,
      actor_role: user.role || 'user',
      source: 'auth-forgot-password'
    })
  }

  writeStore(store)
  sendEmail({ to: email, ...passwordResetEmail(user.name, token, getResetTtlMinutes()) }).catch(() => {})
  const extra = exposeResetToken() ? { reset_token_preview: token, reset_token_expires_at: expiresAt } : {}
  return res.json(genericResetResponse(extra))
}

router.post('/forgot-password', handleForgotPassword)
router.post('/reset-password/request', handleForgotPassword)
router.post('/password/forgot', handleForgotPassword)

function handleResetPassword(req, res){
  const token = String(req.body?.token || req.body?.reset_token || '').trim()
  const password = String(req.body?.password || '')
  const confirm = String(req.body?.confirm_password || req.body?.confirm || '')

  if(!takeRateLimit(`reset:${req.ip}`, 10, 60 * 60 * 1000)){
    return res.status(429).json({ error:'rate_limited', message:'Muitas tentativas de redefinição. Aguarde um pouco.' })
  }
  if(!token || !password) return res.status(400).json({ error:'invalid_request', message:'Token e nova senha são obrigatórios.' })
  if(password.length < 6) return res.status(400).json({ error:'invalid_request', message:'A nova senha deve ter pelo menos 6 caracteres.' })
  if(confirm && password !== confirm) return res.status(400).json({ error:'invalid_request', message:'A confirmação de senha não confere.' })

  const store = readStore()
  const tokenHash = hashResetToken(token)
  const now = Date.now()
  const user = store.users.find(item => item.reset_token_hash === tokenHash && item.reset_token_expires_at && new Date(item.reset_token_expires_at).getTime() >= now && item.is_active !== false)
  if(!user) return res.status(400).json({ error:'invalid_token', message:'Token inválido ou expirado.' })

  user.password_hash = bcrypt.hashSync(password, 10)
  user.reset_token_hash = ''
  user.reset_token_expires_at = ''
  user.reset_requested_at = ''
  user.updated_at = nowIso()

  if(user.company_id){
    upsertAudit(store, {
      company_id: user.company_id,
      action: 'password_reset_completed',
      message: 'Senha redefinida com sucesso.',
      actor_user_id: user.id,
      actor_name: user.name,
      actor_email: user.email,
      actor_role: user.role || 'user',
      source: 'auth-reset-password'
    })
  }

  writeStore(store)
  res.json({ ok:true, message:'Senha redefinida com sucesso. Você já pode entrar com a nova senha.' })
}

router.post('/reset-password', handleResetPassword)
router.post('/password/reset', handleResetPassword)

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user })
})

router.get('/team', requireAuth, (req, res) => {
  const store = readStore()
  const company = getCompanyContext(req, store)
  if(!company){
    if(hasMasterAccess(req.user)){
      return res.json({ company: null, subscription: null, users: [], is_master: true, message: 'Usuário master não pertence a uma empresa específica.' })
    }
    return res.status(404).json({ error:'company_not_found', message:'Empresa não encontrada para esta sessão.' })
  }
  res.json(teamPayload(store, company))
})

router.post('/team/invite', requireAuth, (req, res) => {
  const store = readStore()
  const company = getCompanyContext(req, store)
  if(!company) return res.status(404).json({ error:'company_not_found', message:'Empresa não encontrada.' })
  const { name, role, modules } = req.body || {}
  const email = normalizeEmail(req.body?.email)
  const cleanName = normalizeText(name, 120)
  if(!cleanName || !email) return res.status(400).json({ error:'invalid_request', message:'Nome e e-mail são obrigatórios.' })
  if(!looksLikeEmail(email)) return res.status(400).json({ error:'invalid_request', message:'Informe um e-mail válido.' })
  const selectedModules = sanitizeModules(modules)
  if(!selectedModules.length) return res.status(400).json({ error:'invalid_request', message:'Selecione ao menos um módulo válido.' })

  const activeUsers = activeMembershipCount(store, company.id)
  if(company.seats_limit != null && activeUsers >= Number(company.seats_limit || 0)){
    return res.status(409).json({ error:'seat_limit_reached', message:'Limite de acessos atingido para este plano.' })
  }

  let user = findUserByEmail(store, email)
  if(user){
    const currentCompanyId = String(user.company_id || '').trim()
    const belongsToAnotherCompany = store.companyUsers.some(item =>
      String(item.user_id) === String(user.id)
      && String(item.company_id) !== String(company.id)
    )
    if(
      (currentCompanyId && currentCompanyId !== String(company.id))
      || belongsToAnotherCompany
    ){
      return res.status(409).json({
        error:'email_belongs_to_another_company',
        message:'Este e-mail já está vinculado a outra empresa e não pode ser adicionado aqui.'
      })
    }
  }

  let initialPassword = ''
  if(!user){
    initialPassword = buildTeamPassword()
    user = {
      id: uuidv4(),
      name: cleanName,
      email,
      password_hash: bcrypt.hashSync(initialPassword, 10),
      company_id: company.id,
      role: role || 'custom',
      permissions: selectedModules,
      allowed_modules: selectedModules,
      is_active: true,
      created_at: nowIso(),
      updated_at: nowIso()
    }
    store.users.push(user)
  }

  const existing = store.companyUsers.find(item => String(item.company_id) === String(company.id) && String(item.user_id) === String(user.id))
  if(existing){
    existing.role = role || existing.role || 'custom'
    existing.modules = selectedModules
    existing.status = 'active'
    existing.invited_at = nowIso()
  }else{
    store.companyUsers.push({
      id: uuidv4(),
      company_id: company.id,
      user_id: user.id,
      role: role || 'custom',
      status: 'active',
      modules: selectedModules,
      invited_at: nowIso(),
      last_login_at: '',
      is_owner: false
    })
  }
  user.permissions = selectedModules
  user.allowed_modules = selectedModules
  user.role = role || user.role || 'custom'
  user.company_id = company.id
  user.updated_at = nowIso()
  writeStore(store)
  res.status(201).json({
    ok:true,
    message: initialPassword ? 'Usuário cadastrado.' : 'Usuário vinculado.',
    user: sanitizeUser(enrichUserForResponse(store, user)),
    ...(initialPassword ? { initial_password: initialPassword } : {})
  })
})

router.patch('/team/users/:userId', requireAuth, (req, res) => {
  const store = readStore()
  const company = getCompanyContext(req, store)
  if(!company) return res.status(404).json({ error:'company_not_found', message:'Empresa não encontrada.' })
  const link = store.companyUsers.find(item => String(item.company_id) === String(company.id) && String(item.user_id) === String(req.params.userId))
  if(!link) return res.status(404).json({ error:'user_not_found', message:'Usuário não pertence a esta empresa.' })
  const user = store.users.find(item => String(item.id) === String(req.params.userId))
  const selectedModules = sanitizeModules(req.body?.modules)
  if(selectedModules.length) link.modules = selectedModules
  if(req.body?.role) link.role = req.body.role
  link.status = link.status === 'inactive' ? 'inactive' : 'active'
  if(user){
    user.name = normalizeText(req.body?.name || user.name, 120)
    user.email = normalizeEmail(req.body?.email || user.email)
    user.role = req.body?.role || user.role
    if(selectedModules.length){
      user.permissions = selectedModules
      user.allowed_modules = selectedModules
    }
    user.updated_at = nowIso()
  }
  writeStore(store)
  res.json({ ok:true })
})

router.post('/team/users/:userId/generate-password', requireAuth, (req, res) => {
  const store = readStore()
  const company = getCompanyContext(req, store)
  const link = store.companyUsers.find(item => String(item.company_id) === String(company?.id) && String(item.user_id) === String(req.params.userId))
  if(!company || !link) return res.status(404).json({ error:'user_not_found', message:'Usuário não encontrado.' })
  if(link.is_owner) return res.status(409).json({ error:'owner_protected', message:'A senha da conta principal não pode ser alterada por aqui.' })
  const user = store.users.find(item => String(item.id) === String(req.params.userId))
  if(!user) return res.status(404).json({ error:'user_not_found', message:'Usuário não encontrado.' })

  const generatedPassword = buildTeamPassword()
  user.password_hash = bcrypt.hashSync(generatedPassword, 10)
  user.reset_token_hash = ''
  user.reset_token_expires_at = ''
  user.reset_requested_at = ''
  user.updated_at = nowIso()
  upsertAudit(store, {
    company_id: company.id,
    action: 'team_password_regenerated',
    message: 'Nova senha de acesso gerada para usuário da equipe.',
    actor_user_id: req.user.id,
    actor_name: req.user.name,
    actor_email: req.user.email,
    actor_role: req.user.role || 'user',
    source: 'team-management'
  })
  writeStore(store)
  res.json({ ok:true, generated_password: generatedPassword })
})

router.post('/team/users/:userId/deactivate', requireAuth, (req, res) => {
  const store = readStore()
  const company = getCompanyContext(req, store)
  const link = store.companyUsers.find(item => String(item.company_id) === String(company?.id) && String(item.user_id) === String(req.params.userId))
  if(!company || !link) return res.status(404).json({ error:'user_not_found', message:'Usuário não encontrado.' })
  if(link.is_owner) return res.status(409).json({ error:'owner_protected', message:'A conta principal não pode ser desativada por aqui.' })
  link.status = 'inactive'
  writeStore(store)
  res.json({ ok:true })
})

router.post('/team/users/:userId/reactivate', requireAuth, (req, res) => {
  const store = readStore()
  const company = getCompanyContext(req, store)
  const link = store.companyUsers.find(item => String(item.company_id) === String(company?.id) && String(item.user_id) === String(req.params.userId))
  if(!company || !link) return res.status(404).json({ error:'user_not_found', message:'Usuário não encontrado.' })
  const activeUsers = activeMembershipCount(store, company.id)
  if(company.seats_limit != null && activeUsers >= Number(company.seats_limit || 0)){
    return res.status(409).json({ error:'seat_limit_reached', message:'Limite de acessos atingido para este plano.' })
  }
  link.status = 'active'
  writeStore(store)
  res.json({ ok:true })
})

module.exports = router
