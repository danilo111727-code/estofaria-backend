const express = require('express')
const bcrypt = require('bcryptjs')
const crypto = require('crypto')
const personalizationDb = require('../lib/personalization-v2-db')
const { readStore, writeStore, materializeCompany, findCompanyById, upsertAudit, nowIso, planPreset } = require('../lib/store')
const { requireAuth, requireMaster, requirePermission } = require('../middleware/auth')
const { hasMasterAccess } = require('../lib/policies')

const router = express.Router()

function applyCompanyAction(company, action, payload){
  const plan = planPreset(payload.plan_code || company.plan_code)
  switch(action){
    case 'courtesy':
      company.billing_mode = 'courtesy'
      company.access_status = 'courtesy_active'
      company.financial_status = 'active'
      company.courtesy_until = payload.courtesy_until || payload.until || ''
      company.professional_courtesy_enabled = payload.professional_courtesy_enabled === true
      break
    case 'endCourtesy':
      company.billing_mode = 'stripe'
      company.access_status = 'active'
      company.courtesy_until = ''
      company.professional_courtesy_enabled = false
      break
    case 'toPaid':
      company.billing_mode = 'stripe'
      company.professional_courtesy_enabled = false
      company.financial_status = 'active'
      company.access_status = 'active'
      break
    case 'changePlan':
      company.plan_code = plan.code
      company.plan_name = payload.plan_name || plan.name
      company.seats_limit = plan.seats_limit
      company.monthly_price_cents = payload.monthly_price_cents || plan.monthly_price_cents
      break
    case 'grantGrace':
      company.billing_mode = 'manual'
      company.professional_courtesy_enabled = false
      company.access_status = 'manual_grace'
      company.manual_grace_until = payload.manual_grace_until || payload.until || ''
      break
    case 'block':
      company.access_status = 'blocked'
      company.financial_status = payload.financial_status || company.financial_status || 'unpaid'
      break
    case 'reactivate':
      company.access_status = 'active'
      if(['unpaid','past_due'].includes(String(company.financial_status || '').toLowerCase())){
        company.access_status = company.manual_grace_until ? 'manual_grace' : 'active'
      }
      break
    case 'grantFreeAccess':
      company.billing_mode = 'manual'
      company.professional_courtesy_enabled = false
      company.access_status = 'active'
      company.financial_status = 'active'
      break
    default:
      throw new Error('Ação administrativa inválida.')
  }
  if(typeof payload.notes === 'string') company.notes = payload.notes
  company.updated_at = nowIso()
}


  router.get('/stats', requireAuth, requireMaster, requirePermission('saas.companies.read'), (req, res) => {
    const store = readStore()
    const companies = store.companies || []
    const total = companies.length
    const active = companies.filter(c => c.access_status === 'active' || c.financial_status === 'active').length
    const trialing = companies.filter(c => c.subscription_status === 'trialing' || !c.financial_status).length
    const blocked = companies.filter(c => c.access_status === 'blocked').length
    const leads = (store.billingLeads || []).length
    res.json({ total_companies: total, active, trialing, blocked, total_leads: leads, total_users: (store.users || []).length })
  })

  router.get('/audit', requireAuth, requireMaster, requirePermission('saas.audit.read'), (req, res) => {
    const store = readStore()
    const limit = Math.min(Number(req.query.limit) || 100, 500)
    const all = store.auditLogs || []
    const items = all.slice(-limit).reverse()
    res.json({ items, total: all.length })
  })

  router.post('/logout-companies', requireAuth, requireMaster, requirePermission('saas.companies.write'), (req, res) => {
    if(String(req.body?.confirmation || '').trim().toUpperCase() !== 'DESLOGAR'){
      return res.status(400).json({
        error:'confirmation_required',
        message:'Digite DESLOGAR para confirmar o encerramento das sessões.'
      })
    }

    const store = readStore()
    const companyUserIds = new Set((store.companyUsers || []).map(item => String(item.user_id || '')))
    const affectedUsers = (store.users || []).filter(user =>
      !hasMasterAccess(user)
      && (Boolean(user.company_id) || companyUserIds.has(String(user.id || '')))
    )

    const changedAt = nowIso()
    for(const user of affectedUsers){
      user.session_version = Number(user.session_version || 0) + 1
      user.updated_at = changedAt
    }

    upsertAudit(store, {
      action:'all_company_sessions_revoked',
      message:`${affectedUsers.length} usuário(s) de empresas foram deslogados pelo Master.`,
      actor_user_id:req.user.id,
      actor_name:req.user.name,
      actor_email:req.user.email,
      actor_role:req.user.role,
      reason:String(req.body?.reason || 'Atualização geral do aplicativo').trim(),
      source:'master-logout-companies',
      ip_address:req.ip,
      user_agent:req.headers['user-agent'] || ''
    })
    writeStore(store)

    res.json({
      ok:true,
      users_revoked:affectedUsers.length,
      companies_affected:new Set(affectedUsers.map(user => String(user.company_id || '')).filter(Boolean)).size,
      master_preserved:true,
      message:'As sessões das empresas foram encerradas. O Master permaneceu conectado.'
    })
  })

  router.get('/companies', requireAuth, requireMaster, requirePermission('saas.companies.read'), (req, res) => {
  const store = readStore()
  const query = String(req.query.q || '').toLowerCase()
  const plan = String(req.query.plan || 'all').toLowerCase()
  const billing = String(req.query.billing || 'all').toLowerCase()
  const access = String(req.query.access || 'all').toLowerCase()
  const page = Math.max(1, Number(req.query.page || 1))
  const pageSize = Math.min(100, Math.max(1, Number(req.query.page_size || 50)))

  let items = store.companies.map(company => materializeCompany(store, company))
  items = items.filter(company => {
    const haystack = [company.name, company.owner_name, company.owner_email, company.plan_name, company.billing_mode, company.financial_status, company.access_status].join(' ').toLowerCase()
    if(query && !haystack.includes(query)) return false
    if(plan !== 'all' && company.plan_code !== plan) return false
    if(billing !== 'all' && company.billing_mode !== billing) return false
    if(access !== 'all' && company.access_status !== access) return false
    return true
  })

  const total = items.length
  const start = (page - 1) * pageSize
  res.json({ items: items.slice(start, start + pageSize), page, page_size: pageSize, total })
})

