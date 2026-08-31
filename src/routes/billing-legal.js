'use strict'

const express = require('express')
const { readStore, writeStore, nowIso, upsertAudit } = require('../lib/store')
const { requireAuth } = require('../middleware/auth')

const router = express.Router()
const LEGAL_VERSION = '2026-08-30-v1'
const stripeSecretKey = String(process.env.STRIPE_SECRET_KEY || '').trim()
const stripe = stripeSecretKey ? require('stripe')(stripeSecretKey) : null

function findCompany(store, user){
  return (store.companies || []).find(item => String(item.id) === String(user?.company_id || '')) || null
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

function stripeId(value){
  if(!value) return ''
  if(typeof value === 'string') return value
  return String(value.id || '')
}

function epochToIso(value){
  const seconds = Number(value || 0)
  return Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000).toISOString() : ''
}

function isCurrentAcceptance(company){
  return Boolean(
    company
    && company.terms_accepted_at
    && company.privacy_accepted_at
    && String(company.terms_version || '') === LEGAL_VERSION
    && String(company.privacy_version || '') === LEGAL_VERSION
  )
}

function persistAcceptance(store, company, user, source){
  const acceptedAt = nowIso()
  company.terms_accepted_at = acceptedAt
  company.privacy_accepted_at = acceptedAt
  company.terms_version = LEGAL_VERSION
  company.privacy_version = LEGAL_VERSION
  company.legal_acceptance_source = source || 'subscription'
  company.updated_at = acceptedAt

  upsertAudit(store, {
    company_id: company.id,
    action: 'legal_terms_accepted',
    message: `Termos de Uso e Política de Privacidade aceitos (${LEGAL_VERSION}).`,
    actor_user_id: user?.id || '',
    actor_name: user?.name || '',
    actor_email: user?.email || '',
    actor_role: user?.role || 'user',
    source: source || 'subscription'
  })
  writeStore(store)
  return acceptedAt
}

router.get('/legal-status', requireAuth, (req, res) => {
  const store = readStore()
  const company = findCompany(store, req.user)
  if(!company) return res.status(404).json({ error:'company_not_found', message:'Empresa não encontrada.' })

  res.json({
    accepted: isCurrentAcceptance(company),
    legal_version: LEGAL_VERSION,
    terms_accepted_at: company.terms_accepted_at || '',
    privacy_accepted_at: company.privacy_accepted_at || '',
    terms_version: company.terms_version || '',
    privacy_version: company.privacy_version || ''
  })
})

router.post('/legal-acceptance', requireAuth, (req, res) => {
  if(req.body?.accepted_terms !== true || req.body?.accepted_privacy !== true){
    return res.status(400).json({
      error:'legal_acceptance_required',
      message:'É necessário aceitar os Termos de Uso e a Política de Privacidade.'
    })
  }

  const store = readStore()
  const company = findCompany(store, req.user)
  if(!company) return res.status(404).json({ error:'company_not_found', message:'Empresa não encontrada.' })

  const acceptedAt = persistAcceptance(store, company, req.user, 'legal-acceptance')
  res.json({ ok:true, accepted:true, legal_version:LEGAL_VERSION, accepted_at:acceptedAt })
})

router.post('/stripe/create-checkout', requireAuth, (req, res, next) => {
  const store = readStore()
  const company = findCompany(store, req.user)
  if(!company) return res.status(404).json({ error:'company_not_found', message:'Empresa não encontrada.' })

  if(isCurrentAcceptance(company)) return next()

  if(req.body?.accepted_terms === true && req.body?.accepted_privacy === true){
    persistAcceptance(store, company, req.user, 'stripe-checkout')
    return next()
  }

  return res.status(400).json({
    error:'legal_acceptance_required',
    message:'Aceite os Termos de Uso e a Política de Privacidade antes de continuar para o checkout.'
  })
})

