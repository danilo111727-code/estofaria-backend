// Integration tests: install @electric-sql/pglite and express in a temporary prefix; include it in NODE_PATH.
'use strict'
const {test,before,after}=require('node:test')
const assert=require('node:assert/strict')
const vm=require('node:vm')
const fs=require('node:fs')
const path=require('node:path')
const {PGlite}=require('@electric-sql/pglite')
const root=path.join(__dirname,'../src')
let pg,db,retro,storage,company
const year=new Date().getUTCFullYear()
function load(file,requires,clock=Date){const ctx={module:{exports:{}},require:name=>{if(name in requires)return requires[name];throw new Error(name)},Date:clock,Intl,console};vm.runInNewContext(fs.readFileSync(path.join(root,file),'utf8'),ctx);return ctx.module.exports}
before(async()=>{
  pg=new PGlite()
  await pg.exec(`CREATE TABLE app_agenda_orders_v2(company_id text,id text,bloco_id text,cliente text,descricao text,prod_date text,ent_date text,status text,tecido text,qtd int,source_quote_id text,payload jsonb,created_at timestamptz,updated_at timestamptz);
    CREATE TABLE app_quotes_v2(id text,company_id text,cliente text,status text,total_cents bigint,payload_meta jsonb,created_at timestamptz,updated_at timestamptz,active boolean);`)
  storage=load('lib/revenue-adjustments-db.js',{'./store':{_pg:{pool:pg}}})
  db=load('lib/dashboard-v2-db.js',{'./store':{_pg:{pool:pg}}})
  retro=load('lib/dashboard-v2-retro.js',{'./dashboard-v2-db':db,'./revenue-adjustments-db':storage})
  company='revenue-test'
  for(let month=1;month<=12;month++){
    const date=`${year}-${String(month).padStart(2,'0')}-05`
    await pg.query('INSERT INTO app_agenda_orders_v2(company_id,id,cliente,descricao,status,prod_date,payload,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[company,'a'+month,'Cliente '+month,'Sofá','pendente',date,JSON.stringify({valor:month*100}),date+'T12:00:00-03:00'])
  }
  await pg.query(`INSERT INTO app_quotes_v2(id,company_id,cliente,status,total_cents,payload_meta,created_at,active) VALUES('v1',$1,'Sem agenda','pedido',350000,$2,$3,true)`,[company,JSON.stringify({data_pedido:`${year}-01-06`,agenda_status:'pendente'}),`${year}-01-06T12:00:00-03:00`])
  await pg.query(`INSERT INTO app_agenda_orders_v2(company_id,id,cliente,descricao,status,prod_date,payload,created_at) VALUES($1,'duplicado','Sem agenda','Sofá','pendente',$2,'{"valor":3500}',$3)`,[company,`${year}-01-08`,`${year}-01-08T12:00:00-03:00`])
  await pg.query(`INSERT INTO app_agenda_orders_v2(company_id,id,cliente,descricao,status,payload,created_at) VALUES('other','foreign','Outro cliente','Poltrona','pendente','{"valor":999}',NOW())`)
})
after(async()=>{await pg?.close()})
async function checkTotals(){
  const history=await retro.getRevenueHistory(company,year),summary=await retro.getSummary(company)
  assert.equal(history.total_cents,summary.faturamento_ano_cents)
  assert.equal(history.months.length,12)
  for(const month of history.months){assert.equal(month.total_cents,summary.charts.year_revenue_months[month.month].revenue_cents);assert.equal(month.records.reduce((s,r)=>s+r.amount_cents,0),month.total_cents)}
  return history
}
test('histórico tem os 12 meses, todas as origens e conciliação idêntica ao painel',async()=>{
  const history=await checkTotals()
  assert.equal(history.count,13)
  assert.equal(history.months[0].records.length,2)
  assert.ok(history.months[0].records.some(r=>r.key==='quote:v1'))
  assert.ok(!history.months[0].records.some(r=>r.key==='agenda:duplicado'))
  assert.equal(history.total_cents,1130000)
})
test('editar zero e valores exatos em centavos atualiza painel e preserva pedidos',async()=>{
  const before=await pg.query('SELECT * FROM app_agenda_orders_v2')
  await retro.adjustRevenue(company,'agenda:a1',{amount_cents:0,version:0},false)
  let history=await checkTotals();assert.equal(history.months[0].records.find(r=>r.key==='agenda:a1').amount_cents,0)
  await retro.adjustRevenue(company,'agenda:a1',{amount_cents:123456,version:1},false)
  history=await checkTotals();assert.equal(history.months[0].records.find(r=>r.key==='agenda:a1').amount_cents,123456)
  const after=await pg.query('SELECT * FROM app_agenda_orders_v2');assert.deepEqual(after.rows,before.rows)
})
test('excluir do faturamento mantém Agenda, Vendas e conciliação; não reaparece depois de agendar',async()=>{
  await retro.adjustRevenue(company,'quote:v1',{version:0},true)
  let history=await checkTotals();assert.ok(!history.months[0].records.some(r=>r.key==='quote:v1'))
  assert.equal((await pg.query("SELECT * FROM app_quotes_v2 WHERE id='v1'")).rows.length,1)
  await pg.query(`UPDATE app_agenda_orders_v2 SET source_quote_id='v1',bloco_id='b1' WHERE id='duplicado'`)
  history=await checkTotals();assert.ok(!history.months[0].records.some(r=>r.key==='quote:v1'))
  assert.equal((await db.activeOrders(await db.listDashboardOrders(company))).length,13)
})
test('conflito de versão impede sobrescrita entre telas',async()=>{
  const results=await Promise.allSettled([retro.adjustRevenue(company,'agenda:a2',{amount_cents:1,version:0},false),retro.adjustRevenue(company,'agenda:a2',{amount_cents:2,version:0},false)])
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1)
  assert.equal(results.find(r=>r.status==='rejected').reason.status,409)
  await checkTotals()
})
test('isolamento multiempresa e validação rejeitam alterações inválidas',async()=>{
  await assert.rejects(retro.adjustRevenue('other','agenda:a1',{amount_cents:1,version:0},false),e=>e.status===404)
  for(const amount of [-1,1.5,'100',null,1e15])await assert.rejects(retro.adjustRevenue(company,'agenda:a1',{amount_cents:amount,version:0},false),e=>e.status===400)
  await assert.rejects(retro.adjustRevenue(company,'agenda:a1',{amount_cents:1},false),e=>e.status===400)
  assert.equal((await retro.getRevenueHistory('other',year)).count,1)
})
test('rotas exigem autenticação, permissão e contexto de empresa',async()=>{
  const express=require('express')
  const http=require('node:http')
  const calls=[]
  const auth={requireAuth:(req,res,next)=>{if(!req.headers['x-test-company'])return res.status(401).json({});req.user={company_id:req.headers['x-test-company'],permissions:(req.headers['x-test-permissions']||'').split(',')};next()},requirePermission:p=>(req,res,next)=>req.user.permissions.includes(p)?next():res.status(403).json({})}
  const router=load('routes/dashboard-v2.js',{'express':express,'../lib/policies':{hasMasterAccess:()=>false},'../lib/dashboard-v2-retro':{availableRevenueYears:retro.availableRevenueYears,isAvailableRevenueYear:retro.isAvailableRevenueYear,getRevenueHistory:async(c,y)=>{calls.push([c,y]);return{year:y}},adjustRevenue:async(c,k)=>{calls.push([c,k]);return{version:1}}},'../middleware/auth':auth})
  const app=express();app.use(express.json());app.use(router)
  const server=http.createServer(app);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const url='http://127.0.0.1:'+server.address().port
  try{
    assert.equal((await fetch(url+'/dashboard/revenue-history')).status,401)
    assert.equal((await fetch(url+'/dashboard/revenue-history',{headers:{'x-test-company':company}})).status,403)
    assert.equal((await fetch(url+'/dashboard/revenue-history?company_id=other',{headers:{'x-test-company':company,'x-test-permissions':'painel'}})).status,200)
    assert.equal(calls.at(-1)[0],company)
    assert.equal((await fetch(url+'/dashboard/revenue-history/agenda:a1',{method:'PATCH',headers:{'x-test-company':company,'x-test-permissions':'painel','Content-Type':'application/json'},body:'{}'})).status,403)
    assert.equal((await fetch(url+'/dashboard/revenue-history/agenda:a1',{method:'PATCH',headers:{'x-test-company':company,'x-test-permissions':'configuracao','Content-Type':'application/json'},body:'{}'})).status,200)
    assert.equal((await fetch(url+'/dashboard/revenue-history?year=2999',{headers:{'x-test-company':company,'x-test-permissions':'painel'}})).status,400)
  }finally{await new Promise(resolve=>server.close(resolve))}
})

