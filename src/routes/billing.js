const express = require('express')
const { v4: uuidv4 } = require('uuid')
const { readStore, writeStore, findCompanyById, upsertAudit, nowIso, planPreset } = require('../lib/store')
const { requireAuth, optionalAuth, requireMaster, requirePermission } = require('../middleware/auth')
const { hasMasterAccess } = require('../lib/policies')

const stripeSecretKey = process.env.STRIPE_SECRET_KEY
const stripe = stripeSecretKey ? require('stripe')(stripeSecretKey) : null

const router = express.Router()

function normalizeText(value, max = 160){
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max)
}

function looksLikeEmail(value){
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim())
}

function appBaseUrl(req){
  return process.env.APP_BASE_URL || `${req.protocol}://${req.get('host')}`
}

function getCompanyFromSession(store, req){
  if(hasMasterAccess(req.user) && req.query.company_id){
    return findCompanyById(store, req.query.company_id)
  }
  if(req.user?.company_id) return findCompanyById(store, req.user.company_id)
  return null
}

function buildSubscriptionPayload(company, store, req){
  const cfg = store.billingConfig || {}
  if(!company){
    return {
      subscription: {
        status: cfg.enabled === false ? 'inactive' : 'trialing',
        payment_provider: cfg.payment_provider || 'stripe',
        trial_days: Number(cfg.trial_days || 30),
        checkout_url: cfg.payment_link || '',
        payment_link: cfg.payment_link || '',
        customer_portal_available: false,
        webhooks_ok: store.webhookEvents.length > 0 ? true : null,
        webhook_status: store.webhookEvents.length > 0 ? 'Operando' : 'Aguardando primeiro webhook'
      }
    }
  }

  return {
    subscription: {
      company_id: company.id,
      status: company.financial_status || 'inactive',
      financial_status: company.financial_status || 'inactive',
      access_status: company.access_status || 'inactive',
      payment_provider: cfg.payment_provider || company.billing_mode || 'stripe',
      next_charge_at: company.next_charge_at || '',
      grace_until: company.manual_grace_until || '',
      trial_days: Number(cfg.trial_days || 30),
      checkout_url: cfg.payment_link || `${appBaseUrl(req)}/checkout-simulado?company=${encodeURIComponent(company.id)}`,
      payment_link: cfg.payment_link || `${appBaseUrl(req)}/checkout-simulado?company=${encodeURIComponent(company.id)}`,
      customer_portal_available: Boolean(company.stripe_customer_id || company.stripe_subscription_id || company.billing_mode === 'stripe'),
      customer_portal_url: `${appBaseUrl(req)}/portal-cliente?company=${encodeURIComponent(company.id)}`,
      webhooks_ok: store.webhookEvents.length > 0 ? true : null,
      webhook_status: store.webhookEvents.length > 0 ? 'Operando' : 'Aguardando primeiro webhook'
    }
  }
}

function getVisibleLeads(store, req){
  if(hasMasterAccess(req.user)) return store.billingLeads
  if(req.user?.company_id){
    return store.billingLeads.filter(item => String(item.company_id || '') === String(req.user.company_id || ''))
  }
  return []
}

function buildLeadPayload(lead, checkoutUrl, company, cfg){
  return {
    checkout_url: checkoutUrl,
    url: checkoutUrl,
    lead,
    subscription: {
      status: company?.financial_status || 'trialing',
      trial_days: Number(cfg.trial_days || 30),
      payment_provider: cfg.payment_provider || 'stripe',
      checkout_url: checkoutUrl,
      payment_link: checkoutUrl,
      customer_portal_available: Boolean(company)
    }
  }
}

