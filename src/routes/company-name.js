'use strict'

const express = require('express')
const { readStore, writeStore, findCompanyById, upsertAudit, nowIso, materializeCompany } = require('../lib/store')
const { requireAuth, requireMaster, requirePermission } = require('../middleware/auth')

const router = express.Router()

function normalizeCompanyName(value){
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 120)
}

router.patch('/companies/:companyId/name', requireAuth, requireMaster, requirePermission('saas.companies.write'), (req, res) => {
  const store = readStore()
  const company = findCompanyById(store, req.params.companyId)
  if(!company) return res.status(404).json({ error:'company_not_found', message:'Empresa não encontrada.' })

  const name = normalizeCompanyName(req.body?.name)
  if(!name) return res.status(400).json({ error:'invalid_company_name', message:'Informe o novo nome da empresa.' })
  if(name.length < 2) return res.status(400).json({ error:'invalid_company_name', message:'O nome da empresa deve ter pelo menos 2 caracteres.' })

  const previousName = String(company.name || '').trim()
  if(previousName === name){
    return res.json({ ok:true, company: materializeCompany(store, company), changed:false, requires_relogin:false })
  }

  company.name = name
  company.updated_at = nowIso()

  upsertAudit(store, {
    company_id: company.id,
    action: 'company_name_changed',
    message: `Nome da empresa alterado de "${previousName || 'Sem nome'}" para "${name}".`,
    actor_user_id: req.user.id,
    actor_name: req.user.name,
    actor_email: req.user.email,
    actor_role: req.user.role,
    reason: String(req.body?.reason || 'Alteração administrativa do nome da empresa').trim(),
    source: 'master-company-name',
    ip_address:req.ip,
    user_agent:req.headers['user-agent'] || ''
  })

  writeStore(store)
  res.json({
    ok:true,
    changed:true,
    requires_relogin:true,
    message:'Nome da empresa alterado. O usuário deve entrar novamente para atualizar o cabeçalho em uma sessão já aberta.',
    company: materializeCompany(store, company)
  })
})

module.exports = router
