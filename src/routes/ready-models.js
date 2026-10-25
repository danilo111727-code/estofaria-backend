'use strict'
const router=require('express').Router()
const {requireAuth}=require('../middleware/auth')
const {hasMasterAccess,hasPermission}=require('../lib/policies')
const db=require('../lib/ready-models-db')
const r2=require('../lib/r2-storage')
const {randomUUID}=require('crypto')
const error=(status,message)=>Object.assign(new Error(message),{status})
router.use('/ready-models',requireAuth,(req,res,next)=>{
 const write=!['GET','HEAD'].includes(req.method)
 const allowed=hasMasterAccess(req.user)||(write?hasPermission(req.user,'precificacao'):['catalogo','precificacao','vendedor'].some(p=>hasPermission(req.user,p)))
 if(!allowed)return res.status(403).json({message:'Sem permissão para '+(write?'alterar':'consultar')+' modelos à pronta entrega.'})
 req.readyCompanyId=String(hasMasterAccess(req.user)?req.query.company_id||req.user.company_id||'':req.user.company_id||'').trim()
 if(!req.readyCompanyId)return res.status(400).json({message:'Empresa não identificada.'})
 next()
})
function parsePhoto(value,max){
 const match=typeof value==='string'&&value.match(/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/)
 if(!match)throw error(400,'Foto inválida. Use JPG, PNG ou WebP.')
 const bytes=Buffer.from(match[2],'base64'),type=match[1]
 const valid=type==='jpeg'?bytes[0]===255&&bytes[1]===216&&bytes[2]===255:type==='png'?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP'
 if(!valid||!bytes.length||bytes.length>max)throw error(400,'Foto inválida ou acima do limite. Selecione outra foto.')
 return {bytes,type:'image/'+type,ext:type==='jpeg'?'jpg':type}
}
async function decorate(row){
 // Chaves privadas nunca são enviadas ao navegador.
 const {images,...item}=row
 for(const key of ['width_meters','depth_meters','height_meters'])item[key]=row[key]==null?null:Number(row[key])
 item.price_cents=Number(row.price_cents)
 item.image_url=images?.thumb?.object_key&&r2.isConfigured()?await r2.presignGetUrl(images.thumb.object_key,900):null
 return item
}
function route(fn){return async(req,res,next)=>{try{await fn(req,res)}catch(e){if(e.status)return res.status(e.status).json({message:e.message});next(e)}}}
router.get('/ready-models',route(async(req,res)=>{
 const offset=Math.max(0,Math.min(100000,Math.floor(Number(req.query.offset)||0)))
 const rows=await db.list(req.readyCompanyId,offset)
 res.json({items:await Promise.all(rows.map(decorate)),offset,has_more:rows.length===100})
}))
router.get('/ready-models/:id',route(async(req,res)=>{
 const row=await db.get(req.readyCompanyId,req.params.id)
 if(!row)throw error(404,'Modelo não encontrado.')
 res.json(await decorate(row))
}))
async function save(req,res,creating){
 const companyId=req.readyCompanyId,id=creating?db.newId():req.params.id
 const normalized=db.normalize(req.body||{}),previous=creating?null:await db.get(companyId,id)
 if(!creating&&!previous)throw error(404,'Modelo não encontrado.')
 const revision=creating?null:req.body.revision
 if(!creating&&(!Number.isSafeInteger(revision)||revision!==previous.revision))throw error(409,'Este modelo mudou. Reabra-o antes de editar.')
 let images=previous?.images||{},uploaded=[]
 const photo=req.body.photo
 if(creating&&!photo)throw error(400,'Adicione a foto do modelo.')
 if(photo){
  const parts={original:parsePhoto(photo.original,480000),thumb:parsePhoto(photo.thumb,100000)}
  if(!r2.isConfigured())throw error(503,'Armazenamento de fotos indisponível. Tente novamente.')
  const version=randomUUID();images={}
  try{
   for(const [variant,p] of Object.entries(parts)){
    const object_key=`companies/${encodeURIComponent(companyId)}/ready-models/${id}/${version}/${variant}.${p.ext}`
    await r2.putObject(object_key,p.bytes,p.type);uploaded.push(object_key);images[variant]={object_key}
   }
  }catch(e){await Promise.all(uploaded.map(k=>r2.deleteObject(k).catch(()=>{})));throw e}
 }
 let saved
 try{saved=await db.save(companyId,id,normalized,images,revision)}catch(e){await Promise.all(uploaded.map(k=>r2.deleteObject(k).catch(()=>{})));throw e}
 if(photo&&previous)await Promise.all(Object.values(previous.images||{}).map(v=>r2.deleteObject(v.object_key).catch(()=>{})))
 res.status(creating?201:200).json(await decorate(saved))
}
router.post('/ready-models',route((req,res)=>save(req,res,true)))
router.put('/ready-models/:id',route((req,res)=>save(req,res,false)))
router.delete('/ready-models/:id',route(async(req,res)=>{
 const removed=await db.remove(req.readyCompanyId,req.params.id,req.body?.revision)
 if(!removed)throw error(404,'Modelo não encontrado.')
 res.json({ok:true})
}))
module.exports=router
