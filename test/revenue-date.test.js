'use strict'
const {test,before,after}=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs')
const path=require('node:path')
const vm=require('node:vm')
const {PGlite}=require('@electric-sql/pglite')
const fixedNow='2026-10-21T01:30:00Z' // Ainda é 20/10 na Bahia.
class Clock extends Date{constructor(...args){super(...(args.length?args:[fixedNow]))}static now(){return Date.parse(fixedNow)}}
function load(file,requires){const ctx={module:{exports:{}},Date:Clock,Intl,console,require:name=>{if(name in requires)return requires[name];throw Error(name)}};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src',file),'utf8'),ctx);return ctx.module.exports}
let pg,storage,db,retro
before(async()=>{
  pg=new PGlite()
  await pg.exec(`CREATE TABLE app_agenda_orders_v2(company_id text,id text,bloco_id text,cliente text,descricao text,prod_date text,ent_date text,status text,tecido text,qtd int,source_quote_id text,payload jsonb,created_at timestamptz,updated_at timestamptz);
    CREATE TABLE app_quotes_v2(id text,company_id text,cliente text,status text,total_cents bigint,payload_meta jsonb,created_at timestamptz,updated_at timestamptz,active boolean);
    CREATE TABLE app_revenue_adjustments_v1(company_id text,record_key text,amount_cents bigint,removed boolean NOT NULL DEFAULT false,version integer NOT NULL DEFAULT 1,updated_at timestamptz NOT NULL DEFAULT NOW(),PRIMARY KEY(company_id,record_key));
    INSERT INTO app_revenue_adjustments_v1(company_id,record_key,amount_cents,version) VALUES('legacy','quote:old',12345,3);`)
  storage=load('lib/revenue-adjustments-db.js',{'./store':{_pg:{pool:pg}}})
  db=load('lib/dashboard-v2-db.js',{'./store':{_pg:{pool:pg}}})
  retro=load('lib/dashboard-v2-retro.js',{'./dashboard-v2-db':db,'./revenue-adjustments-db':storage})
})
after(async()=>pg?.close())
async function seed(company,kind='quote'){
  if(kind==='quote')await pg.query(`INSERT INTO app_quotes_v2(id,company_id,cliente,status,total_cents,payload_meta,created_at,active) VALUES($1,$2,'Cliente teste','pedido',250000,'{"data_pedido":"2026-10-05","agenda_status":"pendente"}','2026-10-05T12:00:00-03:00',true)`,[company,company])
  else await pg.query(`INSERT INTO app_agenda_orders_v2(id,company_id,cliente,status,payload,prod_date,created_at) VALUES($1,$2,'Cliente teste','pendente','{"valor":2500}','2026-10-05','2026-10-05T12:00:00-03:00')`,[company,company])
  return kind+':'+company
}
async function rows(){return {quotes:(await pg.query('SELECT * FROM app_quotes_v2 ORDER BY company_id,id')).rows,agenda:(await pg.query('SELECT * FROM app_agenda_orders_v2 ORDER BY company_id,id')).rows}}
async function aligned(company,year=2026){
  const report=await retro.getRevenueHistory(company,year)
  if(year===2026){const summary=await retro.getSummary(company);assert.equal(report.total_cents,summary.faturamento_ano_cents);for(const m of report.months)assert.equal(m.total_cents,summary.charts.year_revenue_months[m.month].revenue_cents)}
  return report
}
test('migra a tabela existente sem perder ajustes antigos',async()=>{
  const old=(await storage.list('legacy')).get('quote:old')
  assert.equal(old.amount_cents,12345);assert.equal(old.version,3);assert.equal(old.revenue_date,null)
  await storage.ensureSchema();assert.equal((await storage.list('legacy')).size,1)
})
for(const kind of ['quote','agenda'])test(kind+': data transfere outubro para setembro sem alterar pedido ou agenda',async()=>{
  const company='move-'+kind,key=await seed(company,kind),before=await rows()
  assert.equal((await aligned(company)).months[9].total_cents,250000)
  await retro.adjustRevenue(company,key,{amount_cents:250000,revenue_date:'2026-09-15',version:0},false)
  const report=await aligned(company),summary=await retro.getSummary(company)
  assert.equal(report.months[9].count,0);assert.equal(report.months[8].total_cents,250000);assert.equal(report.total_cents,250000)
  assert.equal(report.months[8].records[0].revenue_date,'2026-09-15')
  assert.equal(report.months[8].records[0].date,'2026-09-15T15:00:00.000Z')
  assert.equal(summary.faturamento_cents,0);assert.equal(summary.charts.last6_months.find(m=>m.month===8).revenue_cents,250000)
  assert.deepEqual(await rows(),before)
  // Um novo fechamento/agendamento não substitui a competência ajustada.
  if(kind==='quote')await pg.query("UPDATE app_quotes_v2 SET updated_at=NOW() WHERE id=$1",[company])
  else await pg.query("UPDATE app_agenda_orders_v2 SET prod_date='2026-11-20' WHERE id=$1",[company])
  assert.equal((await aligned(company)).months[8].total_cents,250000)
})
test('move entre anos e mantém a data ao editar só o valor por um cliente antigo',async()=>{
  const company='annual-date',key=await seed(company),before=await rows()
  await retro.adjustRevenue(company,key,{amount_cents:250000,revenue_date:'2025-12-31',version:0},false)
  assert.equal((await aligned(company)).total_cents,0)
  let old=await aligned(company,2025);assert.equal(old.months[11].total_cents,250000)
  await retro.adjustRevenue(company,key,{amount_cents:123456,version:1},false)
  old=await aligned(company,2025);assert.equal(old.months[11].total_cents,123456);assert.equal(old.months[11].records[0].revenue_date,'2025-12-31')
  await retro.adjustRevenue(company,key,{amount_cents:123456,revenue_date:'2026-09-01',version:2},false)
  assert.equal((await aligned(company,2025)).count,0);assert.equal((await aligned(company)).months[8].total_cents,123456)
  assert.deepEqual(await rows(),before)
})
test('excluir um registro transferido não reintroduz faturamento no mês original',async()=>{
  const company='removed-date',key=await seed(company)
  await retro.adjustRevenue(company,key,{amount_cents:250000,revenue_date:'2026-09-01',version:0},false)
  await retro.adjustRevenue(company,key,{version:1},true)
  assert.equal((await aligned(company)).count,0)
  const adjustment=(await storage.list(company)).get(key);assert.equal(adjustment.removed,true);assert.equal(adjustment.revenue_date,'2026-09-01')
  assert.equal((await pg.query('SELECT id FROM app_quotes_v2 WHERE company_id=$1',[company])).rows.length,1)
})
test('valida datas reais, limite de dois anos e hoje pelo horário da Bahia',async()=>{
  const company='invalid-date',key=await seed(company)
  for(const date of ['2026-02-31','2026-02-29','2026-13-01','2026-00-10','2026-09-00','2026-9-01','2026-09-01T12:00:00Z','2024-12-31','2026-10-21','2027-01-01','',null,1])await assert.rejects(retro.adjustRevenue(company,key,{amount_cents:250000,revenue_date:date,version:0},false),e=>e.status===400,String(date))
  assert.equal((await storage.list(company)).size,0)
  await retro.adjustRevenue(company,key,{amount_cents:250000,revenue_date:'2026-10-20',version:0},false)
  const report=await aligned(company);assert.equal(report.max_date,'2026-10-20');assert.equal(report.min_date,'2025-01-01');assert.equal(report.months[9].records[0].revenue_date,'2026-10-20')
})
test('edições simultâneas de valor e data são atômicas e isoladas por empresa',async()=>{
  const company='concurrent-date',key=await seed(company)
  const choices=[{amount_cents:111111,revenue_date:'2026-09-01',version:0},{amount_cents:222222,revenue_date:'2026-08-01',version:0}]
  const results=await Promise.allSettled(choices.map(body=>retro.adjustRevenue(company,key,body,false)))
  const winner=results.findIndex(r=>r.status==='fulfilled');assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results[1-winner].reason.status,409)
  const row=(await storage.list(company)).get(key);assert.equal(row.amount_cents,choices[winner].amount_cents);assert.equal(row.revenue_date,choices[winner].revenue_date)
  await assert.rejects(retro.adjustRevenue('foreign-company',key,{amount_cents:1,revenue_date:'2026-09-01',version:1},false),e=>e.status===404)
  assert.equal((await storage.list('foreign-company')).size,0);await aligned(company)
})
test('PATCH HTTP transfere a data, mantém permissões e retorna erros de validação e conflito',async()=>{
  const express=require('express'),company='route-date',key=await seed(company)
  const auth={requireAuth:(req,res,next)=>{if(!req.headers['x-test-company'])return res.status(401).json({});req.user={company_id:req.headers['x-test-company'],permissions:(req.headers['x-test-permissions']||'').split(',')};next()},requirePermission:p=>(req,res,next)=>req.user.permissions.includes(p)?next():res.status(403).json({})}
  const router=load('routes/dashboard-v2.js',{'express':express,'../lib/policies':{hasMasterAccess:()=>false},'../lib/dashboard-v2-retro':retro,'../middleware/auth':auth})
  const app=express();app.use(express.json());app.use(router);app.use((err,req,res,next)=>res.status(err.status||500).json({message:err.message}))
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve))
  const url='http://127.0.0.1:'+server.address().port+'/dashboard/revenue-history/'+encodeURIComponent(key)
  const patch=(body,permission='configuracao')=>fetch(url,{method:'PATCH',headers:{'x-test-company':company,'x-test-permissions':permission,'Content-Type':'application/json'},body:JSON.stringify(body)})
  try{
    assert.equal((await patch({amount_cents:250000,revenue_date:'2026-09-12',version:0},'painel')).status,403)
    assert.equal((await patch({amount_cents:250000,revenue_date:'2026-09-12',version:0})).status,200)
    assert.equal((await aligned(company)).months[8].records[0].revenue_date,'2026-09-12')
    assert.equal((await patch({amount_cents:1,revenue_date:'2026-08-01',version:0})).status,409)
    assert.equal((await patch({amount_cents:1,revenue_date:'2026-10-21',version:1})).status,400)
  }finally{await new Promise(resolve=>server.close(resolve))}
})
