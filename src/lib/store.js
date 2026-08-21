const fs = require('fs')
const path = require('path')
const bcrypt = require('bcryptjs')
const { v4: uuidv4 } = require('uuid')

const DATA_DIR = process.env.DATA_DIR || '/data'
const STORE_FILE = path.join(DATA_DIR, 'store.json')

const DEFAULT_STORE = {
  users: [],
  companies: [],
  companyUsers: [],
  auditLogs: [],
  billingConfig: {
    enabled: true,
    default_plan_code: 'gestao',
    plan_code: 'gestao',
    plan_name: 'Plano Gestão',
    monthly_price_cents: 14900,
    annual_price_cents: 0,
    payment_provider: 'stripe',
    payment_link: '',
    support_contact: 'Atendimento comercial',
    trial_days: 60,
    notes: 'Primeiro mês grátis'
  },
  billingLeads: [],
  webhookEvents: []
}

function clone(value){
  return JSON.parse(JSON.stringify(value))
}

function ensureStore(){
  fs.mkdirSync(DATA_DIR, { recursive: true })
  if(!fs.existsSync(STORE_FILE)){
    fs.writeFileSync(STORE_FILE, JSON.stringify(DEFAULT_STORE, null, 2))
  }
}

function readStore(){
  ensureStore()
  const raw = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'))
  return {
    ...clone(DEFAULT_STORE),
    ...raw,
    users: Array.isArray(raw.users) ? raw.users : [],
    companies: Array.isArray(raw.companies) ? raw.companies : [],
    companyUsers: Array.isArray(raw.companyUsers) ? raw.companyUsers : [],
    auditLogs: Array.isArray(raw.auditLogs) ? raw.auditLogs : [],
    billingLeads: Array.isArray(raw.billingLeads) ? raw.billingLeads : [],
    webhookEvents: Array.isArray(raw.webhookEvents) ? raw.webhookEvents : []
  }
}

function writeStore(store){
  ensureStore()
  fs.writeFileSync(STORE_FILE, JSON.stringify(store, null, 2))
}

function updateStore(mutator){
  const store = readStore()
  const next = mutator(store) || store
  writeStore(next)
  return next
}

function nowIso(){
  return new Date().toISOString()
}

function planPreset(planCode){
  return String(planCode || '').toLowerCase().includes('empresarial')
    ? { code:'empresarial', name:'Plano Empresarial', seats_limit:null, monthly_price_cents:39900 }
    : { code:'gestao', name:'Plano Gestão', seats_limit:2, monthly_price_cents:14900 }
}

function upsertAudit(store, entry){
  store.auditLogs.unshift({
    id: entry.id || uuidv4(),
    created_at: entry.created_at || nowIso(),
    ...entry
  })
  store.auditLogs = store.auditLogs.slice(0, 5000)
}

function findUserByEmail(store, email){
  return store.users.find(user => String(user.email || '').toLowerCase() === String(email || '').toLowerCase()) || null
}

function findCompanyById(store, companyId){
  return store.companies.find(item => String(item.id) === String(companyId)) || null
}

function activeMembershipCount(store, companyId){
  return store.companyUsers.filter(item => String(item.company_id) === String(companyId) && String(item.status || '').toLowerCase().includes('active')).length
}

function materializeCompany(store, company){
  if(!company) return null
  const plan = planPreset(company.plan_code || company.current_plan_code)
  const members = store.companyUsers
    .filter(item => String(item.company_id) === String(company.id))
    .map(link => {
      const user = store.users.find(u => String(u.id) === String(link.user_id)) || {}
      return {
        name: user.name || 'Usuário',
        email: user.email || '-',
        role: link.role || 'custom',
        status: link.status || 'pending',
        modules: Array.isArray(link.modules) ? link.modules : []
      }
    })

  return {
    id: company.id,
    name: company.name,
    owner_name: company.owner_name || 'Responsável não informado',
    owner_email: company.owner_email || '-',
    owner_phone: company.owner_phone || '',
    plan_code: company.plan_code || plan.code,
    plan_name: company.plan_name || plan.name,
    billing_mode: company.billing_mode || 'stripe',
    financial_status: company.financial_status || 'trialing',
    access_status: company.access_status || 'active',
    seats_limit: company.seats_limit === undefined ? plan.seats_limit : company.seats_limit,
    seats_used: activeMembershipCount(store, company.id),
    next_charge_at: company.next_charge_at || '',
    last_payment_at: company.last_payment_at || '',
    courtesy_until: company.courtesy_until || '',
    manual_grace_until: company.manual_grace_until || '',
    trial_ends_at: company.trial_ends_at || '',
    notes: company.notes || '',
    monthly_price_cents: Number(company.monthly_price_cents || plan.monthly_price_cents || 0),
    stripe_customer_id: company.stripe_customer_id || '',
    stripe_subscription_id: company.stripe_subscription_id || '',
    team: members
  }
}

function bootstrapEnabled(name){
  return String(process.env[name] || '').trim() === '1'
}

function requiredBootstrapEnv(name){
  const value = String(process.env[name] || '').trim()
  if(value) return value
  const error = new Error(`${name} é obrigatório quando o bootstrap é habilitado.`)
  error.code = 'bootstrap_env_required'
  throw error
}

