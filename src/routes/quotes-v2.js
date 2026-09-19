'use strict'

const express = require('express')
const { requireAuth } = require('../middleware/auth')
const { hasMasterAccess, hasPermission } = require('../lib/policies')
const db = require('../lib/quotes-v2-db')

const router = express.Router()
router.use(requireAuth)

function canUseQuotes(user){
  return hasMasterAccess(user) || hasPermission(user,'vendedor')
}

function requireQuotes(req,res,next){
  if(!canUseQuotes(req.user)) return res.status(403).json({error:'forbidden',message:'Sem acesso ao Vendedor.'})
  next()
}

function companyIdFor(req){
  if(hasMasterAccess(req.user)){
    return String(req.query?.company_id || req.body?.company_id || req.user?.company_id || '').trim()
  }
  return String(req.user?.company_id || '').trim()
}

function requireCompany(req,res,next){
  const companyId=companyIdFor(req)
  if(!companyId) return res.status(400).json({error:'company_required',message:'Empresa não identificada.'})
  req.quotesV2CompanyId=companyId
  next()
}

router.use(requireQuotes,requireCompany)

router.get('/quotes',async(req,res,next)=>{
  try{
    const rows=await db.listQuotes(req.quotesV2CompanyId,{
      status:req.query.status || '',
      limit:req.query.limit,
      offset:req.query.offset
    })
    return res.json(rows)
  }catch(err){ next(err) }
})

router.post('/quotes',async(req,res,next)=>{
  try{
    const row=await db.createQuote(req.quotesV2CompanyId,req.body || {})
    return res.status(201).json(row)
  }catch(err){ next(err) }
})

router.get('/quotes/:id',async(req,res,next)=>{
  try{
    const row=await db.getQuote(req.quotesV2CompanyId,req.params.id)
    if(!row) return res.status(404).json({error:'not_found',message:'Orçamento não encontrado.'})
    return res.json(row)
  }catch(err){ next(err) }
})

router.patch('/quotes/:id',async(req,res,next)=>{
  try{
    const row=await db.updateQuote(req.quotesV2CompanyId,req.params.id,req.body || {})
    if(!row) return res.status(404).json({error:'not_found',message:'Orçamento não encontrado.'})
    return res.json(row)
  }catch(err){ next(err) }
})

router.delete('/quotes/:id',async(req,res,next)=>{
  try{
    const ok=await db.deleteQuote(req.quotesV2CompanyId,req.params.id)
    if(!ok) return res.status(404).json({error:'not_found',message:'Orçamento não encontrado.'})
    return res.json({ok:true})
  }catch(err){ next(err) }
})

router.post('/quotes/:id/finalize-and-schedule',async(req,res,next)=>{
  try{
    const result=await db.finalizeQuoteAndSchedule(
      req.quotesV2CompanyId,
      req.params.id,
      req.body || {}
    )
    if(result.notFound) return res.status(404).json({error:'not_found',message:'Orçamento não encontrado.'})
    if(result.blockRequired) return res.status(400).json({error:'block_required',message:'Selecione uma vaga da Agenda.'})
    if(result.blockNotFound) return res.status(404).json({error:'block_not_found',message:'Bloco da Agenda não encontrado.'})
    if(result.blockFull) return res.status(409).json({
      error:'block_full',
      message:'Todas as vagas deste bloco já estão ocupadas.',
      occupied:result.occupied,
      capacity:result.capacity
    })
    if(result.alreadyOrder) return res.status(409).json({
      error:'already_order',
      message:'Este orçamento já foi finalizado por outro fluxo.'
    })
    return res.json(result)
  }catch(err){ next(err) }
})

router.post('/quotes/:id/convert-to-order',async(req,res,next)=>{
  try{
    const row=await db.updateQuote(req.quotesV2CompanyId,req.params.id,{status:'pedido'})
    if(!row) return res.status(404).json({error:'not_found',message:'Orçamento não encontrado.'})
    // A inclusão na Agenda continua sendo feita pelo fluxo atual do Vendedor,
    // evitando duplicar pedidos durante a transição.
    return res.json(row)
  }catch(err){ next(err) }
})

module.exports=router