function globalDefaultsRoot(store){
  if(!store.globalPersonalizationDefaults || typeof store.globalPersonalizationDefaults !== 'object'){
    store.globalPersonalizationDefaults = {}
  }
  for(const key of ['additionals','foams','albums']){
    if(!Array.isArray(store.globalPersonalizationDefaults[key])) store.globalPersonalizationDefaults[key] = []
  }
  return store.globalPersonalizationDefaults
}

function globalDefaultsCollection(store, key){
  return globalDefaultsRoot(store)[key]
}

function cleanGlobalItem(input = {}, existing = null, type = 'additional'){
  const name = String(input.name ?? input.nome ?? existing?.name ?? '').replace(/\s+/g, ' ').trim().slice(0, 180)
  const defaultUnit = type === 'foam' ? 'metro linear' : 'unidade'
  const unit = String(input.unit ?? input.unidade ?? existing?.unit ?? defaultUnit).replace(/\s+/g, ' ').trim().slice(0, 80) || defaultUnit
  return {
    id: String(existing?.id || input.id || ((type === 'foam' ? 'gfoam_' : 'gadd_') + crypto.randomUUID())),
    name,
    unit,
    price_cents: 0,
    category: type === 'foam' ? 'espuma' : 'outro',
    active: input.active === undefined ? (existing ? existing.active !== false : true) : Boolean(input.active),
    created_at: existing?.created_at || nowIso(),
    updated_at: nowIso()
  }
}

