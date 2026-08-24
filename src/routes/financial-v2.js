'use strict'

const express = require('express')
const { requireAuth } = require('../middleware/auth')
const { hasMasterAccess } = require('../lib/policies')
const db = require('../lib/financial-v2-db')

const router = express.Router()
router.use(requireAuth)

function text(value,fallback=''){
  if(value===undefined || value===null) return fallback
  return String(value).trim()
}

function companyIdFor(req){
  if(hasMasterAccess(req.user)){
    return text(req.query?.company_id || req.body?.company_id || req.user?.company_id)
  }
  return text(req.user?.company_id)
}

function requireCompany(req,res,next){
  const companyId=companyIdFor(req)
  if(!companyId) return res.status(404).json({error:'company_not_found',message:'Empresa não encontrada.'})
  req.financialV2CompanyId=companyId
  next()
}

router.use(requireCompany)

function audit(req,action,detail){
  db.auditEvent(req.financialV2CompanyId,action,detail,req.user).catch(err=>{
    console.error('[financial-v2] Falha ao registrar auditoria:',err?.message || err)
  })
}

router.get('/financial/entries',async(req,res,next)=>{
  try{
    const rows=await db.listEntries(req.financialV2CompanyId,{
      tipo:req.query?.tipo || '',
      status:req.query?.status || ''
    })
    return res.json({items:rows})
  }catch(err){ next(err) }
})

router.post('/financial/entries',async(req,res,next)=>{
  try{
    const row=await db.createEntry(req.financialV2CompanyId,req.body || {})
    audit(req,'financial.entry.create',`Lançamento criado: ${row.descricao} (${row.tipo})`)
    return res.status(201).json(row)
  }catch(err){
    if(err?.code==='invalid_tipo'){
      return res.status(400).json({error:'invalid_tipo',message:err.message})
    }
    next(err)
  }
})

router.patch('/financial/entries/:id',async(req,res,next)=>{
  try{
    const row=await db.updateEntry(req.financialV2CompanyId,req.params.id,req.body || {})
    if(!row) return res.status(404).json({error:'not_found',message:'Lançamento não encontrado.'})
    audit(req,'financial.entry.update',`Lançamento atualizado: ${row.id}`)
    return res.json(row)
  }catch(err){ next(err) }
})

router.delete('/financial/entries/:id',async(req,res,next)=>{
  try{
    const ok=await db.deleteEntry(req.financialV2CompanyId,req.params.id)
    if(!ok) return res.status(404).json({error:'not_found',message:'Lançamento não encontrado.'})
    audit(req,'financial.entry.delete',`Lançamento removido: ${req.params.id}`)
    return res.json({ok:true})
  }catch(err){ next(err) }
})

module.exports=router
