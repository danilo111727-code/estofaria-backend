'use strict'

const express = require('express')
const { requireAuth } = require('../middleware/auth')
const { readStore, writeStore, nowIso, upsertAudit } = require('../lib/store')

const router = express.Router()

const DEFAULT_UNITS = [
  'metro','metro quadrado','centímetro','quilograma','grama',
  'unidade','par','litro','mililitro','rolo','peça','caixa','placa','fardo'
]

function normalizeUnit(value){
  return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 60)
}

function normalizeUnits(value){
  const list = Array.isArray(value) ? value : []
  return Array.from(new Set(list.map(normalizeUnit).filter(Boolean))).slice(0, 100)
}

function ensureCollection(store){
  if(!Array.isArray(store.materialUnitSets)) store.materialUnitSets = []
  return store.materialUnitSets
}

function getCompanyId(req){
  return String(req.user?.company_id || req.user?.company?.id || '').trim()
}

function getOrCreateSet(store, companyId){
  const sets = ensureCollection(store)
  let row = sets.find(item => String(item.company_id) === String(companyId))
  if(!row){
    row = {
      company_id: companyId,
      units: DEFAULT_UNITS.slice(),
      created_at: nowIso(),
      updated_at: nowIso()
    }
    sets.push(row)
  }
  row.units = normalizeUnits(row.units)
  return row
}

router.use(requireAuth)

router.get('/material-units', (req, res) => {
  const companyId = getCompanyId(req)
  if(!companyId) return res.status(404).json({ error:'company_not_found', message:'Empresa não encontrada.' })

  const store = readStore()
  const existing = Array.isArray(store.materialUnitSets)
    ? store.materialUnitSets.find(item => String(item.company_id) === companyId)
    : null
  const row = getOrCreateSet(store, companyId)
  if(!existing) writeStore(store)
  return res.json({ units: row.units })
})

router.put('/material-units', (req, res) => {
  const companyId = getCompanyId(req)
  if(!companyId) return res.status(404).json({ error:'company_not_found', message:'Empresa não encontrada.' })
  if(!Array.isArray(req.body?.units)) return res.status(400).json({ error:'invalid_request', message:'Informe a lista de unidades.' })

  const store = readStore()
  const row = getOrCreateSet(store, companyId)
  row.units = normalizeUnits(req.body.units)
  row.updated_at = nowIso()

  if(Array.isArray(store.auditLogs)){
    upsertAudit(store, {
      company_id: companyId,
      action: 'material_units.update',
      message: `Unidades de medida atualizadas (${row.units.length}).`,
      actor_name: req.user?.name || req.user?.email || 'Usuário',
      actor_email: req.user?.email || '',
      actor_role: req.user?.role || 'user',
      source: 'material-units-api'
    })
  }

  writeStore(store)
  return res.json({ units: row.units })
})

module.exports = router
