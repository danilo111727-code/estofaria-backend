'use strict'
const {test,before,beforeEach,after}=require('node:test')
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path')
const {Pool}=require('pg')
const url=process.env.AGENDA_TEST_DATABASE_URL
if(!url)throw Error('AGENDA_TEST_DATABASE_URL obrigatório: PostgreSQL local descartável.')
const target=new URL(url)
if(!['localhost','127.0.0.1'].includes(target.hostname)||target.pathname!=='/agenda_capacity_test')throw Error('Use somente o banco local descartável agenda_capacity_test.')
const pool=new Pool({connectionString:url,max:16})
const mod={exports:{}}
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/lib/agenda-v2-db.js'),'utf8'),{
  module:mod,require:n=>n==='./store'?{_pg:{pool}}:n==='./trash-db'?{}:
    n==='./agenda-financial-dates'?require('../src/lib/agenda-financial-dates'):require(n),Date,console
})
const db=mod.exports
before(()=>db.ensureSchema())
beforeEach(()=>pool.query('TRUNCATE app_agenda_orders_v2,app_agenda_blocos_v2'))
after(()=>pool.end())
const block=(id='block',capacity=1,company='a')=>db.createBlock(company,{id,qtd_vagas:capacity})
const count=async(company='a')=>Number((await pool.query('SELECT count(*)::int n FROM app_agenda_orders_v2 WHERE company_id=$1',[company])).rows[0].n)
test('oito agendamentos na última vaga aceitam exatamente um pedido',async()=>{
  await block();const results=await Promise.all(Array.from({length:8},(_,i)=>db.createBlockOrder('a','block',{id:'o'+i})))
  assert.equal(results.filter(x=>x.row).length,1);assert.equal(results.filter(x=>x.full).length,7);assert.equal(await count(),1)
})
test('oito cliques para o mesmo orçamento não duplicam pedido ou ocupação',async()=>{
  await block('block',8);const results=await Promise.all(Array.from({length:8},()=>db.createBlockOrder('a','block',{source_quote_id:'quote'})))
  assert.equal(new Set(results.map(x=>x.row.id)).size,1);assert.equal(await count(),1);assert.equal(results.filter(x=>x.replayed).length,7)
})
test('mesmo orçamento em dois blocos concorrentes fica em apenas um',async()=>{
  await block('one');await block('two');const results=await Promise.allSettled(['one','two'].map(id=>db.createBlockOrder('a',id,{source_quote_id:'quote'})))
  assert.equal(results.filter(x=>x.status==='fulfilled').length,1)
  assert.equal(results.find(x=>x.status==='rejected').reason.code,'order_already_scheduled');assert.equal(await count(),1)
})
test('aumentos concorrentes de capacidade não se perdem',async()=>{
  await block();await Promise.all(Array.from({length:8},()=>db.changeSlots('a','block',1)))
  assert.equal((await db.getBlock('a','block')).qtd_vagas,9)
})
test('remoção concorrente de vagas respeita pedidos ocupados',async()=>{
  await block('block',3);await db.createBlockOrder('a','block',{})
  const results=await Promise.all(Array.from({length:8},()=>db.changeSlots('a','block',-1)))
  assert.equal((await db.getBlock('a','block')).qtd_vagas,1);assert.equal(results.filter(x=>x.noEmptySlots).length,6)
})
test('duas entregas simultâneas do mesmo pedido consomem apenas uma vaga',async()=>{
  await block('block',3);const created=await db.createBlockOrder('a','block',{})
  const results=await Promise.all(Array.from({length:8},()=>db.deliverOrderAndConsumeSlot('a',created.row.id)))
  assert.equal((await db.getBlock('a','block')).qtd_vagas,2);assert.equal(results.filter(x=>x.alreadyDelivered).length,7)
})
test('POST genérico não ultrapassa a capacidade do bloco',async()=>{
  await block();const results=await Promise.allSettled(Array.from({length:8},()=>db.createOrder('a',{bloco_id:'block'})))
  assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal(await count(),1)
  assert.ok(results.filter(x=>x.status==='rejected').every(x=>x.reason.code==='bloco_full'))
})
test('PATCH não move nem reativa um pedido em bloco lotado',async()=>{
  await block();await db.createBlockOrder('a','block',{})
  const pending=await db.createOrder('a',{})
  await assert.rejects(db.updateOrder('a',pending.id,{bloco_id:'block'}),e=>e.code==='bloco_full')
  const cancelled=await db.createOrder('a',{bloco_id:'block',status:'cancelado'})
  await assert.rejects(db.updateOrder('a',cancelled.id,{status:'pendente'}),e=>e.code==='bloco_full')
  assert.equal((await db.getOrder('a',cancelled.id)).status,'cancelado')
})
test('edição direta não reduz capacidade abaixo da ocupação',async()=>{
  await block('block',2);await db.createBlockOrder('a','block',{});await db.createBlockOrder('a','block',{})
  await assert.rejects(db.updateBlock('a','block',{qtd_vagas:1}),e=>e.code==='capacity_below_occupied')
  assert.equal((await db.getBlock('a','block')).qtd_vagas,2)
})
test('empresa diferente não espera o bloqueio de outra empresa',async()=>{
  await block('block',1,'b');const client=await pool.connect();let timer
  try{
    await client.query('BEGIN');await client.query("SELECT pg_advisory_xact_lock(hashtext('agenda-capacity-v1'),hashtext('a'))")
    const result=await Promise.race([db.createBlockOrder('b','block',{}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('empresas indevidamente bloqueadas')),2000)})])
    assert.equal(result.row.company_id,'b')
  }finally{clearTimeout(timer);await client.query('ROLLBACK');client.release()}
})
test('falha e rollback liberam a Agenda para uma nova tentativa',async()=>{
  await block('block',2);await db.createBlockOrder('a','block',{id:'same'})
  await assert.rejects(db.createBlockOrder('a','block',{id:'same'}),e=>e.code==='23505')
  const result=await db.createBlockOrder('a','block',{id:'next'});assert.equal(result.row.id,'next');assert.equal(await count(),2)
})