function handleCheckout(req, res){
  const store = readStore()
  const payload = req.body || {}
  const cfg = store.billingConfig || {}
  const plan = planPreset(payload.plan_code || cfg.default_plan_code || 'gestao')
  const leadId = uuidv4()
  const company = getCompanyFromSession(store, req)
  const cleanName = normalizeText(payload.name, 120)
  const cleanBusinessName = normalizeText(payload.business_name || company?.name, 120)
  const cleanEmail = String(payload.email || '').trim().toLowerCase()
  const cleanWhatsapp = normalizeText(payload.whatsapp, 40)
  const billingCycle = String(payload.billing_cycle || 'monthly').toLowerCase() === 'annual' ? 'annual' : 'monthly'
  const acceptedTerms = Boolean(payload.accepted_terms)
  if(!acceptedTerms){
    return res.status(400).json({ error:'terms_required', message:'Confirme o aceite dos termos para continuar.' })
  }
  if(cleanEmail && !looksLikeEmail(cleanEmail)){
    return res.status(400).json({ error:'invalid_request', message:'Informe um e-mail válido para a cobrança.' })
  }
  if(!company && !cleanName){
    return res.status(400).json({ error:'invalid_request', message:'Informe o nome do responsável para solicitar a assinatura.' })
  }
  const lead = {
    id: leadId,
    name: cleanName || company?.owner_name || 'Lead sem nome',
    email: cleanEmail,
    whatsapp: cleanWhatsapp,
    business_name: cleanBusinessName || company?.name || '',
    company_id: company?.id || '',
    company_name: company?.name || cleanBusinessName || '',
    plan_code: plan.code,
    plan_name: normalizeText(payload.plan_name || plan.name, 120) || plan.name,
    billing_cycle: billingCycle,
    accepted_terms: acceptedTerms,
    status: 'novo',
    source: normalizeText(payload.source || 'assinatura-ui', 80) || 'assinatura-ui',
    created_at: nowIso()
  }
  store.billingLeads.unshift(lead)

  if(company){
    company.plan_code = plan.code
    company.plan_name = payload.plan_name || plan.name
    company.monthly_price_cents = plan.monthly_price_cents
    company.seats_limit = plan.seats_limit
    company.billing_mode = 'stripe'
    company.financial_status = company.financial_status === 'active' ? 'active' : 'trialing'
    company.access_status = 'active'
    company.next_charge_at = new Date(Date.now() + Number(cfg.trial_days || 30) * 86400000).toISOString()
    if(!company.trial_ends_at) company.trial_ends_at = company.next_charge_at

    upsertAudit(store, {
      company_id: company.id,
      action: 'checkout_created',
      message: `Checkout server-side criado para ${company.name}.`,
      actor_user_id: req.user?.id || '',
      actor_name: req.user?.name || cleanName || 'Lead',
      actor_email: req.user?.email || cleanEmail || '',
      actor_role: req.user?.role || 'lead',
      reason: 'billing_checkout',
      request_json: { ...payload, accepted_terms: acceptedTerms },
      after_json: JSON.parse(JSON.stringify(company)),
      source: payload.source || 'assinatura-ui',
      ip_address: req.ip,
      user_agent: req.headers['user-agent'] || ''
    })
  }

  writeStore(store)
  const checkoutUrl = cfg.payment_link || `${appBaseUrl(req)}/checkout-simulado?lead=${encodeURIComponent(leadId)}&plan=${encodeURIComponent(plan.code)}`
  res.status(201).json(buildLeadPayload(lead, checkoutUrl, company, cfg))
}

router.get('/public', (req, res) => {
  const store = readStore()
  res.json(store.billingConfig)
})

router.get('/config', requireAuth, requireMaster, requirePermission('billing.read'), (req, res) => {
    const store = readStore()
    res.json(store.billingConfig || {})
  })

  router.put('/config', requireAuth, requireMaster, requirePermission('billing.write'), (req, res) => {
  const store = readStore()
  store.billingConfig = {
    ...store.billingConfig,
    ...req.body,
    updated_at: nowIso(),
    updated_by: req.user.email
  }
  writeStore(store)
  res.json(store.billingConfig)
})

router.get('/leads', requireAuth, requireMaster, requirePermission('billing.read'), (req, res) => {
  const store = readStore()
  res.json({ items: store.billingLeads })
})

router.get('/checkout-requests', requireAuth, (req, res) => {
  const store = readStore()
  res.json(getVisibleLeads(store, req))
})

router.get('/', requireAuth, (req, res) => {
  const store = readStore()
  const company = getCompanyFromSession(store, req)
  res.json(buildSubscriptionPayload(company, store, req))
})

router.get('/subscription', requireAuth, (req, res) => {
  const store = readStore()
  const company = getCompanyFromSession(store, req)
  res.json(buildSubscriptionPayload(company, store, req))
})

router.post('/checkout', optionalAuth, handleCheckout)
router.post('/checkout-request', optionalAuth, handleCheckout)