test('dois anos completos, bloqueio de anos fora da janela e virada de ano sem alterar pedidos',async()=>{
  const orders=[2028,2029,2030].map(year=>({id:'annual-'+year,cliente:'Cliente '+year,created_at:year+'-01-01T12:00:00-03:00',valor:100}))
  const original=structuredClone(orders)
  const clock=iso=>class extends Date{constructor(...args){super(...(args.length?args:[iso]))}static now(){return new Date(iso).getTime()}}
  const requires={'./dashboard-v2-db':{listDashboardOrders:async()=>orders,billableOrders:x=>x,revenueCents:()=>10000},'./revenue-adjustments-db':{list:async()=>new Map()}}
  const in2030=load('lib/dashboard-v2-retro.js',requires,clock('2030-12-31T23:59:00-03:00'))
  assert.deepEqual(Array.from(in2030.availableRevenueYears()),[2030,2029])
  assert.equal((await in2030.getRevenueHistory('annual',2029)).count,1)
  assert.equal((await in2030.getRevenueHistory('annual',2030)).count,1)
  for(const old of [2028,2031])await assert.rejects(in2030.getRevenueHistory('annual',old),e=>e.status===400)
  await assert.rejects(in2030.adjustRevenue('annual','agenda:annual-2028',{amount_cents:1,version:0},false),e=>e.status===404)
  const in2031=load('lib/dashboard-v2-retro.js',requires,clock('2031-01-01T00:00:00-03:00'))
  assert.deepEqual(Array.from(in2031.availableRevenueYears()),[2031,2030])
  assert.equal((await in2031.getRevenueHistory('annual',2030)).count,1)
  await assert.rejects(in2031.getRevenueHistory('annual',2029),e=>e.status===400)
  assert.deepEqual(orders,original)
})
test('limpeza dos ajustes é isolada por empresa e participa do rollback',async()=>{
  await storage.save('cleanup-target','agenda:one',100,false,0)
  await storage.save('cleanup-other','agenda:one',200,false,0)
  await pg.exec('BEGIN')
  assert.equal(await storage.deleteForCompany(pg,'cleanup-target'),1)
  assert.equal((await storage.list('cleanup-target')).size,0)
  assert.equal((await storage.list('cleanup-other')).size,1)
  await pg.exec('ROLLBACK')
  assert.equal((await storage.list('cleanup-target')).size,1)
  await pg.exec('BEGIN')
  assert.equal(await storage.deleteForCompany(pg,'cleanup-target'),1)
  await pg.exec('COMMIT')
  assert.equal((await storage.list('cleanup-target')).size,0)
  assert.equal((await storage.list('cleanup-other')).size,1)
})
test('excluir empresa antes de usar o histórico não exige a tabela de ajustes',async()=>{
  const empty=new PGlite()
  try{assert.equal(await storage.deleteForCompany(empty,'unused'),0)}finally{await empty.close()}
})
