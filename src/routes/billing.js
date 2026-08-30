'use strict'

const express = require('express')
const { v4: uuidv4 } = require('uuid')
const { readStore, writeStore, findCompanyById, upsertAudit, nowIso } = require('../lib/store')
const { requireAuth, optionalAuth, requireMaster, requirePermission } = require('../middleware/auth')
const { hasMasterAccess } = require('../lib/policies')
const {
  PLAN_CATALOG,
  TRIAL_DAYS,
  getPlanDefinition,
  validateStripePrice,
  resolveCompanyForStripeEvent,
  publicBillingConfig,
  normalizeId
} = require('../lib/billing-readiness')

const stripeSecretKey = String(process.env.STRIPE_SECRET_KEY || '').trim()
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

function frontendBaseUrl(){
  return String(process.env.FRONTEND_URL || process.env.APP_URL || 'https://estofaria-digital.pages.dev').replace(/\/$/, '')
}

function stripeMode(){
  if(stripeSecretKey.startsWith('sk_test_')) return 'test'
  if(stripeSecretKey.startsWith('sk_live_')) return 'live'
  return stripeSecretKey ? 'unknown' : 'not_configured'
}

function ensureStripeModeAllowed(){
  if(String(process.env.REQUIRE_STRIPE_TEST_MODE || '').toLowerCase() === 'true' && stripeMode() !== 'test'){
    const error = new Error('O ambiente de teste exige uma chave Stripe de teste.')
    error.code = 'stripe_test_mode_required'
    throw error
  }
}

function getCompanyFromSession(store, req){
  if(hasMasterAccess(req.user) && req.query.company_id){
    return findCompanyById(store, req.query.company_id)
  }
  if(req.user?.company_id) return findCompanyById(store, req.user.company_id)
  return null
}

function getPriceId(store, planCode){
  return process.env[`STRIPE_PRICE_ID_${String(planCode).toUpperCase()}`]
    || process.env.STRIPE_PRICE_ID
    || (store.billingConfig?.stripe_prices || {})[planCode]
    || store.billingConfig?.stripe_price_id
    || ''
}

