'use strict'
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm'),path=require('path')
const {PGlite}=require('@electric-sql/pglite'),express=require('express')
let pg,pool,db,trash,server,base,objects=new Map(),failUpload=false,failWrite=false
const picture='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2ioAAAAASUVORK5CYII='
const body=()=>({name:'Sofá pronto',price_cents:150000,quantity:2,width_meters:2.1,depth_meters:.95,height_meters:.85,fabric:'Linho bege',photo:{original:picture,thumb:picture}})
const cache={}
function load(file){if(cache[file])return cache[file].exports;const m={exports:{}};cache[file]=m;vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src',file),'utf8'),{module:m,Buffer,console,setInterval,clearInterval,require:n=>{
 if(n==='./store')return {_pg:{pool}}
 if(n==='../middleware/auth')return {requireAuth:(req,res,next)=>{if(!req.headers['x-company'])return res.status(401).json({message:'Não autorizado'});req.user={company_id:req.headers['x-company'],permissions:(req.headers['x-permission']||'catalogo,precificacao').split(',')};next()}}
 if(n==='../lib/policies')return {hasMasterAccess:()=>false,hasPermission:(u,p)=>u.permissions.includes(p)}
 if(n==='./r2-storage'||n==='../lib/r2-storage')return {isConfigured:()=>true,putObject:async(k,b)=>{if(failUpload)throw Error('storage failure');objects.set(k,b)},deleteObject:async k=>objects.delete(k),presignGetUrl:async k=>'https://images.local/'+k}
 if(n.startsWith('.'))return load(path.relative(path.dirname(path.join(__dirname,'../src','_')),path.resolve(path.dirname(path.join(__dirname,'../src',file)),n+'.js')))
 return require(n)
 }},{filename:file});return m.exports}