router.get('/stripe/checkout-status', requireAuth, async (req, res) => {
  const sessionId = String(req.query?.session_id || '').trim()
  if(!sessionId){
    return res.status(400).json({ error:'session_id_required', message:'Informe a sessão do checkout para confirmar a assinatura.' })
  }
  if(!stripe){
    return res.status(503).json({ error:'stripe_not_configured', message:'Stripe não configurado neste ambiente.', stripe_mode:stripeMode() })
  }

  try{
    ensureStripeModeAllowed()
    const store = readStore()
    const company = findCompany(store, req.user)
    if(!company) return res.status(404).json({ error:'company_not_found', message:'Empresa não encontrada.' })

    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ['subscription.default_payment_method', 'customer.invoice_settings.default_payment_method']
    })

    const sessionCompanyId = String(session?.metadata?.company_id || session?.client_reference_id || '')
    if(!sessionCompanyId || sessionCompanyId !== String(company.id)){
      return res.status(403).json({ error:'checkout_company_mismatch', message:'Esta sessão de checkout não pertence à empresa autenticada.' })
    }

    const subscription = session?.subscription && typeof session.subscription === 'object' ? session.subscription : null
    const customer = session?.customer && typeof session.customer === 'object' ? session.customer : null
    const checkoutStatus = String(session?.status || '').toLowerCase()
    const subscriptionStatus = String(subscription?.status || '').toLowerCase()
    const defaultPaymentMethod = stripeId(subscription?.default_payment_method)
      || stripeId(customer?.invoice_settings?.default_payment_method)
    const cardRegistered = checkoutStatus === 'complete' && Boolean(defaultPaymentMethod)

    if(checkoutStatus === 'complete'){
      const customerId = stripeId(session.customer)
      const subscriptionId = stripeId(session.subscription)
      if(customerId) company.stripe_customer_id = customerId
      if(subscriptionId) company.stripe_subscription_id = subscriptionId

      if(subscriptionStatus){
        company.financial_status = subscriptionStatus
        if(['active','trialing'].includes(subscriptionStatus)) company.access_status = 'active'
        else if(subscriptionStatus === 'past_due') company.access_status = company.manual_grace_until ? 'manual_grace' : 'active'
        else if(['unpaid','canceled','incomplete_expired'].includes(subscriptionStatus)) company.access_status = 'blocked'
        else company.access_status = 'pending_payment'
      } else if(cardRegistered){
        company.financial_status = 'trialing'
        company.access_status = 'active'
      }

      const trialEndsAt = epochToIso(subscription?.trial_end)
      const currentPeriodEnd = epochToIso(subscription?.current_period_end)
      if(trialEndsAt) company.trial_ends_at = trialEndsAt
      if(currentPeriodEnd || trialEndsAt) company.next_charge_at = currentPeriodEnd || trialEndsAt
      company.updated_at = nowIso()

      upsertAudit(store, {
        company_id: company.id,
        action: 'stripe_checkout_verified',
        message: cardRegistered
          ? 'Checkout Stripe confirmado e método de pagamento registrado.'
          : 'Checkout Stripe retornou como concluído; método de pagamento ainda não confirmado pela consulta.',
        actor_user_id: req.user?.id || '',
        actor_name: req.user?.name || '',
        actor_email: req.user?.email || '',
        actor_role: req.user?.role || 'user',
        source: 'stripe-checkout-status'
      })
      writeStore(store)
    }

    res.json({
      ok:true,
      stripe_mode:stripeMode(),
      checkout_status:checkoutStatus,
      payment_status:String(session?.payment_status || '').toLowerCase(),
      subscription_status:subscriptionStatus,
      card_registered:cardRegistered,
      access_status:company.access_status || '',
      financial_status:company.financial_status || '',
      trial_ends_at:company.trial_ends_at || '',
      next_charge_at:company.next_charge_at || ''
    })
  }catch(err){
    const code = err.code || 'stripe_checkout_status_error'
    const status = code === 'stripe_test_mode_required' ? 409 : 500
    res.status(status).json({ error:code, message:err.message, stripe_mode:stripeMode() })
  }
})

module.exports = router