function buildSubscriptionPayload(company, store, req){
  const cfg = publicBillingConfig(store.billingConfig || {})
  if(!company){
    return {
      subscription: {
        status: cfg.enabled === false ? 'inactive' : 'trialing',
        payment_provider: 'stripe',
        trial_days: TRIAL_DAYS,
        checkout_url: '',
        payment_link: '',
        customer_portal_available: false,
        stripe_mode: stripeMode(),
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
      payment_provider: 'stripe',
      next_charge_at: company.next_charge_at || '',
      grace_until: company.manual_grace_until || '',
      trial_ends_at: company.trial_ends_at || '',
      trial_days: TRIAL_DAYS,
      checkout_url: '',
      payment_link: '',
      customer_portal_available: Boolean(company.stripe_customer_id),
      customer_portal_url: '',
      stripe_mode: stripeMode(),
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

function buildLeadPayload(lead, checkoutUrl, company){
  return {
    checkout_url: checkoutUrl,
    url: checkoutUrl,
    lead,
    subscription: {
      status: company?.financial_status || 'trialing',
      trial_days: TRIAL_DAYS,
      payment_provider: 'stripe',
      checkout_url: checkoutUrl,
      payment_link: checkoutUrl,
      customer_portal_available: Boolean(company?.stripe_customer_id)
    }
  }
}

function handleCheckout(req, res){
  const store = readStore()
  const payload = req.body || {}
  const plan = getPlanDefinition(payload.plan_code || store.billingConfig?.default_plan_code || 'gestao')
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
    plan_name: plan.name,
    billing_cycle: billingCycle,
    accepted_terms: acceptedTerms,
    status: 'novo',
    source: normalizeText(payload.source || 'assinatura-ui', 80) || 'assinatura-ui',
    created_at: nowIso()
  }
  store.billingLeads.unshift(lead)

  if(company){
    company.plan_code = plan.code
    company.plan_name = plan.name
    company.monthly_price_cents = plan.monthly_price_cents
    company.seats_limit = plan.seats_limit
    company.billing_mode = 'stripe'
    company.updated_at = nowIso()
    upsertAudit(store, {
      company_id: company.id,
      action: 'checkout_created',
      message: `Solicitação de checkout criada para ${company.name}.`,
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
  res.status(201).json(buildLeadPayload(lead, '', company))
}

router.get('/public', (req, res) => {
  const store = readStore()
  const cfg = publicBillingConfig(store.billingConfig || {})
  res.json({
    ...cfg,
    stripe_mode: stripeMode(),
    stripe_checkout_configured: Boolean(stripe && getPriceId(store, 'gestao') && getPriceId(store, 'empresarial')),
    webhook_configured: Boolean(process.env.STRIPE_WEBHOOK_SECRET)
  })
})

router.get('/config', requireAuth, requireMaster, requirePermission('billing.read'), (req, res) => {
  const store = readStore()
  res.json(publicBillingConfig(store.billingConfig || {}))
})

router.put('/config', requireAuth, requireMaster, requirePermission('billing.write'), (req, res) => {
  const store = readStore()
  store.billingConfig = {
    ...store.billingConfig,
    ...req.body,
    trial_days: TRIAL_DAYS,
    payment_provider: 'stripe',
    updated_at: nowIso(),
    updated_by: req.user.email
  }
  writeStore(store)
  res.json(publicBillingConfig(store.billingConfig))
})

router.get('/leads', requireAuth, requireMaster, requirePermission('billing.read'), (req, res) => {
  const store = readStore()
  res.json({ items: store.billingLeads })
})

router.get('/checkout-requests', requireAuth, (req, res) => {
  const store = readStore()
  res.json(getVisibleLeads(store, req))
})

function subscriptionStatusHandler(req, res){
  const store = readStore()
  const company = getCompanyFromSession(store, req)
  res.json(buildSubscriptionPayload(company, store, req))
}

router.get('/', requireAuth, subscriptionStatusHandler)
router.get('/subscription', requireAuth, subscriptionStatusHandler)
router.get('/status', requireAuth, subscriptionStatusHandler)

router.post('/checkout', optionalAuth, handleCheckout)
router.post('/checkout-request', optionalAuth, handleCheckout)

router.post('/customer-portal', requireAuth, async (req, res) => {
  if(!stripe) return res.status(503).json({ error:'stripe_not_configured', message:'Stripe não configurado.' })
  try {
    ensureStripeModeAllowed()
    const store = readStore()
    const company = getCompanyFromSession(store, req)
    if(!company) return res.status(404).json({ error:'company_not_found', message:'Empresa não encontrada para esta sessão.' })
    if(!company.stripe_customer_id){
      return res.status(409).json({ error:'stripe_customer_missing', message:'A empresa ainda não possui um cliente Stripe vinculado.' })
    }
    const session = await stripe.billingPortal.sessions.create({
      customer: company.stripe_customer_id,
      return_url: `${frontendBaseUrl()}/assinatura/`
    })
    res.json({ url: session.url, customer_portal_url: session.url })
  } catch(err) {
    res.status(500).json({ error: err.code || 'stripe_portal_error', message: err.message })
  }
})

router.post('/stripe/create-checkout', requireAuth, async (req, res) => {
  if(!stripe) return res.status(503).json({ error:'stripe_not_configured', message:'Stripe não configurado.' })
  try {
    ensureStripeModeAllowed()
    const store = readStore()
    const company = getCompanyFromSession(store, req)
    if(!company) return res.status(404).json({ error:'company_not_found', message:'Empresa não encontrada.' })

    const requestedPlanCode = String(req.body?.plan_code || company.plan_code || store.billingConfig?.default_plan_code || 'gestao').toLowerCase()
    const plan = PLAN_CATALOG[requestedPlanCode]
    if(!plan) return res.status(400).json({ error:'invalid_plan', message:'Plano inválido.' })

    const priceId = getPriceId(store, plan.code)
    if(!priceId) return res.status(503).json({ error:'price_not_configured', message:`Price ID do ${plan.name} não configurado.` })
    const stripePrice = await stripe.prices.retrieve(priceId)
    validateStripePrice(stripePrice, plan)

    let customerId = String(company.stripe_customer_id || '')
    if(!customerId){
      const customer = await stripe.customers.create({
        email: company.owner_email || req.user?.email || undefined,
        name: company.name || undefined,
        metadata: { company_id: String(company.id) }
      })
      customerId = customer.id
      company.stripe_customer_id = customerId
    }

    company.plan_code = plan.code
    company.plan_name = plan.name
    company.monthly_price_cents = plan.monthly_price_cents
    company.seats_limit = plan.seats_limit
    company.billing_mode = 'stripe'
    company.updated_at = nowIso()
    writeStore(store)

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      payment_method_collection: 'always',
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      subscription_data: {
        trial_period_days: TRIAL_DAYS,
        metadata: { company_id: String(company.id), plan_code: plan.code },
        trial_settings: { end_behavior: { missing_payment_method: 'cancel' } }
      },
      metadata: { company_id: String(company.id), plan_code: plan.code },
      success_url: `${frontendBaseUrl()}/assinatura/?sucesso=1`,
      cancel_url: `${frontendBaseUrl()}/assinatura/?cancelado=1`,
      locale: 'pt-BR'
    })
    res.json({ url: session.url, session_id: session.id, stripe_mode: stripeMode() })
  } catch(err) {
    const code = err.code || (String(err.message || '').includes('Valor incorreto') ? 'stripe_price_mismatch' : 'stripe_error')
    res.status(code === 'stripe_price_mismatch' ? 409 : 500).json({ error: code, message: err.message })
  }
})

router.post('/webhooks/stripe', express.raw({ type: 'application/json' }), (req, res) => {
  const store = readStore()
  const webhookSecret = String(process.env.STRIPE_WEBHOOK_SECRET || '').trim()
  if(!stripe || !webhookSecret){
    return res.status(503).json({ error:'stripe_webhook_not_configured', message:'Webhook Stripe não configurado no servidor.' })
  }

  let event
  try {
    ensureStripeModeAllowed()
    event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], webhookSecret)
  } catch(err) {
    return res.status(400).json({ error: err.code || 'invalid_signature', message: err.message })
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
  const company = resolveCompanyForStripeEvent(store, obj, event)
  if(company){
    const type = record.type
    const stripeCustomerId = normalizeId(obj.customer)
    const stripeSubId = normalizeId(obj.subscription) || (type.startsWith('customer.subscription.') ? normalizeId(obj.id) : '')
    if(stripeCustomerId) company.stripe_customer_id = stripeCustomerId
    if(stripeSubId) company.stripe_subscription_id = stripeSubId

    if(type === 'checkout.session.completed'){
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
    if(type === 'customer.subscription.updated' || type === 'customer.subscription.created'){
      const status = String(obj.status || '').toLowerCase()
      if(status) company.financial_status = status
      if(['active','trialing'].includes(status)) company.access_status = 'active'
      if(status === 'past_due') company.access_status = company.manual_grace_until ? 'manual_grace' : 'active'
      if(['unpaid','canceled','incomplete_expired'].includes(status)) company.access_status = 'blocked'
      if(obj.trial_end) company.trial_ends_at = new Date(Number(obj.trial_end) * 1000).toISOString()
      if(obj.current_period_end) company.next_charge_at = new Date(Number(obj.current_period_end) * 1000).toISOString()
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
      request_json: { id: event.id, type: event.type },
      after_json: JSON.parse(JSON.stringify(company)),
      source: 'billing-webhook'
    })
  } else {
    record.status = 'ignored_company_not_found'
  }

  writeStore(store)
  res.json({ ok:true, company_found:Boolean(company) })
})

module.exports = router
