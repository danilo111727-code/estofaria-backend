'use strict'

const express = require('express')
const { readStore, writeStore, nowIso, upsertAudit } = require('../lib/store')
const { requireAuth } = require('../middleware/auth')

const router = express.Router()
const LEGAL_VERSION = '2026-08-30-v1'

function findCompany(store, user){
  return (store.companies || []).find(item => String(item.id) === String(user?.company_id || '')) || null
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

module.exports = router
