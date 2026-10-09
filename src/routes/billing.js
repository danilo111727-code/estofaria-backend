const express = require('express')
const { v4: uuidv4 } = require('uuid')
const { readStore, writeStore, findCompanyById, upsertAudit, nowIso, planPreset } = require('../lib/store')
const { requireAuth, optionalAuth, requireMaster, requirePermission } = require('../middleware/auth')
const { hasMasterAccess } = require('../lib/policies')

const stripeSecretKey = process.env.STRIPE_SECRET_KEY
const stripe = stripeSecretKey ? require('stripe')(stripeSecretKey, { timeout:5000, maxNetworkRetries:0 }) : null

const router = express.Router()

// Serialize operations for one company in this process. Stripe idempotency keys
// also protect retries after a timeout/restart; this store remains single-writer.
const billingQueues = new Map()
async function withCompanyLock(id, operation){
  const previous = billingQueues.get(id) || Promise.resolve()
  const current = previous.catch(() => {}).then(operation)
  billingQueues.set(id, current)
  try { return await current } finally {
    if(billingQueues.get(id) === current) billingQueues.delete(id)
  }
}
function stripeId(value){ return typeof value === 'string' ? value : String(value?.id || '') }
function subscriptionId(obj){
  return stripeId(obj.subscription || obj.parent?.subscription_details?.subscription
    || (obj.object === 'subscription' ? obj.id : ''))
}
function courtesyActive(company){
  if(!company || company.billing_mode !== 'courtesy' || company.access_status !== 'courtesy_active') return false
  return !company.courtesy_until || Date.parse(company.courtesy_until) > Date.now()
}
function updateSubscription(company, subscription){
  company.stripe_customer_id = stripeId(subscription.customer)
  company.stripe_subscription_id = subscription.id
  company.financial_status = subscription.status
  if(!courtesyActive(company)){
    company.billing_mode = 'stripe'
    const status = subscription.status
    if(['active','trialing'].includes(status)) company.access_status = 'active'
    else if(status === 'past_due') company.access_status = Date.parse(company.manual_grace_until) > Date.now() ? 'manual_grace' : 'active'
    else company.access_status = 'blocked'
  }
  const periodEnd = subscription.current_period_end || subscription.items?.data?.[0]?.current_period_end
  const next = subscription.status === 'trialing' ? subscription.trial_end : periodEnd
  company.next_charge_at = next ? new Date(Number(next) * 1000).toISOString() : ''
  company.trial_ends_at = subscription.trial_end ? new Date(Number(subscription.trial_end) * 1000).toISOString() : ''
  company.updated_at = nowIso()
}
async function listAll(method, params){
  const result = []
  let after
  do {
    const page = await method({ ...params, limit:100, ...(after ? {starting_after:after} : {}) })
    result.push(...page.data)
    if(!page.has_more) break
    if(!page.data.length) throw new Error('Stripe pagination returned an empty page')
    after = page.data[page.data.length - 1].id
  } while(true)
  return result
}
function saveCompanyFields(id, fields){
  // Never write a snapshot obtained before awaiting a Stripe API request.
  const latest = readStore()
  const company = findCompanyById(latest, id)
  if(!company) throw new Error('Company no longer exists')
  Object.assign(company, fields)
  writeStore(latest)
  return company
}

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

function expireCourtesyIfNeeded(store, company){
  if(!company) return false
  const accessStatus = String(company.access_status || '').toLowerCase()
  const billingMode = String(company.billing_mode || '').toLowerCase()
  if(accessStatus !== 'courtesy_active' && billingMode !== 'courtesy') return false

  const courtesyUntil = String(company.courtesy_until || '').trim()
  if(!courtesyUntil) return false
  const courtesyUntilMs = new Date(courtesyUntil).getTime()
  if(!Number.isFinite(courtesyUntilMs) || courtesyUntilMs > Date.now()) return false

  const before = JSON.parse(JSON.stringify(company))
  company.billing_mode = 'stripe'
  const linkedAndValid = Boolean(company.stripe_subscription_id && ['active', 'trialing'].includes(String(company.financial_status || '').toLowerCase()))
  company.financial_status = linkedAndValid ? company.financial_status : 'pending_payment'
  company.access_status = linkedAndValid ? 'active' : 'pending_payment'
  company.professional_courtesy_enabled = false
  company.courtesy_expired_at = nowIso()
  company.updated_at = nowIso()

  upsertAudit(store, {
    company_id: company.id,
    action: 'courtesy_expired',
    message: 'Cortesia automática de 60 dias encerrada. Assinatura necessária para continuar.',
    actor_name: 'system',
    actor_email: 'system@estofariadigital',
    actor_role: 'system',
    reason: 'automatic_courtesy_expiration',
    before_json: before,
    after_json: JSON.parse(JSON.stringify(company)),
    source: 'billing'
  })
  writeStore(store)
  return true
}