async function request(url,method='GET',payload,company='a',permission='catalogo,precificacao'){
 const r=await fetch(base+url,{method,headers:{'Content-Type':'application/json',...(company?{'x-company':company}:{}),'x-permission':permission},body:payload?JSON.stringify(payload):undefined});return {status:r.status,data:await r.json()}
}
before(async()=>{
 pg=new PGlite();pool={query:async(s,p=[])=>{if(failWrite&&s.startsWith('INSERT INTO app_ready'))throw Error('database failure');return p.length?pg.query(s,p):(await pg.exec(s)).at(-1)},connect:async()=>({...pool,release(){}})}
 trash=load('lib/trash-db.js');db=load('lib/ready-models-db.js');await db.ensureSchema();await trash.ensureSchema(pool)
 const app=express();app.use(express.json({limit:'1mb'}));app.use('/api/v2',load('routes/ready-models.js'));app.use((e,req,res,next)=>res.status(e.status||500).json({message:e.message}));server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));base='http://127.0.0.1:'+server.address().port
})
after(async()=>{await new Promise(r=>server.close(r));await pg.close()})
test('create, list, edit and get persist photos, stock, price, fabric and dimensions',async()=>{
 const r=await request('/api/v2/ready-models','POST',body());assert.equal(r.status,201);const a=r.data;assert.equal(a.quantity,2);assert.equal(a.width_meters,2.1);assert.equal(a.price_cents,150000);assert.equal(a.images,undefined);assert.match(a.image_url,/companies\/a\/ready-models/)
 const list=await request('/api/v2/ready-models');assert.equal(list.data.items[0].id,a.id)
 const changed={...body(),name:'Novo nome',quantity:0,revision:a.revision};delete changed.photo
 const update=await request('/api/v2/ready-models/'+a.id,'PUT',changed);assert.equal(update.status,200);assert.equal(update.data.revision,2);assert.equal(update.data.quantity,0);assert.equal(update.data.image_url,a.image_url)
 const got=await request('/api/v2/ready-models/'+a.id);assert.equal(got.data.name,'Novo nome');assert.equal(got.data.fabric,'Linho bege');assert.equal(objects.size,2)
})
test('auth, permissions and company isolation protect every operation',async()=>{
 assert.equal((await request('/api/v2/ready-models','GET',null,null)).status,401)
 assert.equal((await request('/api/v2/ready-models','POST',body(),'a','catalogo')).status,403)
 assert.equal((await request('/api/v2/ready-models','GET',null,'a','agenda')).status,403)
 const a=(await request('/api/v2/ready-models','POST',{...body(),company_id:'b'})).data
 assert.equal(a.company_id,'a')
 assert.equal((await request('/api/v2/ready-models/'+a.id,'GET',null,'b')).status,404)
 assert.equal((await request('/api/v2/ready-models/'+a.id,'PUT',{...body(),revision:1},'b')).status,404)
 assert.equal((await request('/api/v2/ready-models/'+a.id,'DELETE',{revision:1},'b')).status,404)
 assert.equal((await request('/api/v2/ready-models','GET',null,'b')).data.items.length,0)
})
test('stale revisions never overwrite or delete newer stock',async()=>{
 const a=(await request('/api/v2/ready-models','POST',body())).data
 const next={...body(),revision:1,quantity:4};delete next.photo
 assert.equal((await request('/api/v2/ready-models/'+a.id,'PUT',next)).status,200)
 assert.equal((await request('/api/v2/ready-models/'+a.id,'PUT',next)).status,409)
 assert.equal((await request('/api/v2/ready-models/'+a.id,'DELETE',{revision:1})).status,409)
 assert.equal((await db.get('a',a.id)).quantity,4)
})
test('delete is recoverable in Catalog trash and restore remains company scoped',async()=>{
 const a=(await request('/api/v2/ready-models','POST',body())).data
 assert.equal((await request('/api/v2/ready-models/'+a.id,'DELETE',{revision:1})).status,200)
 assert.equal(await db.get('a',a.id),null)
 const item=(await pool.query("SELECT * FROM app_trash_v1 WHERE kind='ready-model' AND record_key=$1",[a.id])).rows[0];assert.equal(item.category,'catalogo');assert.equal(trash.objectKeys(item.snapshot).length,2)
 await assert.rejects(trash.transaction(pool,c=>trash.restore(c,'b',item.id)),e=>e.status===404)
 await trash.transaction(pool,c=>trash.restore(c,'a',item.id))
 const restored=await db.get('a',a.id);assert.equal(restored.quantity,2);assert.equal(restored.price_cents,150000);assert.equal(restored.revision,3)
})
test('invalid values and invalid image content are rejected before writing',async()=>{
 for(const override of [{price_cents:-1},{quantity:1.5},{width_meters:0},{depth_meters:.955},{name:''},{photo:{original:'data:image/png;base64,PHNjcmlwdD4=',thumb:picture}}])assert.equal((await request('/api/v2/ready-models','POST',{...body(),...override})).status,400)
})
test('storage and database failures preserve records and remove incomplete photo uploads',async()=>{
 const count=objects.size;failUpload=true;assert.equal((await request('/api/v2/ready-models','POST',body())).status,500);failUpload=false;assert.equal(objects.size,count)
 failWrite=true;assert.equal((await request('/api/v2/ready-models','POST',body())).status,500);failWrite=false;assert.equal(objects.size,count)
})
test('the existing made-to-order models retain their own pricing and trash flow',async()=>{
 const models=load('lib/models-v2-db.js');await models.ensureSchema()
 const a=await models.createModel('a',{name:'Sob encomenda',base_meters:2.1,target_profit_cents:60000,sale_price_cents:60200,category:'Sofá fixo'});assert.equal(a.base_meters,2.1);assert.equal(a.sale_price_cents,60200)
 await models.deactivateModel('a',a.id);const item=(await pool.query("SELECT * FROM app_trash_v1 WHERE kind='model' AND record_key=$1",[a.id])).rows[0];await trash.transaction(pool,c=>trash.restore(c,'a',item.id));assert.equal((await models.getModel('a',a.id)).sale_price_cents,60200)
})
test('card surcharge persists, preserves cash price, and omitted rates remain unchanged',async()=>{
 const a=(await request('/api/v2/ready-models','POST',{...body(),card_rate_percent:12})).data
 assert.equal(a.price_cents,150000);assert.equal(a.card_rate_percent,12);assert.equal(a.card_price_cents,168000)
 const next={...body(),revision:a.revision,quantity:3};delete next.photo
 const b=await request('/api/v2/ready-models/'+a.id,'PUT',next)
 assert.equal(b.status,200);assert.equal(b.data.card_rate_percent,12);assert.equal(b.data.price_cents,150000)
 const cleared=await request('/api/v2/ready-models/'+a.id,'PUT',{...next,revision:2,card_rate_percent:0})
 assert.equal(cleared.data.card_price_cents,150000)
 for(const card_rate_percent of [-1,16,2.5,'12'])assert.equal((await request('/api/v2/ready-models','POST',{...body(),card_rate_percent})).status,400)
})
test('additive migration defaults existing models to zero without changing prices or stock',async()=>{
 const row=(await request('/api/v2/ready-models','POST',body())).data
 await pool.query('ALTER TABLE app_ready_models_v1 DROP COLUMN card_rate_percent');await db.ensureSchema()
 const existing=await db.get('a',row.id);assert.equal(existing.card_rate_percent,0);assert.equal(Number(existing.price_cents),150000);assert.equal(existing.quantity,2)
})
test('description stores all details, preserves legacy fabric and survives clearing and migration',async()=>{
 const a=(await request('/api/v2/ready-models','POST',{...body(),description:'Linho bege; espuma D33; pés de madeira.'})).data
 assert.equal(a.description,'Linho bege; espuma D33; pés de madeira.')
 const input={...body(),description:'',revision:1};delete input.photo
 assert.equal((await request('/api/v2/ready-models/'+a.id,'PUT',input)).data.description,'')
 await db.ensureSchema();assert.equal((await db.get('a',a.id)).description,'')
 const legacy=(await request('/api/v2/ready-models','POST',body())).data;assert.equal(legacy.description,'Linho bege')
 await pool.query("UPDATE app_ready_models_v1 SET description='',fabric='Suede azul' WHERE id=$1",[legacy.id]);await db.ensureSchema();assert.equal((await db.get('a',legacy.id)).description,'Suede azul')
 assert.equal((await request('/api/v2/ready-models','POST',{...body(),description:'x'.repeat(1001)})).status,400)
})