function cleanGlobalAlbum(input = {}, existing = null){
  const name = String(input.name ?? input.nome ?? existing?.name ?? existing?.nome ?? '').replace(/\s+/g, ' ').trim().slice(0, 180)
  const rawFabrics = Array.isArray(input.fabrics) ? input.fabrics
    : Array.isArray(input.itens) ? input.itens
    : Array.isArray(existing?.fabrics) ? existing.fabrics
    : []
  const fabrics = rawFabrics
    .map(item => typeof item === 'string' ? item : (item?.name ?? item?.nome ?? ''))
    .map(value => String(value || '').replace(/\s+/g, ' ').trim().slice(0, 180))
    .filter(Boolean)
    .filter((value, index, arr) => arr.findIndex(other => other.toLowerCase() === value.toLowerCase()) === index)
    .slice(0, 500)
  return {
    id: String(existing?.id || input.id || ('galb_' + crypto.randomUUID())),
    name,
    fabrics,
    active: input.active === undefined ? (existing ? existing.active !== false : true) : Boolean(input.active),
    created_at: existing?.created_at || nowIso(),
    updated_at: nowIso()
  }
}

function findGlobalById(items, itemId){
  return items.findIndex(item => String(item.id) === String(itemId))
}

function hasDuplicateGlobalName(items, name, ignoreIndex = -1){
  const key = String(name || '').trim().toLowerCase()
  return items.some((item, index) => index !== ignoreIndex && String(item.name || item.nome || '').trim().toLowerCase() === key)
}

function selectedCompanyIds(store, body){
  const requested = Array.from(new Set((Array.isArray(body?.company_ids) ? body.company_ids : [])
    .map(value => String(value || '').trim())
    .filter(Boolean)))
  const validIds = new Set((store.companies || []).map(company => String(company.id)))
  return requested.filter(id => validIds.has(id))
}

function normalizeGlobalStatusName(value){
  return String(value || '').trim().toLowerCase()
}

async function buildGlobalCompanyStatus(store, type, item){
  const companies = Array.isArray(store.companies) ? store.companies : []
  const targetName = normalizeGlobalStatusName(item?.name)
  const targetGlobalId = 'global_' + String(item?.id || '')
  const rows = []

  for(const company of companies){
    const companyId = String(company?.id || '').trim()
    if(!companyId) continue

    let received = false
    try{
      const catalog = await personalizationDb.getCatalog(companyId)
      if(type === 'album'){
        const albums = Array.isArray(catalog?.albums) ? catalog.albums : []
        received = albums.some(entry =>
          String(entry?.id || '') === targetGlobalId ||
          normalizeGlobalStatusName(entry?.nome || entry?.name) === targetName
        )
      }else{
        const items = Array.isArray(catalog?.items) ? catalog.items : []
        received = items.some(entry =>
          String(entry?.id || '') === targetGlobalId ||
          normalizeGlobalStatusName(entry?.name || entry?.nome) === targetName
        )
      }
    }catch(_){}

    rows.push({
      company_id: companyId,
      received
    })
  }

  return rows
}

router.get('/global-defaults/:type/:itemId/company-status', requireAuth, requireMaster, requirePermission('saas.companies.read'), async (req, res, next) => {
  try{
    const typeMap = {
      additional: 'additionals',
      foam: 'foams',
      album: 'albums'
    }
    const collectionKey = typeMap[String(req.params.type || '').trim()]
    if(!collectionKey) return res.status(400).json({ error:'invalid_type', message:'Tipo global inválido.' })

    const store = readStore()
    const item = globalDefaultsCollection(store, collectionKey).find(entry => String(entry.id) === String(req.params.itemId))
    if(!item) return res.status(404).json({ error:'not_found', message:'Padrão global não encontrado.' })

    const companies = await buildGlobalCompanyStatus(store, String(req.params.type || '').trim(), item)
    return res.json({ companies })
  }catch(err){ next(err) }
})

router.get('/global-defaults/additionals', requireAuth, requireMaster, requirePermission('saas.companies.read'), (req, res) => {
  const store = readStore()
  return res.json({ items: globalDefaultsCollection(store, 'additionals') })
})