router.post('/customer-portal', requireAuth, (req, res) => {
  const store = readStore()
  const company = getCompanyFromSession(store, req)
  if(!company) return res.status(404).json({ error:'company_not_found', message:'Empresa não encontrada para esta sessão.' })
  const portalUrl = `${appBaseUrl(req)}/portal-cliente?company=${encodeURIComponent(company.id)}&return_url=${encodeURIComponent(req.body?.return_url || '')}`
  res.json({ url: portalUrl, customer_portal_url: portalUrl })
})

router.post('/stripe/create-checkout', requireAuth, async (req, res) => {
  if(!stripe) return res.status(503).json({ error:'stripe_not_configured', message:'Stripe não configurado.' })
  const store = readStore()
  const company = getCompanyFromSession(store, req)
  if(!company) return res.status(404).json({ error:'company_not_found', message:'Empresa não encontrada.' })
  const priceId = process.env.STRIPE_PRICE_ID
  if(!priceId) return res.status(503).json({ error:'price_not_configured', message:'Plano não configurado.' })
  const frontendUrl = process.env.FRONTEND_URL || 'https://estofaria-digital.pages.dev'
  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card', 'boleto'],
      payment_method_options: {
        boleto: { expires_after_days: 3 }
      },
      line_items: [{ price: priceId, quantity: 1 }],
      metadata: { company_id: String(company.id) },
      customer_email: company.owner_email || req.user?.email || undefined,
      success_url: `${frontendUrl}/assinatura/?sucesso=1`,
      cancel_url: `${frontendUrl}/assinatura/?cancelado=1`,
      locale: 'pt-BR'
    })
    res.json({ url: session.url, session_id: session.id })
  } catch(err) {
    res.status(500).json({ error:'stripe_error', message: err.message })
  }
})

router.post('/webhooks/stripe', express.raw({ type: 'application/json' }), (req, res) => {
  const store = readStore()
  let event
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET
  if(stripe && webhookSecret){
    try {
      event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], webhookSecret)
    } catch(err) {
      return res.status(400).json({ error:'invalid_signature', message: err.message })
    }
  } else {
    event = req.body || {}
  }
  const eventId = String(event.id || '')
  if(!eventId) return res.status(400).json({ error:'invalid_event', message:'Evento sem id.' })
  if(store.webhookEvents.some(item => String(item.id) === eventId)) return res.json({ ok:true, duplicate:true })

  const record = {
    id: eventId,
    type: String(event.type || 'unknown'),
    created_at: nowIso(),
    payload: event,
    status: 'processed'
  }
  store.webhookEvents.push(record)

  const obj = event.data?.object || {}
  const companyId = obj.metadata?.company_id || event.company_id || ''
  const company = companyId ? findCompanyById(store, companyId) : null
  if(company){
    const type = record.type
    if(type === 'checkout.session.completed'){
      const stripeCustomerId = obj.customer || ''
      const stripeSubId = obj.subscription || ''
      if(stripeCustomerId) company.stripe_customer_id = stripeCustomerId
      if(stripeSubId) company.stripe_subscription_id = stripeSubId
      company.financial_status = 'trialing'
      company.access_status = 'active'
    }
    if(type === 'invoice.paid'){
      company.financial_status = 'active'
      company.access_status = 'active'
      company.last_payment_at = nowIso()
      company.manual_grace_until = ''
    }
    if(type === 'invoice.payment_failed'){
      company.financial_status = 'past_due'
      company.access_status = company.manual_grace_until ? 'manual_grace' : 'active'
    }
    if(type === 'customer.subscription.deleted'){
      company.financial_status = 'canceled'
      company.access_status = 'blocked'
    }
    if(type === 'customer.subscription.updated'){
      const status = String(event.data?.object?.status || '').toLowerCase()
      if(status) company.financial_status = status
      if(['active','trialing'].includes(status)) company.access_status = 'active'
      if(['past_due'].includes(status)) company.access_status = company.manual_grace_until ? 'manual_grace' : 'active'
      if(['unpaid','canceled','incomplete_expired'].includes(status)) company.access_status = 'blocked'
    }
    company.updated_at = nowIso()
    upsertAudit(store, {
      company_id: company.id,
      action: 'billing_webhook',
      message: `Webhook ${record.type} processado no servidor.`,
      actor_name: 'stripe-webhook',
      actor_email: 'stripe@webhook',
      actor_role: 'system',
      reason: record.type,
      request_json: event,
      after_json: JSON.parse(JSON.stringify(company)),
      source: 'billing-webhook'
    })
  }

  writeStore(store)
  res.json({ ok:true })
})

module.exports = router
