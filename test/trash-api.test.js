'use strict'
const {test,before,after}=require('node:test'),assert=require('assert/strict'),fs=require('fs'),vm=require('vm'),path=require('path'),express=require('express')
const {PGlite}=require('@electric-sql/pglite')
let pg,pool,store,atomic,trash,server,base
function load(file,requires){const mod={exports:{}};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src',file),'utf8'),{module:mod,require:n=>{if(n in requires)return requires[n];return require(n)},console,Date,Intl,Buffer,setTimeout:(fn,ms)=>{const t=setTimeout(fn,ms);t.unref();return t},clearTimeout,setInterval,clearInterval});return mod.exports}
before(async()=>{
 pg=new PGlite();pool={query:async(s,p=[])=>{const r=p.length?await pg.query(s,p):(await pg.exec(s)).at(-1);return {...r,rowCount:r.affectedRows??r.rows?.length??0}},connect:async()=>({...pool,release(){}})}
 let current={companies:[{id:'a'},{id:'b'}],materials:[{id:1,company_id:'a',name:'Tecido'},{id:1,company_id:'b',name:'Espuma'}]}
 store={_pg:{pool},readStore:()=>JSON.parse(JSON.stringify(current)),writeStore:s=>{current=s},updateStore:fn=>{current=fn(current)||current},upsertAudit:(s,e)=>{s.auditLogs=(s.auditLogs||[]).concat(e)}}
 await pg.exec("CREATE TABLE kv_store(key text PRIMARY KEY,value jsonb,updated_at timestamptz DEFAULT NOW());")
 await pool.query("INSERT INTO kv_store(key,value)VALUES('main',$1::jsonb)",[JSON.stringify(current)])
 trash=load('lib/trash-db.js',{'./store':store,'./r2-storage':{isConfigured:()=>false}});await trash.ensureSchema(pool)
 atomic=load('lib/atomic-store.js',{'./trash-db':trash,'./audit-v2-db':{isEnabled:()=>false}});atomic.install(store)
 const policies={hasMasterAccess:u=>u?.role==='master',hasPermission:(u,p)=>u?.role==='master'||u?.permissions?.includes(p)}
 const auth={requireAuth:(req,res,next)=>{try{req.user=JSON.parse(req.headers['x-user']||'null')}catch(e){};if(!req.user)return res.status(401).json({message:'Não autenticado'});next()}}
 const router=load('routes/trash.js',{'express':express,'../middleware/auth':auth,'../lib/policies':policies,'../lib/store':store,'../lib/atomic-store':atomic,'../lib/trash-db':trash,'../lib/orphan-agenda-db':{}})
 const app=express();app.use(express.json());app.use(atomic.middleware);app.use('/api',router)
 app.delete('/api/materials/:id',(req,res)=>{const s=store.readStore();s.materials=s.materials.filter(r=>!(r.company_id==='a'&&r.id===Number(req.params.id)));store.writeStore(s);res.json({ok:true})})
 app.use((e,req,res,next)=>res.status(500).json({message:e.message}));server=app.listen(0);base='http://127.0.0.1:'+server.address().port
})
after(async()=>{await new Promise(r=>server.close(r));await pg.close()})
async function request(method,url,user,body){const r=await fetch(base+url,{method,headers:{'content-type':'application/json',...user?{'x-user':JSON.stringify(user)}:{}},...body?{body:JSON.stringify(body)}:{}});return {status:r.status,data:await r.json()}}
const full={company_id:'a',permissions:['configuracao','material','vendedor']}
test('API exige sessão e permissão de Configurações',async()=>{
 assert.equal((await request('GET','/api/trash')).status,401)
 assert.equal((await request('GET','/api/trash',{company_id:'a',permissions:['material']})).status,403)
})
test('exclusão legada e lixeira são confirmadas na mesma transação; recuperar atualiza store',async()=>{
 assert.equal((await request('DELETE','/api/materials/1',full)).status,200)
 assert.equal(store.readStore().materials.filter(r=>r.company_id==='a').length,0)
 const list=await request('GET','/api/trash?category=materiais',full);assert.equal(list.status,200);assert.equal(list.data.items.length,1)
 const id=list.data.items[0].id
 const foreign=await request('POST','/api/trash/'+id+'/restore',{...full,company_id:'b'},{});assert.equal(foreign.status,404)
 const restored=await request('POST','/api/trash/'+id+'/restore',full,{});assert.equal(restored.status,200)
 assert.equal(store.readStore().materials.filter(r=>r.company_id==='a').length,1)
 assert.equal((await request('GET','/api/trash?category=materiais',full)).data.items.length,0)
 assert.equal((await request('POST','/api/trash/'+id+'/restore',full,{})).status,404)
 const persisted=(await pool.query("SELECT value FROM kv_store WHERE key='main'")).rows[0].value
 assert.equal(persisted.materials.length,2);assert.equal(persisted.auditLogs.at(-1).action,'trash.restore')
})
test('seletor de empresa do navegador não permite acesso cruzado; categorias respeitam módulo',async()=>{
 const result=await request('GET','/api/trash?company_id=b',full)
 assert.equal(result.status,200);assert.deepEqual(result.data.categories.map(r=>r.key),['materiais','vendas'])
 assert.equal((await request('GET','/api/trash?category=financeiro',full)).status,403)
})
test('importação de recuperação fica restrita ao master',async()=>{
 assert.equal((await request('POST','/api/trash/import-recovery',full,{bundle:{}})).status,403)
 assert.equal((await request('POST','/api/trash/import-recovery',{role:'master',company_id:'a'},{bundle:{}})).status,400)
})