function validateBootstrapPassword(password, envName){
  if(String(password || '').length >= 12) return
  const error = new Error(`${envName} deve ter pelo menos 12 caracteres.`)
  error.code = 'bootstrap_password_too_short'
  throw error
}

function bootstrapStore(){
  updateStore(store => {
    if(store.users.length) return store

    if(!bootstrapEnabled('BOOTSTRAP_MASTER')){
      const error = new Error('Store vazio e BOOTSTRAP_MASTER não está habilitado. Nenhuma conta administrativa foi criada.')
      error.code = 'bootstrap_master_disabled'
      throw error
    }

    const masterEmail = requiredBootstrapEnv('MASTER_EMAIL')
    const masterPassword = requiredBootstrapEnv('MASTER_PASSWORD')
    validateBootstrapPassword(masterPassword, 'MASTER_PASSWORD')

    const masterId = uuidv4()
    store.users.push({
      id: masterId,
      name: String(process.env.MASTER_NAME || 'Master SaaS').trim() || 'Master SaaS',
      email: masterEmail,
      password_hash: bcrypt.hashSync(masterPassword, 10),
      role: 'platform_admin',
      is_master: true,
      is_superadmin: true,
      master_access: true,
      saas_admin: true,
      permissions: ['master','saas.companies.read','saas.companies.write','saas.audit.read','saas.audit.write','billing.read','billing.write'],
      allowed_modules: ['master','painel','vendedor','agenda','material','precificacao','catalogo','itens-personalizacao','assinatura'],
      is_active: true,
      created_at: nowIso(),
      updated_at: nowIso()
    })

    upsertAudit(store, {
      action: 'bootstrap_master',
      message: 'Conta Master criada por bootstrap explícito.',
      actor_name: 'system',
      actor_email: 'system@local',
      actor_role: 'bootstrap',
      reason: 'explicit_bootstrap',
      source: 'bootstrap'
    })

    if(!bootstrapEnabled('BOOTSTRAP_DEMO')) return store

    const demoEmail = requiredBootstrapEnv('DEMO_EMAIL')
    const demoPassword = requiredBootstrapEnv('DEMO_PASSWORD')
    validateBootstrapPassword(demoPassword, 'DEMO_PASSWORD')

    const companyId = uuidv4()
    const ownerId = uuidv4()
    const plan = planPreset('gestao')
    const demoOwnerName = String(process.env.DEMO_OWNER_NAME || 'Dono da Empresa Demo').trim() || 'Dono da Empresa Demo'
    const demoCompanyName = String(process.env.DEMO_COMPANY_NAME || 'Estofaria Demo').trim() || 'Estofaria Demo'

    store.users.push({
      id: ownerId,
      name: demoOwnerName,
      email: demoEmail,
      password_hash: bcrypt.hashSync(demoPassword, 10),
      role: 'owner',
      company_id: companyId,
      is_owner: true,
      permissions: ['painel','vendedor','agenda','material','precificacao','catalogo','itens-personalizacao','assinatura'],
      allowed_modules: ['painel','vendedor','agenda','material','precificacao','catalogo','itens-personalizacao','assinatura'],
      is_active: true,
      created_at: nowIso(),
      updated_at: nowIso()
    })
    store.companies.push({
      id: companyId,
      name: demoCompanyName,
      owner_name: demoOwnerName,
      owner_email: demoEmail,
      owner_phone: String(process.env.DEMO_OWNER_PHONE || '').trim(),
      plan_code: plan.code,
      plan_name: plan.name,
      billing_mode: 'stripe',
      financial_status: 'active',
      access_status: 'active',
      seats_limit: plan.seats_limit,
      monthly_price_cents: plan.monthly_price_cents,
      next_charge_at: nowIso(),
      trial_ends_at: '',
      created_at: nowIso(),
      updated_at: nowIso(),
      notes: 'Empresa demo criada por bootstrap explícito.'
    })
    store.companyUsers.push({
      id: uuidv4(),
      company_id: companyId,
      user_id: ownerId,
      role: 'owner',
      status: 'active',
      modules: ['painel','vendedor','agenda','material','precificacao','catalogo','itens-personalizacao','assinatura'],
      invited_at: nowIso(),
      last_login_at: '',
      is_owner: true
    })
    upsertAudit(store, {
      company_id: companyId,
      action: 'bootstrap_demo',
      message: 'Loja demo criada por bootstrap explícito.',
      actor_name: 'system',
      actor_email: 'system@local',
      actor_role: 'bootstrap',
      reason: 'explicit_demo_bootstrap',
      source: 'bootstrap'
    })
    return store
  })
}

module.exports = {
  STORE_FILE,
  ensureStore,
  readStore,
  writeStore,
  updateStore,
  bootstrapStore,
  planPreset,
  upsertAudit,
  findUserByEmail,
  findCompanyById,
  activeMembershipCount,
  materializeCompany,
  nowIso
}

// Auto-switch para PostgreSQL quando DATABASE_URL estiver configurada
if (process.env.DATABASE_URL) {
  const pg = require('./store-pg')
  module.exports.readStore      = pg.readStore
  module.exports.writeStore     = pg.writeStore
  module.exports.updateStore    = pg.updateStore
  module.exports.bootstrapStore = pg.bootstrapStore
  module.exports.ensureStore    = pg.ensureStore
  module.exports._pg            = pg
}
