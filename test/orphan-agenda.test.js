'use strict'
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm'),path=require('path'),express=require('express')
const {PGlite}=require('@electric-sql/pglite')
let pg,pool,store,trash,orphans,dashboard,atomic,server,base
const cache={}
function load(file){
 const full=path.resolve(__dirname,'../src',file)
 if(cache[full])return cache[full].exports
 const mod={exports:{}};cache[full]=mod
 vm.runInNewContext(fs.readFileSync(full,'utf8'),{module:mod,require:n=>{
  if(n==='./store'||n==='../lib/store')return store
  if(n==='./r2-storage')return {isConfigured:()=>false}
  if(n==='./audit-v2-db')return {isEnabled:()=>false}
  if(n==='../middleware/auth')return {requireAuth:(req,res,next)=>{try{req.user=JSON.parse(req.headers['x-user']||'null')}catch(e){};if(!req.user)return res.sendStatus(401);next()}}
  if(n==='../lib/policies')return {hasMasterAccess:u=>u.role==='master',hasPermission:(u,p)=>u.role==='master'||u.permissions?.includes(p)}
  return n.startsWith('.')?load(path.relative(path.join(__dirname,'../src'),path.resolve(path.dirname(full),n+'.js'))):require(n)
 },console,Date,Intl,Buffer,setTimeout:(fn,ms)=>{const t=setTimeout(fn,ms);t.unref();return t},clearTimeout,setInterval,clearInterval},{filename:full});return mod.exports
}
async function q(sql,args=[]){return pool.query(sql,args)}
async function request(method,url,user,body){const r=await fetch(base+url,{method,headers:{'content-type':'application/json',...user?{'x-user':JSON.stringify(user)}:{}},...body?{body:JSON.stringify(body)}:{}});return {status:r.status,data:await r.json().catch(()=>null)}}
const user={company_id:'a',permissions:['configuracao','agenda']}
before(async()=>{
 pg=new PGlite();pool={query:async(s,p=[])=>{const r=p.length?await pg.query(s,p):(await pg.exec(s)).at(-1);return {...r,rowCount:r.affectedRows??r.rows?.length??0}},connect:async()=>({...pool,release(){}})}
 let current={companies:[{id:'a'},{id:'b'}]}
 store={_pg:{pool},readStore:()=>JSON.parse(JSON.stringify(current)),writeStore:s=>{current=s},updateStore:fn=>{current=fn(current)||current},upsertAudit:(s,e)=>{s.auditLogs=(s.auditLogs||[]).concat(e)}}
 for(const f of ['lib/agenda-v2-db.js','lib/quotes-v2-db.js','lib/financial-v2-db.js'])await load(f).ensureSchema()
 trash=load('lib/trash-db.js');await trash.ensureSchema(pool)
 orphans=load('lib/orphan-agenda-db.js');dashboard=load('lib/dashboard-v2-db.js')
 await pg.exec('CREATE TABLE kv_store(key text PRIMARY KEY,value jsonb,updated_at timestamptz DEFAULT NOW())')
 await q("INSERT INTO kv_store(key,value) VALUES('main',$1::jsonb)",[JSON.stringify(current)])
 atomic=load('lib/atomic-store.js');atomic.install(store)
 const app=express();app.use(express.json());app.use(atomic.middleware);app.use('/api',load('routes/trash.js'));app.use((e,req,res,next)=>res.status(500).json({message:e.message}))
 server=app.listen(0);base='http://127.0.0.1:'+server.address().port
 // A single active orphan, valid scheduled orders, delivered/cancelled orders,
 // a valid unscheduled sale, a hidden placeholder, and an unrelated company.
 await q("INSERT INTO app_quotes_v2(company_id,id,legacy_id,cliente,status,total_cents) VALUES('a','sale','old-sale','Sale','pedido',90000)")
 await q("INSERT INTO app_agenda_blocos_v2(company_id,id,qtd_vagas) VALUES('a','valid-block',5)")
 for(const [company,id,block,status,ref,payload] of [
 ['a','orphan',null,'pendente',null,{valor:123.45}],['a','scheduled','valid-block','pendente',null,{}],
 ['a','delivered',null,'entregue',null,{}],['a','cancelled',null,'cancelado',null,{}],
 ['a','vendor',null,'pendente','old-sale',{}],['b','foreign',null,'pendente',null,{}]
 ])await q("INSERT INTO app_agenda_orders_v2(company_id,id,bloco_id,cliente,descricao,status,source_quote_id,payload) VALUES($1,$2,$3,$2,'Sofá',$4,$5,$6::jsonb)",[company,id,block,status,ref,JSON.stringify(payload)])
 await q("INSERT INTO app_financial_entries_v2(company_id,id,tipo,status,valor,payload) VALUES('a','bill','receber','pendente',50,'{\"agenda_order_id\":\"orphan\"}')")
})
after(async()=>{await new Promise(r=>server.close(r));await pg.close()})
test('lista somente pendências órfãs contadas no Painel, com isolamento e permissões',async()=>{
 const r=await request('GET','/api/trash/orphans?company_id=b',user)
 assert.equal(r.status,200);assert.equal(r.data.total,1);assert.equal(r.data.items[0].id,'orphan');assert.equal(r.data.items[0].amount_cents,12345)
 assert.equal((await request('GET','/api/trash/orphans')).status,401)
 assert.equal((await request('GET','/api/trash/orphans',{company_id:'a',permissions:['configuracao']})).status,403)
 assert.equal((await request('POST','/api/trash/orphans/foreign/exclude',user,{})).status,404)
})
test('recusa registro alterado ou reagendado desde a consulta sem excluí-lo',async()=>{
 const row=(await orphans.list('a')).items[0]
 assert.equal((await request('POST','/api/trash/orphans/orphan/exclude',user,{})).status,409)
 await q("UPDATE app_agenda_orders_v2 SET bloco_id='valid-block' WHERE company_id='a' AND id='orphan'")
 assert.equal((await request('POST','/api/trash/orphans/orphan/exclude',user,{expected_updated_at:row.updated_at})).status,409)
 await q("UPDATE app_agenda_orders_v2 SET bloco_id=null,updated_at=updated_at+INTERVAL '1 second' WHERE company_id='a' AND id='orphan'")
 assert.equal((await request('POST','/api/trash/orphans/orphan/exclude',user,{expected_updated_at:row.updated_at})).status,409)
})
test('excluir retira um ativo e lembrete, preserva todo faturamento e financeiro, e restaura por 30 dias',async()=>{
 const before=await dashboard.getSummary('a'),row=(await orphans.list('a')).items[0]
 const financial=JSON.stringify((await q('SELECT * FROM app_financial_entries_v2 ORDER BY id')).rows)
 const result=await request('POST','/api/trash/orphans/orphan/exclude',user,{expected_updated_at:row.updated_at})
 assert.equal(result.status,200)
 const after=await dashboard.getSummary('a')
 assert.equal(after.pedidos,before.pedidos-1)
 for(const key of ['faturamento_cents','faturamento_ano_cents','pedidos_ano','charts'])assert.deepEqual(after[key],before[key])
 assert.equal(JSON.stringify((await q('SELECT * FROM app_financial_entries_v2 ORDER BY id')).rows),financial)
 assert.equal((await dashboard.listReminderOrders('a')).some(o=>o.id==='orphan'),false)
 assert.equal((await orphans.list('a')).total,0)
 const item=(await q('SELECT * FROM app_trash_v1 WHERE id=$1',[result.data.trash_id])).rows[0]
 assert.equal(item.kind,'agenda-orphan');assert.equal(Math.round((new Date(item.expires_at)-new Date(item.deleted_at))/86400000),30)
 assert.equal((await request('POST','/api/trash/orphans/orphan/exclude',user,{expected_updated_at:row.updated_at})).status,409)
 assert.equal((await request('POST','/api/trash/'+item.id+'/restore',user,{})).status,200)
 assert.equal((await dashboard.getSummary('a')).pedidos,before.pedidos)
 assert.equal((await orphans.list('a')).total,1)
 assert.equal(store.readStore().auditLogs.some(e=>e.action==='trash.orphan.exclude'),true)
})
test('falha ao arquivar desfaz a alteração e mantém o pedido ativo',async()=>{
 const row=(await orphans.list('a')).items[0],before=await dashboard.getSummary('a')
 await q('ALTER TABLE app_trash_v1 RENAME TO unavailable_trash')
 try{assert.equal((await request('POST','/api/trash/orphans/orphan/exclude',user,{expected_updated_at:row.updated_at})).status,500)}
 finally{await q('ALTER TABLE unavailable_trash RENAME TO app_trash_v1')}
 assert.equal((await orphans.list('a')).total,1);assert.equal((await dashboard.getSummary('a')).pedidos,before.pedidos)
})
test('recuperação não sobrescreve alteração posterior; expirar lixeira não altera faturamento',async()=>{
 const row=(await orphans.list('a')).items[0]
 const r=await request('POST','/api/trash/orphans/orphan/exclude',user,{expected_updated_at:row.updated_at})
 assert.equal(r.status,200)
 await q("UPDATE app_agenda_orders_v2 SET updated_at=updated_at+INTERVAL '1 second' WHERE id='orphan'")
 assert.equal((await request('POST','/api/trash/'+r.data.trash_id+'/restore',user,{})).status,409)
 const before=await dashboard.getSummary('a')
 await q("UPDATE app_trash_v1 SET expires_at=NOW()-INTERVAL '1 second' WHERE id=$1",[r.data.trash_id]);await trash.purgeExpired(pool)
 assert.deepEqual(await dashboard.getSummary('a').then(({generated_at,...s})=>s),((({generated_at,...s})=>s)(before)))
})