function professionalCourtesyActive(company){
  if(!company || company.professional_courtesy_enabled !== true) return false
  if(String(company.billing_mode || '') !== 'courtesy' || String(company.access_status || '') !== 'courtesy_active') return false
  const until = String(company.courtesy_until || '').trim()
  if(!until) return true
  const end = Date.parse(until)
  return Number.isFinite(end) && end > Date.now()
}

function professionalSubscriptionActive(company){
  return !!(company && String(company.billing_mode || '') === 'stripe'
    && company.stripe_subscription_id
    && String(company.access_status || '') === 'active'
    && ['active','trialing'].includes(String(company.financial_status || '').toLowerCase()))
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
      professional_courtesy_enabled: professionalCourtesyActive(company),
      professional_available: professionalSubscriptionActive(company) || professionalCourtesyActive(company),
      payment_provider: cfg.payment_provider || company.billing_mode || 'stripe',
      next_charge_at: company.next_charge_at || '',
      grace_until: company.manual_grace_until || '',
      courtesy_started_at: company.courtesy_started_at || '',
      courtesy_until: company.courtesy_until || '',
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
    if(!courtesyActive(company)) company.billing_mode = 'stripe'
    // access_status e financial_status só são atualizados pelo webhook Stripe,
    // nunca pelo simples preenchimento do formulário de checkout.

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
  expireCourtesyIfNeeded(store, company)
  res.json(buildSubscriptionPayload(company, store, req))
})

