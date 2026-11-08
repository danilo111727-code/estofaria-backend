'use strict'
const assert=require('node:assert/strict')
const {test,after}=require('node:test')
const Module=require('node:module')
const http=require('node:http')
const express=require('express')
const originalLoad=Module._load
let record={slug:'0123456789abcdef01234567',company_id:'company-a',name:'Atelier A',description:'Descrição',whatsapp:'5571999999999',show_prices:true,custom_ids:['m1'],ready_ids:['r1'],published:true,revision:1}
const model={id:'m1',name:'Modelo 1',description:'Detalhes',category:'Retrátil',images:{thumb:{object_key:'secret-image'}},sale_price_cents:200000,base_meters:2.5,total_cost_cents:180000,materials:[{unit_price_cents:10000}]}
const ready={id:'r1',name:'Pronta entrega',quantity:3,price_cents:150000,description:'Disponível',images:{thumb:{object_key:'secret-ready'}}}
const modules={
 '../middleware/auth':{requireAuth:(req,res,next)=>{req.user={company_id:req.headers['x-test-company']||'company-a',permissions:['catalogo']};next()}},
 '../lib/policies':{hasMasterAccess:()=>false,hasPermission:(user,p)=>user.permissions.includes(p)},
 '../lib/portfolio-db':{
   ensure:async()=>record,
   get:async c=>c==='company-a'?record:null,
   bySlug:async s=>record.published&&s===record.slug?record:null,
   update:async(c,data,revision)=>{if(c!=='company-a'||revision!==record.revision)return null;record={...record,...data,revision:revision+1};return record},
   publish:async(c,published,revision)=>{if(c!=='company-a'||revision!==record.revision)return null;record={...record,published,revision:revision+1};return record}
 },
 '../lib/models-v2-db':{getModel:async(c,id)=>c==='company-a'&&id==='m1'?model:null},
 '../lib/ready-models-db':{get:async(c,id)=>c==='company-a'&&id==='r1'?ready:null},
 '../lib/r2-storage':{isConfigured:()=>true,presignGetUrl:async key=>'https://images.example.test/'+key}
}
Module._load=function(request,parent,isMain){
 if(parent?.filename?.endsWith('/src/routes/portfolio.js')&&modules[request])return modules[request]
 return originalLoad.apply(this,arguments)
}
let router
try{router=require('../src/routes/portfolio')}finally{Module._load=originalLoad}
const app=express();app.use(express.json());app.use('/api/v2',router)
const srv=http.createServer(app)
const request=async(method,path,body,company='company-a')=>{
 await new Promise(resolve=>srv.listening?resolve():srv.listen(0,'127.0.0.1',resolve))
 const response=await fetch('http://127.0.0.1:'+srv.address().port+path,{
 method,headers:{'Content-Type':'application/json','x-test-company':company},body:body?JSON.stringify(body):undefined
 });return{status:response.status,body:await response.json()}
}
test('pública somente publicada, somente campos permitidos e estoque válido',async()=>{
 let result=await request('GET','/api/v2/public/portfolio/'+record.slug)
 assert.equal(result.status,200)
 assert.equal(result.body.custom[0].name,'Modelo 1')
 assert.equal(result.body.ready[0].quantity,3)
 assert.equal(JSON.stringify(result.body).includes('total_cost_cents'),false)
 assert.equal(JSON.stringify(result.body).includes('object_key'),false)
 assert.equal(JSON.stringify(result.body).includes('materials'),false)
 result=await request('GET','/api/v2/public/portfolio/wrong-slug')
 assert.equal(result.status,404)
})
test('configuração impede update de outra empresa e aceita apenas IDs próprios',async()=>{
 let result=await request('PUT','/api/v2/portfolio',{
 name:'Atelier B',description:'Teste',whatsapp:'5571999999999',show_prices:true,custom_ids:['m1'],ready_ids:['r1'],revision:1
 },'company-b')
 assert.equal(result.status,400)
 result=await request('PUT','/api/v2/portfolio',{
 name:'Atelier A',description:'Teste',whatsapp:'5571999999999',show_prices:true,custom_ids:['foreign'],ready_ids:['r1'],revision:1
 })
 assert.equal(result.status,400)
 result=await request('PUT','/api/v2/portfolio',{
 name:'Atelier A',description:'Teste',whatsapp:'5571999999999',show_prices:false,custom_ids:['m1'],ready_ids:['r1'],revision:1
 })
 assert.equal(result.status,200)
 assert.equal(result.body.revision,2)
})
test('despublicar desativa link e impede visitas públicas',async()=>{
 const before=await request('GET','/api/v2/portfolio')
 assert.equal(before.status,200)
 const changed=await request('POST','/api/v2/portfolio/publish',{published:false,revision:before.body.revision})
 assert.equal(changed.status,200)
 const gone=await request('GET','/api/v2/public/portfolio/'+record.slug)
 assert.equal(gone.status,404)
})
after(()=>srv.close())
