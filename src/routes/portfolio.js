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
const safeDirectModels=items=>{
 if(!Array.isArray(items)||items.length>100)throw error(400,'Limite de 100 modelos exclusivos.');
 return items.map(item=>{
  const id=String(item.id||'').trim(),name=String(item.name||'').trim(),category=String(item.category||'').trim(),description=String(item.description||'').trim();
  if(!/^[a-zA-Z0-9_-]{8,80}$/.test(id)||!name||name.length>100||!category||category.length>60||description.length>500)throw error(400,'Dados inválidos do modelo exclusivo.');
  const images=Array.isArray(item.images)?item.images:[];
  if(images.length>8||images.some(url=>typeof url!=='string'||url.length>1500||!/^https:\/\//.test(url)))throw error(400,'Fotos inválidas.');
  const variants=Array.isArray(item.variants)?item.variants:[];
  if(variants.length>30||variants.some(v=>!Number.isFinite(Number(v.meters))||Number(v.meters)<=0||Number(v.meters)>100||!Number.isSafeInteger(Number(v.price_cents))||Number(v.price_cents)<0||Number(v.price_cents)>1000000000))throw error(400,'Metragens ou valores inválidos.');
  return {id,name,category,description,images,variants:variants.map(v=>({meters:Number(v.meters),price_cents:Number(v.price_cents)}))};
 });
};
const publicUrl=slug=>'https://estofaria-frontend.pages.dev/vitrine/?loja='+encodeURIComponent(slug)
const details=row=>({
 slug:row.slug,url:publicUrl(row.slug),name:row.name,description:row.description,whatsapp:row.whatsapp,
 show_prices:row.show_prices,custom_ids:row.custom_ids,ready_ids:row.ready_ids,direct_models:row.direct_models||[],
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
  show_prices:row.show_prices,custom:custom.filter(Boolean),ready:ready.filter(Boolean),direct_models:(row.direct_models||[]).map(m=>({...m,variants:row.show_prices?m.variants:m.variants.map(v=>({meters:v.meters,price_cents:null}))}))})
}))
router.use('/portfolio',requireAuth,(req,res,next)=>{
 if(!allowed(req))return res.status(403).json({message:'Sem acesso às configurações do Portfólio.'})
 if(!companyId(req))return res.status(400).json({message:'Empresa não identificada.'})
 next()
})
router.get('/portfolio',respond(async(req,res)=>{
 await db.ensure(companyId(req))
 const row=await db.get(companyId(req))
 res.json(details(row))
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
 const customIds=safeIds(body.custom_ids),readyIds=safeIds(body.ready_ids),directModels=safeDirectModels(body.direct_models||[])
 // Impede gravar seleções de outra empresa.
 for(const id of customIds)if(!await modelDb.getModel(companyId(req),id))throw error(400,'Um modelo sob encomenda não está disponível.')
 for(const id of readyIds)if(!await readyDb.get(companyId(req),id))throw error(400,'Um produto à pronta entrega não está disponível.')
 const row=await db.update(companyId(req),{name,description,whatsapp,show_prices:body.show_prices,custom_ids:customIds,ready_ids:readyIds,direct_models:directModels},revision)
 if(!row)throw error(409,'A vitrine foi alterada em outra sessão. Reabra para continuar.')
 res.json(details(row))
}))
router.post('/portfolio/publish',respond(async(req,res)=>{
 const revision=req.body?.revision,published=req.body?.published
 if(!Number.isInteger(revision)||revision<1||typeof published!=='boolean')throw error(400,'Solicitação inválida.')
 const before=await db.get(companyId(req))
 if(!before)throw error(404,'Configure sua vitrine antes de publicar.')
 if(published&&(!before.name.trim()||!before.whatsapp||!(before.custom_ids.length+before.ready_ids.length+(before.direct_models||[]).length)))throw error(400,'Informe nome, WhatsApp e selecione ao menos um produto.')
 const row=await db.publish(companyId(req),published,revision)
 if(!row)throw error(409,'A vitrine foi alterada. Atualize a página.')
 res.json(details(row))
}))
module.exports=router
