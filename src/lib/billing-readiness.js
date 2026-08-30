'use strict'

const PLAN_CATALOG = Object.freeze({
  gestao: Object.freeze({
    code: 'gestao',
    name: 'Plano Gestão',
    monthly_price_cents: 14900,
    currency: 'brl',
    interval: 'month',
    seats_limit: 2
  }),
  empresarial: Object.freeze({
    code: 'empresarial',
    name: 'Plano Empresarial',
    monthly_price_cents: 39900,
    currency: 'brl',
    interval: 'month',
    seats_limit: null
  })
})

const TRIAL_DAYS = 60

function normalizeId(value){
  if(!value) return ''
  if(typeof value === 'string') return value
  if(typeof value === 'object' && value.id) return String(value.id)
  return String(value)
}

function getPlanDefinition(code){
  const normalized = String(code || 'gestao').trim().toLowerCase()
  return PLAN_CATALOG[normalized] || PLAN_CATALOG.gestao
}

function validateStripePrice(price, plan){
  const expected = plan || PLAN_CATALOG.gestao
  if(!price || !price.id) throw new Error('Preço Stripe não encontrado.')
  if(price.active === false) throw new Error(`O preço Stripe do ${expected.name} está inativo.`)
  if(String(price.currency || '').toLowerCase() !== expected.currency){
    throw new Error(`Moeda incorreta no Stripe para ${expected.name}. Esperado BRL.`)
  }
  if(Number(price.unit_amount) !== Number(expected.monthly_price_cents)){
    throw new Error(`Valor incorreto no Stripe para ${expected.name}. Esperado R$ ${(expected.monthly_price_cents / 100).toFixed(2).replace('.', ',')}.`)
  }
  if(String(price.type || '') !== 'recurring' || String(price.recurring?.interval || '') !== expected.interval){
    throw new Error(`Periodicidade incorreta no Stripe para ${expected.name}. Esperado mensal.`)
  }
  return true
}

function resolveCompanyForStripeEvent(store, obj = {}, event = {}){
  const companies = Array.isArray(store?.companies) ? store.companies : []
  const metadataCompanyId = obj?.metadata?.company_id
    || obj?.subscription_details?.metadata?.company_id
    || event?.company_id
    || ''
  if(metadataCompanyId){
    const byId = companies.find(item => String(item.id) === String(metadataCompanyId))
    if(byId) return byId
  }

  const customerId = normalizeId(obj.customer)
  if(customerId){
    const byCustomer = companies.find(item => String(item.stripe_customer_id || '') === customerId)
    if(byCustomer) return byCustomer
  }

  const subscriptionId = normalizeId(obj.subscription)
  if(subscriptionId){
    const bySubscription = companies.find(item => String(item.stripe_subscription_id || '') === subscriptionId)
    if(bySubscription) return bySubscription
  }
  return null
}

function publicBillingConfig(cfg = {}){
  return {
    ...cfg,
    enabled: cfg.enabled !== false,
    default_plan_code: PLAN_CATALOG[String(cfg.default_plan_code || '').toLowerCase()] ? String(cfg.default_plan_code).toLowerCase() : 'gestao',
    plan_code: PLAN_CATALOG[String(cfg.plan_code || '').toLowerCase()] ? String(cfg.plan_code).toLowerCase() : 'gestao',
    plan_name: getPlanDefinition(cfg.plan_code || cfg.default_plan_code).name,
    monthly_price_cents: getPlanDefinition(cfg.plan_code || cfg.default_plan_code).monthly_price_cents,
    trial_days: TRIAL_DAYS,
    notes: '60 dias grátis. Cartão necessário no cadastro; primeira cobrança somente após o período gratuito.',
    payment_provider: 'stripe',
    plans: Object.values(PLAN_CATALOG).map(plan => ({ ...plan }))
  }
}

module.exports = {
  PLAN_CATALOG,
  TRIAL_DAYS,
  getPlanDefinition,
  validateStripePrice,
  resolveCompanyForStripeEvent,
  publicBillingConfig,
  normalizeId
}