router.post('/global-defaults/additionals', requireAuth, requireMaster, requirePermission('saas.companies.write'), (req, res) => {
  const store = readStore()
  const items = globalDefaultsCollection(store, 'additionals')
  const item = cleanGlobalItem(req.body || {}, null, 'additional')
  if(!item.name) return res.status(400).json({ error:'invalid_request', message:'Informe o nome do adicional.' })
  if(hasDuplicateGlobalName(items, item.name)) return res.status(409).json({ error:'duplicate_name', message:'Já existe um adicional global com esse nome.' })
  items.push(item)
  writeStore(store)
  return res.status(201).json({ ok:true, item })
})

router.patch('/global-defaults/additionals/:itemId', requireAuth, requireMaster, requirePermission('saas.companies.write'), (req, res) => {
  const store = readStore()
  const items = globalDefaultsCollection(store, 'additionals')
  const index = findGlobalById(items, req.params.itemId)
  if(index < 0) return res.status(404).json({ error:'not_found', message:'Adicional global não encontrado.' })
  const item = cleanGlobalItem(req.body || {}, items[index], 'additional')
  if(!item.name) return res.status(400).json({ error:'invalid_request', message:'Informe o nome do adicional.' })
  if(hasDuplicateGlobalName(items, item.name, index)) return res.status(409).json({ error:'duplicate_name', message:'Já existe um adicional global com esse nome.' })
  items[index] = item
  writeStore(store)
  return res.json({ ok:true, item })
})

router.delete('/global-defaults/additionals/:itemId', requireAuth, requireMaster, requirePermission('saas.companies.write'), (req, res) => {
  const store = readStore()
  const items = globalDefaultsCollection(store, 'additionals')
  const index = findGlobalById(items, req.params.itemId)
  if(index < 0) return res.status(404).json({ error:'not_found', message:'Adicional global não encontrado.' })
  const [removed] = items.splice(index, 1)
  writeStore(store)
  return res.json({ ok:true, removed })
})

router.post('/global-defaults/additionals/:itemId/apply', requireAuth, requireMaster, requirePermission('saas.companies.write'), async (req, res, next) => {
  try{
    const store = readStore()
    const item = globalDefaultsCollection(store, 'additionals').find(entry => String(entry.id) === String(req.params.itemId))
    if(!item) return res.status(404).json({ error:'not_found', message:'Adicional global não encontrado.' })
    const companyIds = selectedCompanyIds(store, req.body)
    if(!companyIds.length) return res.status(400).json({ error:'company_required', message:'Selecione pelo menos uma empresa.' })
    let companiesUpdated = 0
    let itemsAdded = 0
    for(const companyId of companyIds){
      const result = await personalizationDb.addCatalogItems(companyId, [{
        id:'global_' + String(item.id),
        name:item.name,
        unit:item.unit,
        price_cents:0,
        category:'outro',
        isAlbum:false,
        isGrupo:false
      }])
      if(Number(result.added || 0) > 0) companiesUpdated += 1
      itemsAdded += Number(result.added || 0)
    }
    return res.json({ ok:true, companies_selected:companyIds.length, companies_updated:companiesUpdated, items_added:itemsAdded })
  }catch(err){ next(err) }
})

router.get('/global-defaults/foams', requireAuth, requireMaster, requirePermission('saas.companies.read'), (req, res) => {
  const store = readStore()
  return res.json({ items: globalDefaultsCollection(store, 'foams') })
})

router.post('/global-defaults/foams', requireAuth, requireMaster, requirePermission('saas.companies.write'), (req, res) => {
  const store = readStore()
  const items = globalDefaultsCollection(store, 'foams')
  const item = cleanGlobalItem(req.body || {}, null, 'foam')
  if(!item.name) return res.status(400).json({ error:'invalid_request', message:'Informe o nome da espuma.' })
  if(hasDuplicateGlobalName(items, item.name)) return res.status(409).json({ error:'duplicate_name', message:'Já existe uma espuma global com esse nome.' })
  items.push(item)
  writeStore(store)
  return res.status(201).json({ ok:true, item })
})

