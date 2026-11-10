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
const coverUrl=async row=>{
 if(!row.cover_image_key||!r2.isConfigured())return null
 try{return await r2.presignGetUrl(row.cover_image_key,3600)}catch(e){console.warn('[portfolio-public] capa indisponível:',e.message);return null}
}
const details=async row=>({
 slug:row.slug,url:publicUrl(row.slug),name:row.name,description:row.description,whatsapp:row.whatsapp,cover_image:await coverUrl(row),
 show_prices:row.show_prices,custom_ids:row.custom_ids,ready_ids:row.ready_ids,fabric_albums:row.fabric_albums||[],direct_models:row.direct_models||[],
 published:row.published,revision:row.revision
})
const imageUrl=async images=>{
 const key=images?.thumb?.object_key||images?.original?.object_key
 if(!key||!r2.isConfigured())return null
 try{return await r2.presignGetUrl(key,900)}catch(e){console.warn('[portfolio-public] imagem indisponível:',e.message);return null}
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
  cover_image:await coverUrl(row),show_prices:row.show_prices,custom:custom.filter(Boolean),ready:ready.filter(Boolean),direct_models:(Array.isArray(row.direct_models)?row.direct_models:[]).filter(m=>m.visible!==false).map(m=>({id:m.id,name:m.name,category:m.category,description:m.description,images:m.images,variants:row.show_prices?m.variants:(m.variants||[]).map(v=>({meters:v.meters}))})),fabric_albums:(Array.isArray(row.fabric_albums)?row.fabric_albums:[]).filter(a=>a.visible!==false).map(a=>({id:a.id,name:a.name,fabrics:(a.fabrics||[]).filter(t=>t.visible!==false).map(t=>({id:t.id,name:t.name,image_url:t.image_url}))}))})
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
 const direct=body.direct_models===undefined?null:body.direct_models
 if(direct!==null&&(!Array.isArray(direct)||direct.length>100))throw error(400,'Modelos cadastrados inválidos.')
 const safeDirect=direct===null?null:direct.map(m=>({id:String(m?.id||''),name:String(m?.name||'').trim(),category:String(m?.category||'').trim(),description:String(m?.description||''),visible:m?.visible!==false,images:Array.isArray(m?.images)?m.images.map(String):[],variants:Array.isArray(m?.variants)?m.variants.map(v=>({meters:Number(v.meters),price_cents:Number(v.price_cents)})):[]}))
 if(safeDirect&&safeDirect.some(m=>!/^[-_a-zA-Z0-9]{1,100}$/.test(m.id)||!m.name||m.name.length>100||!m.category||m.category.length>100||m.description.length>1000||m.images.length>8||m.images.some(u=>u.length>400000||!/^https:\/\/|^data:image\/(jpeg|png|webp);base64,/.test(u))||m.variants.length>30||m.variants.some(v=>!Number.isFinite(v.meters)||v.meters<=0||!Number.isSafeInteger(v.price_cents)||v.price_cents<0))))throw error(400,'Confira os dados dos modelos.')
 const albums=body.fabric_albums===undefined?null:body.fabric_albums
 if(albums!==null&&(!Array.isArray(albums)||albums.length>50))throw error(400,'Álbuns de tecidos inválidos.')
 const safeAlbums=albums===null?null:albums.map(a=>({id:String(a?.id||''),name:String(a?.name||'').trim(),visible:a?.visible!==false,fabrics:Array.isArray(a?.fabrics)?a.fabrics.map(t=>({id:String(t?.id||''),name:String(t?.name||'').trim(),image_url:String(t?.image_url||''),visible:t?.visible!==false})):[]}))
 if(safeAlbums&&safeAlbums.some(a=>!/^[-_a-zA-Z0-9]{1,100}$/.test(a.id)||!a.name||a.name.length>100||a.fabrics.length>100||a.fabrics.some(t=>!/^[-_a-zA-Z0-9]{1,100}$/.test(t.id)||!t.name||t.name.length>100||!/^https:\/\/|^data:image\/(jpeg|png|webp);base64,/.test(t.image_url)||t.image_url.length>250000))))throw error(400,'Confira nomes e imagens dos álbuns.')
 // Impede gravar seleções de outra empresa.
 for(const id of customIds)if(!await modelDb.getModel(companyId(req),id))throw error(400,'Um modelo sob encomenda não está disponível.')
 for(const id of readyIds)if(!await readyDb.get(companyId(req),id))throw error(400,'Um produto à pronta entrega não está disponível.')
 const current=await db.get(companyId(req))
 const row=await db.update(companyId(req),{name,description,whatsapp,show_prices:body.show_prices,custom_ids:customIds,ready_ids:readyIds,fabric_albums:safeAlbums===null?(current?.fabric_albums||[]):safeAlbums,direct_models:safeDirect===null?(current?.direct_models||[]):safeDirect},revision)
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
