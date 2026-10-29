'use strict'
const router=require('express').Router()
const {requireAuth}=require('../middleware/auth')
const {hasMasterAccess,hasPermission}=require('../lib/policies')
const db=require('../lib/customers-db')
router.use(requireAuth)
function permission(...allowed){return (req,res,next)=>{
  if(!allowed.some(p=>hasPermission(req.user,p)))return res.status(403).json({message:'Sem permissão para clientes.'})
  req.customerCompany=String(hasMasterAccess(req.user)?(req.query.company_id || req.body?.company_id || req.user.company_id || ''):(req.user.company_id || '')).trim()
  if(!req.customerCompany)return res.status(400).json({message:'Selecione uma empresa.'})
  next()
}}
const handle=fn=>async(req,res,next)=>{try{await fn(req,res)}catch(error){if(error.status)return res.status(error.status).json({message:error.message,duplicates:error.duplicates});next(error)}}
router.get('/customers/:id/purchases',permission('configuracao'),handle(async(req,res)=>res.json(await db.purchases(req.customerCompany,req.params.id,req.query))))
router.get('/customers',permission('vendedor','configuracao'),handle(async(req,res)=>res.json(await db.list(req.customerCompany,req.query))))
router.post('/customers',permission('vendedor','configuracao'),handle(async(req,res)=>res.status(201).json(await db.save(req.customerCompany,null,req.body))))
router.patch('/customers/:id',permission('configuracao'),handle(async(req,res)=>res.json(await db.save(req.customerCompany,req.params.id,req.body))))
router.delete('/customers/:id',permission('configuracao'),handle(async(req,res)=>{
  if(!await db.remove(req.customerCompany,req.params.id))return res.status(404).json({message:'Cliente não encontrado.'})
  res.json({ok:true})
}))
module.exports=router