router.patch('/global-defaults/foams/:itemId', requireAuth, requireMaster, requirePermission('saas.companies.write'), (req, res) => {
  const store = readStore()
  const items = globalDefaultsCollection(store, 'foams')
  const index = findGlobalById(items, req.params.itemId)
  if(index < 0) return res.status(404).json({ error:'not_found', message:'Espuma global não encontrada.' })
  const item = cleanGlobalItem(req.body || {}, items[index], 'foam')
  if(!item.name) return res.status(400).json({ error:'invalid_request', message:'Informe o nome da espuma.' })
  if(hasDuplicateGlobalName(items, item.name, index)) return res.status(409).json({ error:'duplicate_name', message:'Já existe uma espuma global com esse nome.' })
  items[index] = item
  writeStore(store)
  return res.json({ ok:true, item })
})

router.delete('/global-defaults/foams/:itemId', requireAuth, requireMaster, requirePermission('saas.companies.write'), (req, res) => {
  const store = readStore()
  const items = globalDefaultsCollection(store, 'foams')
  const index = findGlobalById(items, req.params.itemId)
  if(index < 0) return res.status(404).json({ error:'not_found', message:'Espuma global não encontrada.' })
  const [removed] = items.splice(index, 1)
  writeStore(store)
  return res.json({ ok:true, removed })
})

router.post('/global-defaults/foams/:itemId/apply', requireAuth, requireMaster, requirePermission('saas.companies.write'), async (req, res, next) => {
  try{
    const store = readStore()
    const item = globalDefaultsCollection(store, 'foams').find(entry => String(entry.id) === String(req.params.itemId))
    if(!item) return res.status(404).json({ error:'not_found', message:'Espuma global não encontrada.' })
    const companyIds = selectedCompanyIds(store, req.body)
    if(!companyIds.length) return res.status(400).json({ error:'company_required', message:'Selecione pelo menos uma empresa.' })
    let companiesUpdated = 0
    let itemsAdded = 0
    for(const companyId of companyIds){
      const result = await personalizationDb.addCatalogItems(companyId, [{
        id:'global_' + String(item.id),
        name:item.name,
        unit:'metro linear',
        price_cents:0,
        category:'espuma',
        isAlbum:false,
        isGrupo:false
      }])
      if(Number(result.added || 0) > 0) companiesUpdated += 1
      itemsAdded += Number(result.added || 0)
    }
    return res.json({ ok:true, companies_selected:companyIds.length, companies_updated:companiesUpdated, items_added:itemsAdded })
  }catch(err){ next(err) }
})

router.get('/global-defaults/albums', requireAuth, requireMaster, requirePermission('saas.companies.read'), (req, res) => {
  const store = readStore()
  return res.json({ items: globalDefaultsCollection(store, 'albums') })
})

router.post('/global-defaults/albums', requireAuth, requireMaster, requirePermission('saas.companies.write'), (req, res) => {
  const store = readStore()
  const items = globalDefaultsCollection(store, 'albums')
  const item = cleanGlobalAlbum(req.body || {})
  if(!item.name) return res.status(400).json({ error:'invalid_request', message:'Informe o nome do álbum.' })
  if(hasDuplicateGlobalName(items, item.name)) return res.status(409).json({ error:'duplicate_name', message:'Já existe um álbum global com esse nome.' })
  items.push(item)
  writeStore(store)
  return res.status(201).json({ ok:true, item })
})

router.patch('/global-defaults/albums/:itemId', requireAuth, requireMaster, requirePermission('saas.companies.write'), (req, res) => {
  const store = readStore()
  const items = globalDefaultsCollection(store, 'albums')
  const index = findGlobalById(items, req.params.itemId)
  if(index < 0) return res.status(404).json({ error:'not_found', message:'Álbum global não encontrado.' })
  const item = cleanGlobalAlbum(req.body || {}, items[index])
  if(!item.name) return res.status(400).json({ error:'invalid_request', message:'Informe o nome do álbum.' })
  if(hasDuplicateGlobalName(items, item.name, index)) return res.status(409).json({ error:'duplicate_name', message:'Já existe um álbum global com esse nome.' })
  items[index] = item
  writeStore(store)
  return res.json({ ok:true, item })
})

