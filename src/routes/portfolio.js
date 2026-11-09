'use strict'
const router=require('express').Router()
const {requireAuth}=require('../middleware/auth')
const {hasMasterAccess,hasPermission}=require('../lib/policies')
const db=require('../lib/portfolio-db')
const modelDb=require('../lib/models-v2-db')
const readyDb=require('../lib/ready-models-db')
const r2=require('../lib/r2-storage')
const error=(status,message)=>Object.assign(new Error(message),{status})
const respond=fn=>async(req,res,next)=>{try{await fn(req,res)}catch(e){if(e.status)return res.status(e.status).json({message:e.message});next(e)}}
const companyId=req=>String(req.user?.company_id||'').trim()
const allowed=req=>hasMasterAccess(req.user)||hasPermission(req.user,'catalogo')||hasPermission(req.user,'precificacao')
const safeIds=ids=>Array.isArray(ids)?[...new Set(ids.map(x=>String(x)).filter(x=>x.length>0&&x.length<=128))].slice(0,200):[]
const publicUrl=slug=>'https://estofaria-frontend.pages.dev/vitrine/?loja='+encodeURIComponent(slug)
const coverUrl=async row=>row.cover_image_key&&r2.isConfigured()?await r2.presignGetUrl(row.cover_image_key,3600):null
const details=async row=>({
 slug:row.slug,url:publicUrl(row.slug),name:row.name,description:row.description,whatsapp:row.whatsapp,cover_image:await coverUrl(row),
 show_prices:row.show_prices,custom_ids:row.custom_ids,ready_ids:row.ready_ids,
 published:row.published,revision:row.revision
})
const imageUrl=async images=>{
 const key=images?.thumb?.object_key||images?.original?.object_key
 return key&&r2.isConfigured()?await r2.presignGetUrl(key,900):null
}
router.get('/public/portfolio/:slug',respond(async(req,res)=>{
 const slug=String(req.params.slug||'')
 if(!/^[a-f0-9]{24}$/.test(slug))throw error(404,'Vitrine não encontrada.')
 const row=await db.bySlug(slug)
 if(!row)throw error(404,'Vitrine não publicada.')
 const customIds=safeIds(row.custom_ids),readyIds=safeIds(row.ready_ids)
 // A filtragem final usa IDs selecionados; não expõe modelos alheios nem custos internos.
 const custom=await Promise.all(customIds.map(async id=>{
   const m=await modelDb.getModel(row.company_id,id)
   if(!m)return null
   return {id:m.id,name:m.name,description:m.description||'',category:m.category||'',
     image_url:await imageUrl(m.images),sale_price_cents:row.show_prices?Number(m.sale_price_cents)||0:null,
     base_meters:Number(m.base_meters)||0}
 }))
 const ready=await Promise.all(readyIds.map(async id=>{
   const m=await readyDb.get(row.company_id,id)
   if(!m||Number(m.quantity)<=0)return null
   return {id:m.id,name:m.name,description:m.description||'',quantity:Number(m.quantity),
     price_cents:row.show_prices?Number(m.price_cents):null,
     width_meters:m.width_meters==null?null:Number(m.width_meters),
     image_url:await imageUrl(m.images)}
 }))
 res.setHeader('Cache-Control','no-store')
 res.json({name:row.name,description:row.description,whatsapp:row.whatsapp,
  cover_image:await coverUrl(row),show_prices:row.show_prices,custom:custom.filter(Boolean),ready:ready.filter(Boolean)})
}))
router.use('/portfolio',requireAuth,(req,res,next)=>{
 if(!allowed(req))return res.status(403).json({message:'Sem acesso às configurações do Portfólio.'})
 if(!companyId(req))return res.status(400).json({message:'Empresa não identificada.'})
 next()
})
router.get('/portfolio',respond(async(req,res)=>{
 await db.ensure(companyId(req))
 const row=await db.get(companyId(req))
 res.json(await details(row))
}))
router.put('/portfolio',respond(async(req,res)=>{
 const body=req.body||{}
 const revision=body.revision
 if(!Number.isInteger(revision)||revision<1)throw error(400,'Reabra a vitrine antes de salvar.')
 const name=String(body.name||'').trim(),description=String(body.description||'').trim()
 const whatsapp=String(body.whatsapp||'').replace(/\D/g,'')
 if(!name||name.length>100||description.length>300)throw error(400,'Informe um nome e uma descrição válidos.')
 if(whatsapp&&(!/^\d{10,13}$/.test(whatsapp)))throw error(400,'Informe um WhatsApp válido com DDD.')
 if(typeof body.show_prices!=='boolean')throw error(400,'Preferência de preços inválida.')
 if(!Array.isArray(body.custom_ids)||!Array.isArray(body.ready_ids)||body.custom_ids.length>200||body.ready_ids.length>200)throw error(400,'Seleção de produtos inválida.')
 const customIds=safeIds(body.custom_ids),readyIds=safeIds(body.ready_ids)
 // Impede gravar seleções de outra empresa.
 for(const id of customIds)if(!await modelDb.getModel(companyId(req),id))throw error(400,'Um modelo sob encomenda não está disponível.')
 for(const id of readyIds)if(!await readyDb.get(companyId(req),id))throw error(400,'Um produto à pronta entrega não está disponível.')
 const row=await db.update(companyId(req),{name,description,whatsapp,show_prices:body.show_prices,custom_ids:customIds,ready_ids:readyIds},revision)
 if(!row)throw error(409,'A vitrine foi alterada em outra sessão. Reabra para continuar.')
 res.json(await details(row))
}))
router.post('/portfolio/cover/upload',respond(async(req,res)=>{
 if(!r2.isConfigured())throw error(503,'Armazenamento de imagens indisponível.')
 const type=String(req.body?.content_type||req.headers['content-type']||'').toLowerCase().split(';')[0].trim()
 if(!['image/jpeg','image/png','image/webp'].includes(type))throw error(415,'Use JPG, PNG ou WebP.')
 const encoded=typeof req.body?.image_base64==='string'?req.body.image_base64:''
 const bytes=Buffer.isBuffer(req.body)?req.body:encoded&&/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)?Buffer.from(encoded,'base64'):Buffer.alloc(0)
 if(!bytes.length||bytes.length>5*1024*1024)throw error(413,'Foto inválida ou maior que 5 MB.')
 await db.ensure(companyId(req))
 const before=await db.get(companyId(req))
 const key='companies/'+companyId(req)+'/portfolio/cover-'+require('crypto').randomBytes(12).toString('hex')+'.'+r2.extensionForContentType(type)
 await r2.putObject(key,bytes,type)
 let row
 try{row=await db.setCover(companyId(req),key)}catch(e){await r2.deleteObject(key).catch(()=>{});throw e}
 if(before.cover_image_key)await r2.deleteObject(before.cover_image_key).catch(()=>{})
 res.json(await details(row))
}))
router.delete('/portfolio/cover',respond(async(req,res)=>{
 await db.ensure(companyId(req))
 const before=await db.get(companyId(req))
 const row=await db.setCover(companyId(req),'')
 if(before.cover_image_key)await r2.deleteObject(before.cover_image_key).catch(()=>{})
 res.json(await details(row))
}))
router.post('/portfolio/publish',respond(async(req,res)=>{
 const revision=req.body?.revision,published=req.body?.published
 if(!Number.isInteger(revision)||revision<1||typeof published!=='boolean')throw error(400,'Solicitação inválida.')
 const before=await db.get(companyId(req))
 if(!before)throw error(404,'Configure sua vitrine antes de publicar.')
 if(published&&(!before.name.trim()||!before.whatsapp||!(before.custom_ids.length+before.ready_ids.length)))throw error(400,'Informe nome, WhatsApp e selecione ao menos um produto.')
 const row=await db.publish(companyId(req),published,revision)
 if(!row)throw error(409,'A vitrine foi alterada. Atualize a página.')
 res.json(await details(row))
}))
module.exports=router
