'use strict'

const bcrypt = require('bcryptjs')
const { v4: uuidv4 } = require('uuid')
const { readStore, writeStore, planPreset, findUserByEmail, nowIso, upsertAudit } = require('./store')

const BUSINESS_MODULES = ['painel','vendedor','agenda','material','precificacao','catalogo','itens-personalizacao','assinatura','financeiro','configuracao']

async function seedTestAccountOnce(){
  if(String(process.env.TEST_ACCOUNT_SEED_ON_START || '') !== '1') return { skipped:true }

  const email = String(process.env.TEST_ACCOUNT_SEED_EMAIL || '').trim().toLowerCase()
  const password = String(process.env.TEST_ACCOUNT_SEED_PASSWORD || '')
  const empresa = String(process.env.TEST_ACCOUNT_SEED_COMPANY || 'Teste Problema 08').trim()
  const nome = String(process.env.TEST_ACCOUNT_SEED_NAME || 'Teste Assinante').trim()

  if(!email || !password) throw new Error('TEST_ACCOUNT_SEED_EMAIL e TEST_ACCOUNT_SEED_PASSWORD são obrigatórios.')

  const store = readStore()
  const existing = findUserByEmail(store, email)
  if(existing){
    console.log(`[test-account-seed] Conta já existe: ${email}`)
    return { created:false, email, company_id:existing.company_id || '' }
  }

  const companyId = uuidv4()
  const userId = uuidv4()
  const plan = planPreset('gestao')

  const user = {
    id:userId,
    name:nome,
    email,
    password_hash:bcrypt.hashSync(password, 10),
    session_version:0,
    company_id:companyId,
    role:'owner',
    is_owner:true,
    permissions:BUSINESS_MODULES,
    allowed_modules:BUSINESS_MODULES,
    is_active:true,
    created_at:nowIso(),
    updated_at:nowIso()
  }

  store.users.push(user)
  store.companies.push({
    id:companyId,
    name:empresa,
    owner_name:nome,
    owner_email:email,
    owner_phone:'',
    plan_code:plan.code,
    plan_name:plan.name,
    billing_mode:'stripe',
    financial_status:'pending_payment',
    access_status:'pending_payment',
    seats_limit:plan.seats_limit,
    monthly_price_cents:plan.monthly_price_cents,
    notes:'Conta descartável criada para teste do Problema 08.',
    terms_accepted_at:nowIso(),
    privacy_accepted_at:nowIso(),
    created_at:nowIso(),
    updated_at:nowIso()
  })
  store.companyUsers.push({
    id:uuidv4(),
    company_id:companyId,
    user_id:userId,
    role:'owner',
    status:'active',
    modules:BUSINESS_MODULES,
    invited_at:nowIso(),
    last_login_at:'',
    is_owner:true
  })

  upsertAudit(store, {
    company_id:companyId,
    action:'test_account_seeded',
    message:'Conta descartável criada para validação do Problema 08.',
    actor_user_id:userId,
    actor_name:nome,
    actor_email:email,
    actor_role:'owner',
    source:'test-account-seed'
  })

  writeStore(store)
  console.log(`[test-account-seed] Conta criada: ${email} | empresa ${companyId}`)
  return { created:true, email, company_id:companyId }
}

module.exports = { seedTestAccountOnce }
