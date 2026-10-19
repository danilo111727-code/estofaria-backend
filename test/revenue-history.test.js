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
function load(file,requires){const ctx={module:{exports:{}},require:name=>{if(name in requires)return requires[name];throw new Error(name)},Date,Intl,console};vm.runInNewContext(fs.readFileSync(path.join(root,file),'utf8'),ctx);return ctx.module.exports}
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
  const router=load('routes/dashboard-v2.js',{'express':express,'../lib/policies':{hasMasterAccess:()=>false},'../lib/dashboard-v2-retro':{getRevenueHistory:async(c,y)=>{calls.push([c,y]);return{year:y}},adjustRevenue:async(c,k)=>{calls.push([c,k]);return{version:1}}},'../middleware/auth':auth})
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
