'use strict'

/**
 * PostgreSQL-backed store — mesma API do store.js (readStore/writeStore/etc.)
 * Usa cache em memória para leituras síncronas rápidas.
 * Persiste no PostgreSQL de forma assíncrona com debounce de 200ms.
 * Na primeira inicialização migra automaticamente o store.json existente.
 */

const { Pool } = require('pg')
const bcrypt = require('bcryptjs')
const { v4: uuidv4 } = require('uuid')
const fs = require('fs')
const path = require('path')

// ─── Conexão ────────────────────────────────────────────────────────────────

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && !process.env.DATABASE_URL.includes('localhost')
    ? { rejectUnauthorized: false }
    : false,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000
})

pool.on('error', (err) => {
  console.error('[store-pg] Pool error:', err.message)
})

// ─── Estado interno ──────────────────────────────────────────────────────────

let _cache = null
let _dirty = false
let _writeTimer = null
let _initialized = false

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
    monthly_price_cents: 8990,
    annual_price_cents: 0,
    payment_provider: 'stripe',
    payment_link: '',
    support_contact: 'Atendimento comercial',
    trial_days: 30,
    notes: 'Primeiro mês grátis'
  },
  billingLeads: [],
  webhookEvents: []
}

// ─── Schema ──────────────────────────────────────────────────────────────────

async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS kv_store (
      key   TEXT PRIMARY KEY,
      value JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
}

// ─── Carga e persistência ────────────────────────────────────────────────────

async function loadFromPg() {
  const res = await pool.query(`SELECT value FROM kv_store WHERE key = 'main' LIMIT 1`)
  if (res.rows.length === 0) return null
  return res.rows[0].value
}

async function saveToPg(data) {
  await pool.query(
    `INSERT INTO kv_store (key, value, updated_at)
     VALUES ('main', $1, NOW())
     ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()`,
    [JSON.stringify(data)]
  )
}

function loadFromFile() {
  try {
    const DATA_DIR = process.env.DATA_DIR || '/data'
    const STORE_FILE = path.join(DATA_DIR, 'store.json')
    if (!fs.existsSync(STORE_FILE)) return null
    const raw = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'))
    if (!raw || !Array.isArray(raw.users)) return null
    return raw
  } catch (_e) {
    return null
  }
}

function mergeWithDefaults(raw) {
  if (!raw) raw = {}
  return {
    ...DEFAULT_STORE,
    ...raw,
    billingConfig: { ...DEFAULT_STORE.billingConfig, ...(raw.billingConfig || {}) },
    users: Array.isArray(raw.users) ? raw.users : [],
    companies: Array.isArray(raw.companies) ? raw.companies : [],
    companyUsers: Array.isArray(raw.companyUsers) ? raw.companyUsers : [],
    auditLogs: Array.isArray(raw.auditLogs) ? raw.auditLogs : [],
    billingLeads: Array.isArray(raw.billingLeads) ? raw.billingLeads : [],
    webhookEvents: Array.isArray(raw.webhookEvents) ? raw.webhookEvents : []
  }
}

// ─── Escrita com debounce ────────────────────────────────────────────────────

function scheduleWrite() {
  _dirty = true
  if (_writeTimer) clearTimeout(_writeTimer)
  _writeTimer = setTimeout(() => {
    _writeTimer = null
    if (_cache && _dirty) {
      _dirty = false
      saveToPg(_cache).catch(err => {
        console.error('[store-pg] Async write error:', err.message)
        _dirty = true
        scheduleWrite()
      })
    }
  }, 200)
}

async function flushNow() {
  if (_writeTimer) {
    clearTimeout(_writeTimer)
    _writeTimer = null
  }
  _dirty = false
  if (_cache) await saveToPg(_cache)
}

// ─── Init ────────────────────────────────────────────────────────────────────

async function init() {
  if (_initialized) return
  await ensureSchema()

  let raw = await loadFromPg()
  let migrated = false

  if (!raw || !Array.isArray(raw.users) || raw.users.length === 0) {
    const fileData = loadFromFile()
    if (fileData && Array.isArray(fileData.users) && fileData.users.length > 0) {
      console.log('[store-pg] Migrando store.json → PostgreSQL...')
      raw = fileData
      migrated = true
    }
  }

  _cache = mergeWithDefaults(raw)

  if (migrated) {
    await saveToPg(_cache)
    console.log(`[store-pg] Migração concluída. Empresas: ${_cache.companies.length}, Usuários: ${_cache.users.length}`)
  } else {
    console.log(`[store-pg] Carregado do PostgreSQL. Empresas: ${_cache.companies.length}, Usuários: ${_cache.users.length}`)
  }

  _initialized = true
}

// ─── API pública (mesma interface do store.js) ────────────────────────────────

function readStore() {
  if (!_cache) throw new Error('[store-pg] Store não inicializado — chame init() antes.')
  return JSON.parse(JSON.stringify(_cache))
}

function writeStore(store) {
  _cache = JSON.parse(JSON.stringify(store))
  scheduleWrite()
}

