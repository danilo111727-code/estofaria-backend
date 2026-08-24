'use strict'

const express = require('express')
const { requireAuth } = require('../middleware/auth')
const { hasMasterAccess } = require('../lib/policies')
const db = require('../lib/agenda-v2-db')

const router = express.Router()
router.use(requireAuth)

const VALID_CITY_CODES = new Set([
  'SP-SAO_PAULO','SP-CAMPINAS','SP-SANTOS','SP-SAO_BERNARDO','SP-RIBEIRAO_PRETO','SP-SOROCABA',
  'SP-OSASCO','SP-GUARULHOS','SP-JUNDIAI','SP-BAURU',
  'RJ-RIO_DE_JANEIRO','RJ-NITEROI','RJ-DUQUE_CAXIAS','RJ-NOVA_IGUACU',
  'MG-BELO_HORIZONTE','MG-CONTAGEM','MG-UBERLANDIA','MG-JUIZ_DE_FORA',
  'BA-SALVADOR','BA-FEIRA_SANTANA','CE-FORTALEZA','PR-CURITIBA','PR-LONDRINA',
  'RS-PORTO_ALEGRE','RS-CAXIAS_DO_SUL','PE-RECIFE','PE-CARUARU','AM-MANAUS','PA-BELEM',
  'GO-GOIANIA','DF-BRASILIA','ES-VITORIA','MS-CAMPO_GRANDE','SC-FLORIANOPOLIS','SC-JOINVILLE',
  'RN-NATAL','AL-MACEIO','MA-SAO_LUIS','PI-TERESINA'
])

function text(value,fallback=''){
  if(value === undefined || value === null) return fallback
  return String(value).trim()
}

function companyIdFor(req){
  if(hasMasterAccess(req.user)){
    return text(req.query?.company_id || req.body?.company_id || req.user?.company_id)
  }
  return text(req.user?.company_id)
}

function requireCompany(req,res,next){
  const companyId = companyIdFor(req)
  if(!companyId) return res.status(404).json({error:'company_not_found',message:'Empresa não encontrada.'})
  req.agendaV2CompanyId = companyId
  next()
}

router.use(requireCompany)

function audit(req,action,detail){
  db.auditEvent(req.agendaV2CompanyId,action,detail,req.user).catch(err=>{
    console.error('[agenda-v2] Falha ao registrar auditoria:',err?.message || err)
  })
}

router.get('/agenda/config',async(req,res,next)=>{
  try{
    const row = await db.getConfig(req.agendaV2CompanyId)
    return res.json(row)
  }catch(err){ next(err) }
})

router.patch('/agenda/config',async(req,res,next)=>{
  try{
    const current = await db.getConfig(req.agendaV2CompanyId)
    const incomingCity = req.body?.city_code !== undefined
      ? String(req.body.city_code || '').trim().toUpperCase().replace(/\s/g,'_')
      : null
    const validCity = incomingCity !== null
      ? (incomingCity && VALID_CITY_CODES.has(incomingCity) ? incomingCity : '')
      : (current.city_code || '')
    const row = await db.updateConfig(req.agendaV2CompanyId,{...(req.body || {}),city_code:validCity})
    audit(req,'agenda.config.update','Configuração da agenda atualizada')
    return res.json(row)
  }catch(err){ next(err) }
})

router.get('/agenda/orders',async(req,res,next)=>{
  try{
    const rows = await db.listOrders(req.agendaV2CompanyId)
    return res.json(rows)
  }catch(err){ next(err) }
})

router.post('/agenda/orders',async(req,res,next)=>{
  try{
    const row = await db.createOrder(req.agendaV2CompanyId,req.body || {})
    audit(req,'agenda.order.create',`Pedido na agenda criado para ${row.cliente}`)
    return res.status(201).json(row)
  }catch(err){ next(err) }
})

