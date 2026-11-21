'use strict'
const assert=require('node:assert/strict')
const {test,after}=require('node:test')
const Module=require('node:module')
const http=require('node:http')
const express=require('express')
const originalLoad=Module._load
let record={slug:'0123456789abcdef01234567',company_id:'company-a',name:'Atelier A',description:'Descrição',whatsapp:'5571999999999',show_prices:true,custom_ids:['m1'],ready_ids:['r1'],published:true,revision:1}
const model={id:'m1',name:'Modelo 1',description:'Detalhes',category:'Retrátil',display_depth_meters:.95,display_height_meters:.85,images:{thumb:{object_key:'secret-image'}},sale_price_cents:200000,base_meters:2.5,total_cost_cents:180000,materials:[{unit_price_cents:10000}]}
const ready={id:'r1',name:'Pronta entrega',quantity:3,depth_meters:.95,height_meters:.85,price_cents:150000,description:'Disponível',images:{thumb:{object_key:'secret-ready'}}}
const modules={
 '../lib/store':{readStore:()=>({companies:[{id:'company-a',name:'Empresa cadastrada A'},{id:'company-b',name:'Outra empresa B'}]})},
 '../middleware/auth':{requireAuth:(req,res,next)=>{req.user={company_id:req.headers['x-test-company']||'company-a',permissions:['catalogo']};next()}},
 '../lib/policies':{hasMasterAccess:()=>false,hasPermission:(user,p)=>user.permissions.includes(p)},
 '../lib/portfolio-db':{
   ensure:async()=>record,
   get:async c=>c==='company-a'?record:null,
   bySlug:async s=>record.published&&s===record.slug?record:null,
   update:async(c,data,revision)=>{if(c!=='company-a'||revision!==record.revision)return null;record={...record,...data,revision:revision+1};return record},
   setCover:async(c,key)=>{if(c!=='company-a')return null;record={...record,cover_image_key:key,revision:record.revision+1};return record},
   publish:async(c,published,revision)=>{if(c!=='company-a'||revision!==record.revision)return null;record={...record,published,revision:revision+1};return record}
 },
 '../lib/models-v2-db':{getModel:async(c,id)=>c==='company-a'&&id==='m1'?model:null},
 '../lib/ready-models-db':{get:async(c,id)=>c==='company-a'&&id==='r1'?ready:null},
 '../lib/r2-storage':{isConfigured:()=>true,presignGetUrl:async key=>'https://images.example.test/'+key,putObject:async()=>({etag:'ok'}),deleteObject:async()=>({ok:true}),extensionForContentType:()=> 'jpg'}
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
 assert.equal(result.body.custom[0].display_depth_meters,.95)
 assert.equal(result.body.custom[0].display_height_meters,.85)
 assert.equal(result.body.ready[0].depth_meters,.95)
 assert.equal(result.body.ready[0].height_meters,.85)
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

test('link público usa produção por padrão e permite configuração do ambiente',async()=>{
 const previous=process.env.PUBLIC_FRONTEND_URL
 try{
  delete process.env.PUBLIC_FRONTEND_URL
  let result=await request('GET','/api/v2/portfolio')
  assert.equal(result.body.url,'https://estofariadigital.com.br/vitrine/?loja='+record.slug)
  process.env.PUBLIC_FRONTEND_URL='https://estofaria-frontend.pages.dev/'
  result=await request('GET','/api/v2/portfolio')
  assert.equal(result.body.url,'https://estofaria-frontend.pages.dev/vitrine/?loja='+record.slug)
 }finally{if(previous===undefined)delete process.env.PUBLIC_FRONTEND_URL;else process.env.PUBLIC_FRONTEND_URL=previous}
})

test('publicação aceita modelos próprios visíveis e rejeita catálogo vazio',async()=>{
 const previous={...record}
 try{
  record={...record,published:false,custom_ids:[],ready_ids:[],direct_models:[{id:'direct-1',visible:true}]}
  let result=await request('POST','/api/v2/portfolio/publish',{published:true,revision:record.revision})
  assert.equal(result.status,200)
  record={...record,published:false,direct_models:[{id:'direct-1',visible:false}]}
  result=await request('POST','/api/v2/portfolio/publish',{published:true,revision:record.revision})
  assert.equal(result.status,400)
 }finally{record=previous}
})

test('foto de capa: adiciona, recupera, publica e exclui sem perder identidade',async()=>{
 const bytes=Buffer.from('fake-image-for-route-test').toString('base64');
 let result=await request('POST','/api/v2/portfolio/cover/upload',{image_base64:bytes,content_type:'image/jpeg'});
 assert.equal(result.status,200);
 assert.match(result.body.cover_image,/^https:\/\/images\.example\.test\//);
 const name=result.body.name;
 result=await request('GET','/api/v2/portfolio');
 assert.equal(result.body.cover_image!==null,true);
 result=await request('GET','/api/v2/public/portfolio/'+record.slug);
 assert.equal(result.body.cover_image!==null,true);
 result=await request('DELETE','/api/v2/portfolio/cover');
 assert.equal(result.status,200);
 assert.match(result.body.cover_image,/\/assets\/catalogo-capa-global\.png$/);
 assert.equal(result.body.name,name);
 result=await request('GET','/api/v2/portfolio');
 assert.match(result.body.cover_image,/\/assets\/catalogo-capa-global\.png$/);
})

test('código do tecido persiste no álbum e chega ao link público',async()=>{
 const before=await request('GET','/api/v2/portfolio');
 const result=await request('PUT','/api/v2/portfolio',{...before.body,fabric_albums:[{id:'album-code',name:'Linho',fabrics:[{id:'fabric-code',name:'Bege',code:'REF-123',image_url:'https://images.local/bege.jpg'}]}]});
 assert.equal(result.status,200);assert.equal(result.body.fabric_albums[0].fabrics[0].code,'REF-123');
 record={...record,published:true};
 const visible=await request('GET','/api/v2/public/portfolio/'+record.slug);
 assert.equal(visible.body.fabric_albums[0].fabrics[0].code,'REF-123');
 const invalid=await request('PUT','/api/v2/portfolio',{...result.body,fabric_albums:[{id:'album-code',name:'Linho',fabrics:[{id:'fabric-code',name:'Bege',code:'x'.repeat(61),image_url:'https://images.local/bege.jpg'}]}]});
 assert.equal(invalid.status,400);
});

test('nome automático e capa global são iguais na prévia e no público, preservando personalizações',async()=>{
 const saved={...record}
 try{
  record={...record,name:'',cover_image_key:'',published:true}
  let admin=await request('GET','/api/v2/portfolio')
  let client=await request('GET','/api/v2/public/portfolio/'+record.slug)
  assert.equal(admin.body.name,'Empresa cadastrada A')
  assert.equal(client.body.name,admin.body.name)
  assert.match(admin.body.cover_image,/\/assets\/catalogo-capa-global\.png$/)
  assert.equal(client.body.cover_image,admin.body.cover_image)
  record.name='Minha estofaria'
  assert.equal((await request('GET','/api/v2/portfolio')).body.name,'Empresa cadastrada A')
  record.name='Minha marca personalizada';record.cover_image_key='custom-cover'
  admin=await request('GET','/api/v2/portfolio');client=await request('GET','/api/v2/public/portfolio/'+record.slug)
  assert.equal(admin.body.name,'Minha marca personalizada')
  assert.equal(client.body.name,admin.body.name)
  assert.equal(client.body.cover_image,'https://images.example.test/custom-cover')
 }finally{record=saved}
})

test('metragens públicas preservam preços de venda sem expor custos e respeitam preços ocultos',async()=>{
 const savedRecord={...record},savedModel={...model};
 try{
  record={...record,published:true,show_prices:true,custom_ids:['m1']};
  Object.assign(model,{variation_mode:'automatic',spacing_cm:10,valor_por_espacamento_cents:10000,min_meters:2.5,max_meters:2.7});
  let result=await request('GET','/api/v2/public/portfolio/'+record.slug);
  assert.deepEqual(result.body.custom[0].public_variants,[{meters:2.5,price_cents:200000},{meters:2.6,price_cents:210000},{meters:2.7,price_cents:220000}]);
  assert.equal(JSON.stringify(result.body).includes('total_cost_cents'),false);
  assert.equal(JSON.stringify(result.body).includes('valor_por_espacamento_cents'),false);
  record.show_prices=false;
  result=await request('GET','/api/v2/public/portfolio/'+record.slug);
  assert.deepEqual(result.body.custom[0].public_variants,[{meters:2.5,price_cents:null},{meters:2.6,price_cents:null},{meters:2.7,price_cents:null}]);
  model.variation_mode='specific';model.specific_variations=[{meters:3,price_cents:270000},{meters:2,price_cents:190000}];record.show_prices=true;
  result=await request('GET','/api/v2/public/portfolio/'+record.slug);
  assert.deepEqual(result.body.custom[0].public_variants,[{meters:2,price_cents:190000},{meters:3,price_cents:270000}]);
 }finally{record=savedRecord;for(const k of Object.keys(model))delete model[k];Object.assign(model,savedModel)}
});