function updateStore(mutator) {
  const store = readStore()
  const next = mutator(store) || store
  writeStore(next)
  return next
}

// ─── Utilitários (idênticos ao store.js) ────────────────────────────────────

function nowIso() {
  return new Date().toISOString()
}

function planPreset(planCode) {
  return String(planCode || '').toLowerCase().includes('empresarial')
    ? { code: 'empresarial', name: 'Plano Empresarial', seats_limit: null, monthly_price_cents: 53900 }
    : { code: 'gestao', name: 'Plano Gestão', seats_limit: 2, monthly_price_cents: 8990 }
}

function upsertAudit(store, entry) {
  store.auditLogs.unshift({
    id: entry.id || uuidv4(),
    created_at: entry.created_at || nowIso(),
    ...entry
  })
  store.auditLogs = store.auditLogs.slice(0, 5000)
}

function findUserByEmail(store, email) {
  return store.users.find(u => String(u.email || '').toLowerCase() === String(email || '').toLowerCase()) || null
}

function findCompanyById(store, companyId) {
  return store.companies.find(c => String(c.id) === String(companyId)) || null
}

function activeMembershipCount(store, companyId) {
  return store.companyUsers.filter(
    item => String(item.company_id) === String(companyId) && String(item.status || '').toLowerCase().includes('active')
  ).length
}

function materializeCompany(store, company) {
  if (!company) return null
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

// ─── Bootstrap (cria usuário master se store vazio) ──────────────────────────

async function bootstrapStore() {
  updateStore(store => {
    if (store.users.length > 0) return store

    const masterEmail = process.env.MASTER_EMAIL || 'master@estofaria.local'
    const masterPassword = process.env.MASTER_PASSWORD || 'ChangeMe123!'
    const masterId = uuidv4()
    store.users.push({
      id: masterId,
      name: 'Master SaaS',
      email: masterEmail,
      password_hash: bcrypt.hashSync(masterPassword, 10),
      role: 'platform_admin',
      is_master: true,
      is_superadmin: true,
      master_access: true,
      saas_admin: true,
      permissions: ['master', 'saas.companies.read', 'saas.companies.write', 'saas.audit.read', 'saas.audit.write', 'billing.read', 'billing.write'],
      allowed_modules: ['master', 'painel', 'vendedor', 'agenda', 'material', 'precificacao', 'catalogo', 'itens-personalizacao', 'assinatura'],
      is_active: true,
      created_at: nowIso(),
      updated_at: nowIso()
    })

    const companyId = uuidv4()
    const ownerId = uuidv4()
    const plan = planPreset('gestao')
    store.users.push({
      id: ownerId,
      name: 'Dono da Empresa Demo',
      email: 'owner@demo.local',
      password_hash: bcrypt.hashSync('Owner123!', 10),
      role: 'owner',
      company_id: companyId,
      is_owner: true,
      permissions: ['painel', 'vendedor', 'agenda', 'material', 'precificacao', 'catalogo', 'itens-personalizacao', 'assinatura'],
      allowed_modules: ['painel', 'vendedor', 'agenda', 'material', 'precificacao', 'catalogo', 'itens-personalizacao', 'assinatura'],
      is_active: true,
      created_at: nowIso(),
      updated_at: nowIso()
    })
    store.companies.push({
      id: companyId,
      name: 'Estofaria Demo',
      owner_name: 'Dono da Empresa Demo',
      owner_email: 'owner@demo.local',
      owner_phone: '11999999999',
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
      notes: 'Empresa demo inicial do starter SaaS.'
    })
    store.companyUsers.push({
      id: uuidv4(),
      company_id: companyId,
      user_id: ownerId,
      role: 'owner',
      status: 'active',
      modules: ['painel', 'vendedor', 'agenda', 'material', 'precificacao', 'catalogo', 'itens-personalizacao', 'assinatura'],
      invited_at: nowIso(),
      last_login_at: '',
      is_owner: true
    })
    upsertAudit(store, {
      company_id: companyId,
      action: 'bootstrap',
      message: 'Loja inicial criada automaticamente.',
      actor_name: 'system',
      actor_email: 'system@local',
      actor_role: 'bootstrap',
      reason: 'seed',
      source: 'bootstrap-pg'
    })
    return store
  })
  await flushNow()
}

// ─── Compat: STORE_FILE para o health check ──────────────────────────────────

const DATA_DIR = process.env.DATA_DIR || '/data'
const STORE_FILE = path.join(DATA_DIR, 'store.json')

function ensureStore() {} // no-op em modo PG

// ─── Exports ─────────────────────────────────────────────────────────────────

module.exports = {
  init,
  flushNow,
  pool,
  STORE_FILE,
  ensureStore,
  readStore,
  writeStore,
  updateStore,
  bootstrapStore,
  nowIso,
  planPreset,
  upsertAudit,
  findUserByEmail,
  findCompanyById,
  activeMembershipCount,
  materializeCompany
}
