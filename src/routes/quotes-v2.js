'use strict'

const express = require('express')
const { requireAuth } = require('../middleware/auth')
const { hasMasterAccess, hasPermission } = require('../lib/policies')
const db = require('../lib/quotes-v2-db')
const { readStore, writeStore, upsertAudit } = require('../lib/store')
const r2 = require('../lib/r2-storage')

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

function auditQuote(req,companyId,action,detail){
  const store=readStore()
  upsertAudit(store,{
    company_id:companyId,
    action,
    message:detail,
    actor_name:req.user?.name || req.user?.email || 'Usuário',
    actor_email:req.user?.email || '',
    actor_role:req.user?.role || 'user',
    source:'quotes-v2-api'
  })
  writeStore(store)
}

function quoteImageKeyAllowed(companyId,objectKey){
  const key=String(objectKey || '').trim()
  return Boolean(key && key.startsWith(r2.quoteImagePrefix(companyId)) && !key.includes('..'))
}

function quoteImageKeys(row){
  const models=Array.isArray(row?.payload?.modelos) ? row.payload.modelos : []
  return Array.from(new Set(models
    .map(model=>String(model?.quote_image_key || '').trim())
    .filter(Boolean)))
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
    auditQuote(req,req.quotesV2CompanyId,'quote.create',`Orçamento salvo para ${row.cliente || 'Cliente'}`)
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
    auditQuote(req,req.quotesV2CompanyId,'quote.update',`Orçamento atualizado: ${row.id}`)
    return res.json(row)
  }catch(err){ next(err) }
})

router.delete('/quotes/:id',async(req,res,next)=>{
  try{
    const row=await db.getQuote(req.quotesV2CompanyId,req.params.id)
    if(!row) return res.status(404).json({error:'not_found',message:'Orçamento não encontrado.'})

    const ok=await db.deleteQuote(req.quotesV2CompanyId,req.params.id)
    if(!ok) return res.status(404).json({error:'not_found',message:'Orçamento não encontrado.'})

    auditQuote(req,req.quotesV2CompanyId,'quote.delete',`Orçamento removido: ${req.params.id}`)

    if(r2.isConfigured()){
      await Promise.all(quoteImageKeys(row).map(key =>
        quoteImageKeyAllowed(req.quotesV2CompanyId,key)
          ? r2.deleteObject(key).catch(()=>null)
          : null
      ))
    }

    return res.json({ok:true})
  }catch(err){ next(err) }
})

router.post('/quotes/:id/finalize-and-schedule',async(req,res,next)=>{
  try{
    const result=await db.finalizeQuoteAndSchedule(req.quotesV2CompanyId,req.params.id,req.body || {})
    if(result.notFound) return res.status(404).json({error:'not_found',message:'Orçamento não encontrado.'})
    if(result.invalidMode) return res.status(400).json({error:'invalid_schedule_mode',message:'Modo de agendamento inválido.'})
    if(result.missingBlock) return res.status(400).json({error:'agenda_block_required',message:'Selecione uma vaga da Agenda.'})
    if(result.blockNotFound) return res.status(404).json({error:'agenda_block_not_found',message:'Bloco da Agenda não encontrado.'})
    if(result.full) return res.status(409).json({
      error:'agenda_block_full',
      message:'Todas as vagas deste bloco estão ocupadas.',
      occupied:result.occupied,
      qtd_vagas:result.qtd_vagas
    })
    if(result.duplicate) return res.status(409).json({
      error:'agenda_duplicate',
      message:'Este pedido já está vinculado à Agenda.'
    })
    return res.json({
      pedido:result.quote,
      agenda:result.agendaOrder || null,
      schedule_mode:result.scheduleMode
    })
  }catch(err){ next(err) }
})

router.post('/quotes/:id/convert-to-order',async(req,res,next)=>{
  try{
    const row=await db.updateQuote(req.quotesV2CompanyId,req.params.id,{status:'pedido'})
    if(!row) return res.status(404).json({error:'not_found',message:'Orçamento não encontrado.'})
    auditQuote(req,req.quotesV2CompanyId,'quote.convert_to_order',`Orçamento convertido em pedido: ${row.id}`)
    // A inclusão na Agenda continua fora desta etapa.
    return res.json(row)
  }catch(err){ next(err) }
})

module.exports=router
