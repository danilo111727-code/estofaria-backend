const express = require('express')
const { readStore, writeStore, materializeCompany, findCompanyById, upsertAudit, nowIso, planPreset } = require('../lib/store')
const { requireAuth, requireMaster, requirePermission } = require('../middleware/auth')

const router = express.Router()

function applyCompanyAction(company, action, payload){
  const plan = planPreset(payload.plan_code || company.plan_code)
  switch(action){
    case 'courtesy':
      company.billing_mode = 'courtesy'
      company.access_status = 'courtesy_active'
      company.financial_status = 'active'
      company.courtesy_until = payload.courtesy_until || payload.until || ''
      break
    case 'endCourtesy':
      company.billing_mode = 'stripe'
      company.access_status = 'active'
      company.courtesy_until = ''
      break
    case 'toPaid':
      company.billing_mode = 'stripe'
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
      company.access_status = 'active'
      company.financial_status = 'active'
      break
    default:
      throw new Error('Ação administrativa inválida.')
  }
  if(typeof payload.notes === 'string') company.notes = payload.notes
  company.updated_at = nowIso()
}

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

module.exports = router