router.delete('/global-defaults/albums/:itemId', requireAuth, requireMaster, requirePermission('saas.companies.write'), (req, res) => {
  const store = readStore()
  const items = globalDefaultsCollection(store, 'albums')
  const index = findGlobalById(items, req.params.itemId)
  if(index < 0) return res.status(404).json({ error:'not_found', message:'Álbum global não encontrado.' })
  const [removed] = items.splice(index, 1)
  writeStore(store)
  return res.json({ ok:true, removed })
})

router.post('/global-defaults/albums/:itemId/apply', requireAuth, requireMaster, requirePermission('saas.companies.write'), async (req, res, next) => {
  try{
    const store = readStore()
    const item = globalDefaultsCollection(store, 'albums').find(entry => String(entry.id) === String(req.params.itemId))
    if(!item) return res.status(404).json({ error:'not_found', message:'Álbum global não encontrado.' })
    const companyIds = selectedCompanyIds(store, req.body)
    if(!companyIds.length) return res.status(400).json({ error:'company_required', message:'Selecione pelo menos uma empresa.' })
    let companiesUpdated = 0
    let albumsAdded = 0
    for(const companyId of companyIds){
      const result = await personalizationDb.addCatalogAlbums(companyId, [{
        id:'global_' + String(item.id),
        nome:item.name,
        custo:0,
        unidade:'metro',
        itens:(item.fabrics || []).map(nome => ({ nome, codigo:'' }))
      }])
      if(Number(result.added || 0) > 0) companiesUpdated += 1
      albumsAdded += Number(result.added || 0)
    }
    return res.json({ ok:true, companies_selected:companyIds.length, companies_updated:companiesUpdated, albums_added:albumsAdded })
  }catch(err){ next(err) }
})

router.post('/companies/:companyId/actions', requireAuth, requireMaster, requirePermission('saas.companies.write'), (req, res) => {
  const store = readStore()
  const company = findCompanyById(store, req.params.companyId)
  if(!company) return res.status(404).json({ error:'company_not_found', message:'Empresa não encontrada.' })
  const action = String(req.body?.action || '').trim()
  const reason = String(req.body?.reason || req.body?.payload?.reason || '').trim()
  const payload = req.body?.payload || {}
  const before = JSON.parse(JSON.stringify(company))

  try {
    applyCompanyAction(company, action, payload)
  } catch (error) {
    return res.status(400).json({ error:'invalid_action', message:error.message })
  }

  upsertAudit(store, {
    company_id: company.id,
    action,
    message: payload.notes || `Ação ${action} executada no Master.`,
    actor_user_id: req.user.id,
    actor_name: req.user.name,
    actor_email: req.user.email,
    actor_role: req.user.role,
    reason,
    request_json: req.body || {},
    before_json: before,
    after_json: JSON.parse(JSON.stringify(company)),
    source: req.body?.audit?.source || 'master-ui',
    ip_address: req.ip,
    user_agent: req.headers['user-agent'] || ''
  })
  writeStore(store)
  res.json({ ok:true, company: materializeCompany(store, company) })
})

router.get('/companies/:companyId/audit', requireAuth, requireMaster, requirePermission('saas.audit.read'), (req, res) => {
  const store = readStore()
  const items = store.auditLogs
    .filter(item => String(item.company_id) === String(req.params.companyId))
    .map(item => ({
      id: item.id,
      action: item.action,
      message: item.message,
      actor_name: item.actor_name || item.actor || 'Sistema',
      actor_email: item.actor_email || '',
      actor_role: item.actor_role || '',
      created_at: item.created_at,
      reason: item.reason || ''
    }))
  res.json({ items })
})

router.get('/companies/:companyId/users', requireAuth, requireMaster, requirePermission('saas.companies.read'), (req, res) => {
  const store = readStore()
  const company = findCompanyById(store, req.params.companyId)
  if(!company) return res.status(404).json({ error:'company_not_found', message:'Empresa não encontrada.' })
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
        is_owner: Boolean(link.is_owner)
      }
    })
  res.json({ items: users })
})