router.get(['/subscription','/status'], requireAuth, (req, res) => {
  const store = readStore()
  const company = getCompanyFromSession(store, req)
  expireCourtesyIfNeeded(store, company)
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
  const initial = getCompanyFromSession(readStore(), req)
  if(!initial) return res.status(404).json({ error:'company_not_found', message:'Empresa não encontrada.' })
  try {
    return await withCompanyLock(String(initial.id), async () => {
      const store = readStore()
      let company = findCompanyById(store, initial.id)
      if(!company) return res.status(404).json({ error:'company_not_found' })
      if(company.stripe_subscription_id){
        return res.status(409).json({ error:'subscription_already_linked', message:'Consulte a assinatura existente antes de contratar novamente.' })
      }
      const planCode = (company.plan_code || store.billingConfig?.default_plan_code || 'gestao').toLowerCase()
      const priceId = process.env[`STRIPE_PRICE_ID_${planCode.toUpperCase()}`] || process.env.STRIPE_PRICE_ID
        || (store.billingConfig?.stripe_prices || {})[planCode] || store.billingConfig?.stripe_price_id
      if(!priceId) return res.status(503).json({ error:'price_not_configured' })
      const courtesyEnd = Date.parse(String(company.courtesy_until || ''))
      const trialEnd = Number.isFinite(courtesyEnd) && courtesyEnd > Date.now() ? Math.ceil(courtesyEnd / 1000) : null
      // Checkout requires at least 48 hours. Never discard the remaining courtesy
      // or extend the agreed date to work around that Stripe restriction.
      if(trialEnd && trialEnd - Date.now()/1000 < 172860){
        return res.status(409).json({ error:'courtesy_ending', retry_at:company.courtesy_until,
          message:'Sua cortesia continua ativa. Contrate ao encerrar o período para evitar cobrança antecipada.' })
      }
      let customerId = stripeId(company.stripe_customer_id)
      if(!customerId && company.owner_email){
        // Email is only a lookup hint, never proof of company ownership.
        const candidates = await listAll(p => stripe.customers.list(p), {email:company.owner_email})
        const owned = candidates.filter(c => String(c.metadata?.company_id || '') === String(company.id))
        if(owned.length === 1){
          customerId = owned[0].id
          company = saveCompanyFields(company.id, {stripe_customer_id:customerId})
        } else if(candidates.length){
          return res.status(409).json({error:'customer_link_required',message:'Cadastro Stripe anterior encontrado. O suporte deve verificar o vínculo antes de uma nova contratação.'})
        }
      }
      if(!customerId){
        const customer = await stripe.customers.create({ email:company.owner_email || undefined,
          metadata:{company_id:String(company.id)} }, {idempotencyKey:`company-customer-v1:${company.id}`})
        customerId = customer.id
        company = saveCompanyFields(company.id, {stripe_customer_id:customerId})
      }
      const subscriptions = await listAll(p => stripe.subscriptions.list(p), {customer:customerId,status:'all'})
      if(subscriptions.some(sub => !['canceled','incomplete_expired'].includes(sub.status))){
        return res.status(409).json({ error:'existing_stripe_subscription', message:'Já existe assinatura neste cadastro Stripe. Contate o suporte para vinculá-la.' })
      }
      let previousSession
      if(company.stripe_checkout_session_id){
        previousSession = await stripe.checkout.sessions.retrieve(company.stripe_checkout_session_id)
        if(previousSession.status === 'complete') return res.status(409).json({error:'checkout_already_completed'})
        if(previousSession.status === 'open') return res.json({url:previousSession.url,session_id:previousSession.id})
      }
      const openSessions = await listAll(p => stripe.checkout.sessions.list(p), {customer:customerId,status:'open'})
      const open = openSessions.find(s => s.mode === 'subscription' && String(s.metadata?.company_id || '') === String(company.id))
      if(open){
        saveCompanyFields(company.id, {stripe_checkout_session_id:open.id})
        return res.json({url:open.url,session_id:open.id})
      }
      const frontendUrl = process.env.FRONTEND_URL || 'https://estofaria-digital.pages.dev'
      const params = {
        mode:'subscription', payment_method_collection:'always',
        customer:customerId, line_items:[{price:priceId,quantity:1}],
        subscription_data:{metadata:{company_id:String(company.id)}, ...(trialEnd ? {
          trial_end:trialEnd, trial_settings:{end_behavior:{missing_payment_method:'cancel'}}
        } : {})},
        metadata:{company_id:String(company.id)},
        success_url:`${frontendUrl}/stripe-retorno/?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url:`${frontendUrl}/stripe-retorno/?cancelado=1`, locale:'pt-BR'
      }
      const generation = previousSession?.id || 'initial'
      const session = await stripe.checkout.sessions.create(params, {
        idempotencyKey:`company-checkout-v2:${company.id}:${generation}:${priceId}:${trialEnd || 'no-trial'}`
      })
      saveCompanyFields(company.id, {stripe_checkout_session_id:session.id})
      return res.json({url:session.url,session_id:session.id})
    })
  } catch(err) {
    return res.status(500).json({error:'stripe_error',message:err.message})
  }
})

router.post('/stripe/confirm-checkout', requireAuth, async (req, res) => {
  if(!stripe) return res.status(503).json({ error:'stripe_not_configured', message:'Stripe não configurado.' })
  try {
    const sessionId = String(req.body?.session_id || '').trim()
    if(!sessionId.startsWith('cs_')){
      return res.status(400).json({ error:'invalid_session', message:'Sessão Stripe inválida.' })
    }

    const store = readStore()
    const company = getCompanyFromSession(store, req)
    if(!company) return res.status(404).json({ error:'company_not_found', message:'Empresa não encontrada.' })

    const session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ['subscription'] })
    const sessionCompanyId = String(session.metadata?.company_id || '')
    if(!sessionCompanyId || sessionCompanyId !== String(company.id)){
      return res.status(403).json({ error:'session_company_mismatch', message:'Esta sessão não pertence à empresa autenticada.' })
    }
    if(session.mode !== 'subscription' || session.status !== 'complete'){
      return res.status(409).json({ error:'checkout_not_complete', message:'O checkout ainda não foi concluído na Stripe.' })
    }

    const subscription = session.subscription ? await stripe.subscriptions.retrieve(stripeId(session.subscription)) : null
    const subscriptionId = String(subscription?.id || session.subscription || '')
    const subscriptionStatus = String(subscription?.status || '').toLowerCase()
    if(!subscriptionId || !['trialing','active'].includes(subscriptionStatus)){
      return res.status(409).json({ error:'subscription_not_active', message:'A assinatura ainda não está ativa ou em período grátis na Stripe.' })
    }

    if(subscriptionStatus === 'active' && session.payment_status !== 'paid'){
      return res.status(409).json({error:'checkout_payment_pending',message:'Aguarde a confirmação do pagamento pela Stripe.'})
    }
    const customerId = stripeId(session.customer)
    const latestStore = readStore()
    const latestCompany = findCompanyById(latestStore, company.id)
    if(!latestCompany) return res.status(404).json({error:'company_not_found'})
    if(latestCompany.stripe_subscription_id && latestCompany.stripe_subscription_id !== subscriptionId){
      return res.status(409).json({error:'subscription_mismatch'})
    }
    if(!customerId || customerId !== stripeId(subscription.customer)
      || (latestCompany.stripe_customer_id && latestCompany.stripe_customer_id !== customerId)
      || (subscription.metadata?.company_id && String(subscription.metadata.company_id) !== String(company.id))){
      return res.status(403).json({error:'customer_company_mismatch'})
    }
    updateSubscription(latestCompany, subscription)

    upsertAudit(latestStore, {
      company_id: company.id,
      action: 'checkout_confirmed',
      message: `Checkout Stripe ${session.id} confirmado por retorno seguro.`,
      actor_user_id: req.user?.id || '',
      actor_name: req.user?.name || company.owner_name || 'Usuário',
      actor_email: req.user?.email || company.owner_email || '',
      actor_role: req.user?.role || 'owner',
      reason: 'stripe_checkout_return',
      request_json: { session_id: session.id },
      after_json: JSON.parse(JSON.stringify(latestCompany)),
      source: 'stripe-return',
      ip_address: req.ip,
      user_agent: req.headers['user-agent'] || ''
    })

    writeStore(latestStore)
    return res.json({
      ok: true,
      confirmed: true,
      subscription: buildSubscriptionPayload(latestCompany, latestStore, req).subscription
    })
  } catch(err) {
    const code = err.code || 'stripe_confirm_error'
    return res.status(500).json({ error: code, message: err.message })
  }
})

router.post('/webhooks/stripe', express.raw({ type:'application/json' }), async (req, res) => {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET
  if(!stripe || !webhookSecret) return res.status(503).json({error:'stripe_webhook_not_configured'})
  let event
  try { event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], webhookSecret) }
  catch(err){ return res.status(400).json({error:'invalid_signature',message:err.message}) }
  if(!event.id) return res.status(400).json({error:'invalid_event'})
  try {
    const obj = event.data?.object || {}
    const subId = subscriptionId(obj)
    const customerId = stripeId(obj.customer)
    const companyId = String(obj.metadata?.company_id || '')
    const supported = ['checkout.session.completed','checkout.session.async_payment_succeeded',
      'invoice.paid','invoice.payment_failed','customer.subscription.created',
      'customer.subscription.updated','customer.subscription.deleted']
    const initialStore = readStore()
    if(initialStore.webhookEvents.some(e => e.id === event.id)) return res.json({ok:true,duplicate:true})
    const bySub = initialStore.companies.filter(c => subId && c.stripe_subscription_id === subId)
    const byMetadata = companyId ? findCompanyById(initialStore, companyId) : null
    const company = bySub.length === 1 ? bySub[0] : (bySub.length === 0 ? byMetadata : null)
    let processed = false
    const unpaidCheckout = event.type.startsWith('checkout.session.')
      && obj.payment_status !== 'paid' && obj.payment_status !== 'no_payment_required'
    if(company && subId && supported.includes(event.type) && !unpaidCheckout){
      await withCompanyLock(String(company.id), async () => {
        let latest = readStore()
        let target = findCompanyById(latest, company.id)
        if(!target || (target.stripe_subscription_id && target.stripe_subscription_id !== subId)) return
        if(companyId && companyId !== String(target.id)) return
        if(customerId && target.stripe_customer_id && customerId !== target.stripe_customer_id) return
        if(latest.webhookEvents.some(e => e.id === event.id)) return
        // Retrieve live state: Stripe does not guarantee event delivery order.
        const subscription = await stripe.subscriptions.retrieve(subId)
        const actualCustomer = stripeId(subscription.customer)
        if(!actualCustomer || (customerId && customerId !== actualCustomer)
          || (target.stripe_customer_id && target.stripe_customer_id !== actualCustomer)
          || (subscription.metadata?.company_id && String(subscription.metadata.company_id) !== String(target.id))) return
        if(!target.stripe_subscription_id){
          // Never bind an old canceled subscription using just a customer ID.
          if(!['active','trialing'].includes(subscription.status)
            || String(subscription.metadata?.company_id || '') !== String(target.id)
            || target.stripe_customer_id !== actualCustomer) return
        }
        latest = readStore()
        target = findCompanyById(latest, company.id)
        if(!target || (target.stripe_subscription_id && target.stripe_subscription_id !== subId)) return
        updateSubscription(target, subscription)
        if(event.type === 'invoice.paid'){
          target.last_payment_at = nowIso()
          target.manual_grace_until = ''
        }
        upsertAudit(latest, {company_id:target.id,action:'billing_webhook',
          message:`Webhook ${event.type} reconciliado com a assinatura Stripe atual.`,
          actor_name:'stripe-webhook',actor_role:'system',reason:event.type,
          request_json:event,after_json:JSON.parse(JSON.stringify(target)),source:'billing-webhook'})
        // Record success together with the mutation. API failures remain retryable.
        latest.webhookEvents.push({id:event.id,type:event.type,created_at:nowIso(),payload:event,status:'processed'})
        writeStore(latest)
        processed = true
      })
    }
    if(!processed){
      const latest = readStore()
      if(!latest.webhookEvents.some(e => e.id === event.id)){
        latest.webhookEvents.push({id:event.id,type:event.type,created_at:nowIso(),payload:event,status:'ignored'})
        writeStore(latest)
      }
    }
    return res.json({ok:true})
  } catch(err){ return res.status(500).json({error:'stripe_webhook_retry',message:err.message}) }
})

module.exports = router
