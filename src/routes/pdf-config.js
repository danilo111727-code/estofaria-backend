'use strict'

const express = require('express')
const { requireAuth } = require('../middleware/auth')
const db = require('../lib/pdf-config-db')

const router = express.Router()
router.use(requireAuth)

function companyIdFor(req){
  return String(req.user && req.user.company_id || '').trim()
}

router.get('/pdf-config', async (req,res,next)=>{
  try{
    const companyId=companyIdFor(req)
    if(!companyId) return res.status(400).json({error:'company_required',message:'Empresa não identificada.'})
    const row=await db.getConfig(companyId)
    if(!row) return res.json({exists:false,company_id:companyId,config:[]})
    return res.json({exists:true,...row})
  }catch(err){ next(err) }
})

router.put('/pdf-config', async (req,res,next)=>{
  try{
    const companyId=companyIdFor(req)
    if(!companyId) return res.status(400).json({error:'company_required',message:'Empresa não identificada.'})
    if(!Array.isArray(req.body && req.body.config)){
      return res.status(400).json({error:'invalid_config',message:'Configuração de PDF inválida.'})
    }
    const serialized=JSON.stringify(req.body.config)
    if(Buffer.byteLength(serialized,'utf8') > 900000){
      return res.status(413).json({error:'pdf_config_too_large',message:'A configuração do PDF excedeu o limite permitido.'})
    }
    const row=await db.saveConfig(companyId,req.body.config,{
      migratedFromLocal:String(req.body && req.body.source || '') === 'local_migration'
    })
    return res.json({ok:true,exists:true,...row})
  }catch(err){ next(err) }
})

module.exports=router