router.post('/companies/:companyId/users/:userId/reset-password', requireAuth, requireMaster, requirePermission('saas.companies.write'), (req, res) => {
  const store = readStore()
  const company = findCompanyById(store, req.params.companyId)
  if(!company) return res.status(404).json({ error:'company_not_found', message:'Empresa não encontrada.' })
  const link = store.companyUsers.find(item => String(item.company_id) === String(company.id) && String(item.user_id) === String(req.params.userId))
  if(!link) return res.status(404).json({ error:'user_not_found', message:'Usuário não pertence a esta empresa.' })
  const user = store.users.find(item => String(item.id) === String(req.params.userId))
  if(!user) return res.status(404).json({ error:'user_not_found', message:'Usuário não encontrado.' })
  const newPassword = String(req.body?.password || '').trim()
  if(!newPassword || newPassword.length < 6) return res.status(400).json({ error:'invalid_request', message:'A nova senha deve ter pelo menos 6 caracteres.' })
  user.password_hash = bcrypt.hashSync(newPassword, 10)
  user.updated_at = nowIso()
  upsertAudit(store, {
    company_id: company.id,
    action: 'password_reset_by_master',
    message: `Senha redefinida pelo master para ${user.email}.`,
    actor_user_id: req.user.id,
    actor_name: req.user.name,
    actor_email: req.user.email,
    actor_role: req.user.role,
    source: 'master-password-reset'
  })
  writeStore(store)
  res.json({ ok:true, message:'Senha redefinida com sucesso.' })
})

router.delete('/users/:userId', requireAuth, requireMaster, requirePermission('saas.companies.write'), (req, res) => {
  const store = readStore()
  const userId = req.params.userId
  const userIdx = store.users.findIndex(u => String(u.id) === userId || String(u.email) === userId)
  if(userIdx === -1) return res.status(404).json({ error:'user_not_found', message:'Usuário não encontrado.' })
  const user = store.users[userIdx]
  store.users.splice(userIdx, 1)
  store.companyUsers = (store.companyUsers || []).filter(cu => String(cu.user_id) !== String(user.id))
  upsertAudit(store, {
    action: 'user_deleted_by_master',
    message: `Usuário ${user.email} removido pelo master.`,
    actor_user_id: req.user.id,
    actor_name: req.user.name,
    actor_email: req.user.email,
    actor_role: req.user.role,
    source: 'master-delete-user'
  })
  writeStore(store)
  res.json({ ok:true, message:`Usuário ${user.email} removido com sucesso.` })
})


router.delete('/companies/:companyId', requireAuth, requireMaster, requirePermission('saas.companies.write'), (req, res) => {
  const store = readStore()
  const companyId = req.params.companyId
  const companyIdx = store.companies.findIndex(c => String(c.id) === String(companyId))
  if (companyIdx === -1) return res.status(404).json({ error: 'company_not_found', message: 'Empresa não encontrada.' })
  const company = store.companies[companyIdx]

  const linkedUserIds = (store.companyUsers || [])
    .filter(cu => String(cu.company_id) === String(company.id))
    .map(cu => String(cu.user_id))

  store.companies.splice(companyIdx, 1)
  store.companyUsers = (store.companyUsers || []).filter(cu => String(cu.company_id) !== String(company.id))

  const remainingLinked = new Set((store.companyUsers || []).map(cu => String(cu.user_id)))
  store.users = (store.users || []).filter(u => {
    if (!linkedUserIds.includes(String(u.id))) return true
    return remainingLinked.has(String(u.id))
  })

  upsertAudit(store, {
    company_id: company.id,
    action: 'company_deleted_by_master',
    message: 'Empresa "' + (company.name || company.trade_name || companyId) + '" excluida pelo master.',
    actor_user_id: req.user.id,
    actor_name: req.user.name,
    actor_email: req.user.email,
    actor_role: req.user.role,
    source: 'master-delete-company'
  })

  writeStore(store)
  res.json({ ok: true, message: 'Empresa "' + (company.name || company.trade_name || companyId) + '" excluida com sucesso.' })
})

module.exports = router