router.patch('/agenda/orders/:id',async(req,res,next)=>{
  try{
    const row = await db.updateOrder(req.agendaV2CompanyId,req.params.id,req.body || {})
    if(!row) return res.status(404).json({error:'not_found',message:'Pedido não encontrado.'})
    audit(req,'agenda.order.update',`Pedido da agenda atualizado: ${row.id}`)
    return res.json(row)
  }catch(err){ next(err) }
})

router.delete('/agenda/orders/:id',async(req,res,next)=>{
  try{
    const ok = await db.deleteOrder(req.agendaV2CompanyId,req.params.id)
    if(!ok) return res.status(404).json({error:'not_found',message:'Pedido não encontrado.'})
    audit(req,'agenda.order.delete',`Pedido removido da agenda: ${req.params.id}`)
    return res.json({ok:true})
  }catch(err){ next(err) }
})

router.get('/agenda/blocos',async(req,res,next)=>{
  try{
    const rows = await db.listBlocks(req.agendaV2CompanyId)
    return res.json(rows)
  }catch(err){ next(err) }
})

router.post('/agenda/blocos',async(req,res,next)=>{
  try{
    const row = await db.createBlock(req.agendaV2CompanyId,req.body || {})
    audit(req,'agenda.bloco.create',`Bloco criado: produção ${row.data_producao}`)
    return res.status(201).json(row)
  }catch(err){ next(err) }
})

router.patch('/agenda/blocos/:id',async(req,res,next)=>{
  try{
    const row = await db.updateBlock(req.agendaV2CompanyId,req.params.id,req.body || {})
    if(!row) return res.status(404).json({error:'not_found',message:'Bloco não encontrado.'})
    audit(req,'agenda.bloco.update',`Bloco atualizado: ${row.id}`)
    return res.json(row)
  }catch(err){ next(err) }
})

router.delete('/agenda/blocos/:id',async(req,res,next)=>{
  try{
    const ok = await db.deleteBlock(req.agendaV2CompanyId,req.params.id)
    if(!ok) return res.status(404).json({error:'not_found',message:'Bloco não encontrado.'})
    audit(req,'agenda.bloco.delete',`Bloco removido: ${req.params.id}`)
    return res.json({ok:true})
  }catch(err){ next(err) }
})

router.post('/agenda/blocos/:id/vaga',async(req,res,next)=>{
  try{
    const result = await db.changeSlots(req.agendaV2CompanyId,req.params.id,1)
    if(result.notFound) return res.status(404).json({error:'not_found',message:'Bloco não encontrado.'})
    audit(req,'agenda.bloco.vaga.add',`Vaga adicionada ao bloco ${req.params.id}`)
    return res.json(result.bloco)
  }catch(err){ next(err) }
})

router.delete('/agenda/blocos/:id/vaga',async(req,res,next)=>{
  try{
    const result = await db.changeSlots(req.agendaV2CompanyId,req.params.id,-1)
    if(result.notFound) return res.status(404).json({error:'not_found',message:'Bloco não encontrado.'})
    if(result.noEmptySlots) return res.status(400).json({error:'no_empty_slots',message:'Não há vagas vazias para remover.'})
    audit(req,'agenda.bloco.vaga.remove',`Vaga removida do bloco ${req.params.id}`)
    return res.json(result.bloco)
  }catch(err){ next(err) }
})

router.post('/agenda/blocos/:id/pedido',async(req,res,next)=>{
  try{
    const result = await db.createBlockOrder(req.agendaV2CompanyId,req.params.id,req.body || {})
    if(result.notFound) return res.status(404).json({error:'not_found',message:'Bloco não encontrado.'})
    if(result.full) return res.status(400).json({error:'bloco_full',message:'Todas as vagas deste bloco estão ocupadas.'})
    audit(req,'agenda.bloco.pedido.create',`Pedido adicionado ao bloco ${req.params.id}: ${result.row.cliente}`)
    return res.status(201).json(result.row)
  }catch(err){ next(err) }
})

module.exports = router
