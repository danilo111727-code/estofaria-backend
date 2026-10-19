'use strict'

const express = require('express')
const { hasMasterAccess } = require('../lib/policies')
const db = require('../lib/dashboard-v2-retro')
const { requireAuth,requirePermission } = require('../middleware/auth')

const router = express.Router()

function text(value){
  return String(value ?? '').trim()
}

function companyIdFor(req){
  if(hasMasterAccess(req.user)){
    return text(req.query?.company_id || req.user?.company_id || req.user?.company?.id)
  }
  return text(req.user?.company_id || req.user?.company?.id)
}

router.get('/dashboard/summary',async(req,res,next)=>{
  try{
    const companyId = companyIdFor(req)
    if(!companyId){
      return res.json({
        dashboard_v2:true,
        dashboard_version:2,
        source:'postgresql',
        pedidos:0,
        faturamento_cents:0,
        ticket_medio_cents:0,
        pedidos_ano:0,
        faturamento_ano_cents:0,
        charts:{ last6_months:[], year_months:[], year_revenue_months:[], top_models:[] }
      })
    }
    const summary = await db.getSummary(companyId)
    return res.json(summary)
  }catch(err){ next(err) }
})

router.get('/dashboard/revenue-history',requireAuth,requirePermission('painel'),async(req,res,next)=>{
  try{
    const companyId=companyIdFor(req)
    if(!companyId)return res.status(400).json({message:'Selecione uma empresa.'})
    const currentYear=Number(new Intl.DateTimeFormat('en',{timeZone:'America/Bahia',year:'numeric'}).format(new Date()))
    const year=req.query.year===undefined?currentYear:Number(req.query.year)
    if(!Number.isInteger(year)||year<2000||year>currentYear)return res.status(400).json({message:'Ano inválido.'})
    res.json(await db.getRevenueHistory(companyId,year))
  }catch(error){next(error)}
})
for(const method of ['patch','delete'])router[method]('/dashboard/revenue-history/:key',requireAuth,requirePermission('configuracao'),async(req,res,next)=>{
  try{
    const companyId=companyIdFor(req)
    if(!companyId)return res.status(400).json({message:'Selecione uma empresa.'})
    res.json({ok:true,...await db.adjustRevenue(companyId,req.params.key,req.body || {},method==='delete')})
  }catch(error){
    if(error.status)return res.status(error.status).json({message:error.message})
    next(error)
  }
})
module.exports = router

