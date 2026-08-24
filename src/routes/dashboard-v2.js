'use strict'

const express = require('express')
const { hasMasterAccess } = require('../lib/policies')
const db = require('../lib/dashboard-v2-db')

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

module.exports = router
