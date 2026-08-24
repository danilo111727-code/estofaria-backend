'use strict'

const express = require('express')
const { requireAuth, requireMaster, requirePermission } = require('../middleware/auth')
const db = require('../lib/audit-v2-db')

const router = express.Router()

router.get('/audit',requireAuth,requireMaster,requirePermission('saas.audit.read'),async(req,res,next)=>{
  try{
    const result = await db.listGlobal(req.query?.limit)
    return res.json(result)
  }catch(err){ next(err) }
})

router.get('/companies/:companyId/audit',requireAuth,requireMaster,requirePermission('saas.audit.read'),async(req,res,next)=>{
  try{
    const rows = await db.listCompany(req.params.companyId)
    const items = rows.map(item=>({
      id:item.id,
      action:item.action,
      message:item.message,
      actor_name:item.actor_name || item.actor || 'Sistema',
      actor_email:item.actor_email || '',
      actor_role:item.actor_role || '',
      created_at:item.created_at,
      reason:item.reason || ''
    }))
    return res.json({items})
  }catch(err){ next(err) }
})

module.exports = router
