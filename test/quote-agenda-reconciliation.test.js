'use strict'

const {test}=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs')
const path=require('node:path')
const vm=require('node:vm')
const {reconcileCompanyAgenda}=require('../src/lib/quote-agenda-reconciliation')
const context={module:{exports:{}},Date,Intl,require:()=>({})}
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/lib/dashboard-v2-db.js'),'utf8'),context)
const helpers=context.module.exports

function fixture(){return {
 quotes:[{id:'q1',company_id:'c1',cliente:'Danilo Santana Ferreira',active:true,status:'pedido',total_cents:500000,
   created_at:new Date('2026-10-01T15:00:00Z'),payload_meta:{agenda_status:'pendente',data_pedido:'2026-10-01',saldo_restante:1000}}],
 agenda:[{id:'a1',company_id:'c1',cliente:'Danilo Santana Ferreira',bloco_id:'b1',status:'pendente',
   created_at:new Date('2026-10-02T15:00:00Z'),prod_date:'2026-11-01',ent_date:'2026-11-15',payload:{valor:5000}}]
}}

function database(initial,fail=false){
 let state=structuredClone(initial),snapshot=null
 const calls=[]
 const pool={connect:async()=>({release(){},async query(sql,args=[]){
  calls.push(sql)
  if(sql==='BEGIN'){snapshot=structuredClone(state);return {rows:[]}}
  if(sql==='COMMIT'){snapshot=null;return {rows:[]}}
  if(sql==='ROLLBACK'){state=snapshot;snapshot=null;return {rows:[]}}
  assert.match(sql,/company_id=\$1/)
  if(sql.startsWith('SELECT * FROM app_quotes_v2')){
   assert.match(sql,/ORDER BY id FOR UPDATE/)
   return {rows:structuredClone(state.quotes.filter(q=>q.company_id===args[0]&&q.active&&q.status==='pedido'))}
  }
  if(sql.startsWith('SELECT * FROM app_agenda_orders_v2')){
   assert.match(sql,/ORDER BY id FOR UPDATE/)
   return {rows:structuredClone(state.agenda.filter(a=>a.company_id===args[0]))}
  }
  if(sql.startsWith('UPDATE app_agenda_orders_v2')){
   const row=state.agenda.find(a=>a.company_id===args[0]&&a.id===args[1])
   row.source_quote_id=args[2];row.payload={...row.payload,source_quote_id:args[2]}
   return {rows:[]}
  }
  if(sql.startsWith('UPDATE app_quotes_v2')){
   if(fail)throw new Error('forced failure')
   const row=state.quotes.find(q=>q.company_id===args[0]&&q.id===args[1])
   row.payload_meta=JSON.parse(args[2]);return {rows:[]}
  }
  throw new Error('Unexpected query '+sql)
 }})}
 return {pool,calls,get state(){return state}}
}

test('Conciliação única vincula manual existente e muda aguardando para agendado',async()=>{
 const state=fixture(),db=database(state)
 const result=await reconcileCompanyAgenda(db.pool,'c1',helpers)
 assert.equal(result.linked,1);assert.equal(result.scheduled,1)
 assert.equal(db.state.agenda[0].source_quote_id,'q1')
 assert.equal(db.state.quotes[0].payload_meta.agenda_status,'agendado')
 assert.equal(db.state.quotes[0].payload_meta.agenda_bloco_id,'b1')
 assert.equal(db.state.quotes[0].payload_meta.agenda_order_id,'a1')
 assert.equal(db.state.quotes[0].payload_meta.saldo_restante,1000)
 assert.equal(db.state.quotes[0].total_cents,500000)
 assert.equal(db.state.quotes[0].payload_meta.data_pedido,'2026-10-01')
 assert.equal(db.state.agenda[0].prod_date,state.agenda[0].prod_date)
 assert.equal(db.state.agenda[0].ent_date,state.agenda[0].ent_date)
 assert.deepEqual(db.state.agenda[0].created_at,state.agenda[0].created_at)
})

test('Repetir a conciliação não cria registros nem regrava status',async()=>{
 const db=database(fixture())
 await reconcileCompanyAgenda(db.pool,'c1',helpers)
 const result=await reconcileCompanyAgenda(db.pool,'c1',helpers)
 assert.equal(result.linked,0);assert.equal(result.scheduled,0)
 assert.equal(db.state.agenda.length,1)
})

test('Sem bloco, cancelado ou indisponível não vira agendado',async()=>{
 for(const mode of ['no-block','cancelado','indisponivel']){
  const state=fixture()
  if(mode==='no-block')state.agenda[0].bloco_id=null
  else state.agenda[0].status=mode
  const db=database(state),result=await reconcileCompanyAgenda(db.pool,'c1',helpers)
  assert.equal(result.linked,0);assert.equal(result.scheduled,0)
  assert.deepEqual(db.state,state)
 }
})

test('Depois de cancelar o bloco, o pedido vinculado volta a aguardar',async()=>{
 const db=database(fixture())
 await reconcileCompanyAgenda(db.pool,'c1',helpers)
 db.state.agenda[0].bloco_id=null
 const result=await reconcileCompanyAgenda(db.pool,'c1',helpers)
 assert.equal(result.unscheduled,1)
 assert.equal(db.state.quotes[0].payload_meta.agenda_status,'pendente')
})

test('Duas correspondências manuais ou no Vendedor impedem vínculo automático',async()=>{
 for(const mode of ['manual','vendor']){
  const state=fixture()
  if(mode==='manual')state.agenda.push({...state.agenda[0],id:'a2'})
  else state.quotes.push({...state.quotes[0],id:'q2'})
  const db=database(state),result=await reconcileCompanyAgenda(db.pool,'c1',helpers)
  assert.equal(result.linked,0);assert.equal(result.scheduled,0)
  assert.deepEqual(db.state,state)
 }
})

test('Mantém limite de 14 dias, mesmo cliente e mesmo valor',async()=>{
 for(const mode of ['late','different-value','different-name']){
  const state=fixture()
  if(mode==='late')state.agenda[0].created_at=new Date('2026-10-16T15:00:00Z')
  if(mode==='different-value')state.agenda[0].payload.valor=5001
  if(mode==='different-name')state.agenda[0].cliente='Outra pessoa'
  const db=database(state),result=await reconcileCompanyAgenda(db.pool,'c1',helpers)
  assert.equal(result.linked,0);assert.deepEqual(db.state,state)
 }
})

test('Vínculo explícito de pedido em bloco corrige somente metadados do Vendedor',async()=>{
 const state=fixture();state.agenda[0].source_quote_id='q1'
 const db=database(state),result=await reconcileCompanyAgenda(db.pool,'c1',helpers)
 assert.equal(result.linked,0);assert.equal(result.scheduled,1)
 assert.equal(db.state.quotes[0].payload_meta.agenda_status,'agendado')
})

test('Pronta entrega nunca é rebaixada para agendado',async()=>{
 const state=fixture()
 Object.assign(state.quotes[0].payload_meta,{vendido_pronta_entrega:true,agenda_status:'pronta_entrega'})
 const db=database(state),result=await reconcileCompanyAgenda(db.pool,'c1',helpers)
 assert.equal(result.linked,0);assert.equal(result.scheduled,0)
 assert.deepEqual(db.state,state)
})

test('Falha de status desfaz o vínculo; não deixa atualização parcial',async()=>{
 const state=fixture(),db=database(state,true)
 await assert.rejects(reconcileCompanyAgenda(db.pool,'c1',helpers),/forced failure/)
 assert.deepEqual(db.state,state)
})

test('Conciliação não cruza empresas nem converte orçamento em pedido',async()=>{
 const state=fixture();state.quotes[0].company_id='c2'
 let db=database(state),result=await reconcileCompanyAgenda(db.pool,'c1',helpers)
 assert.equal(result.linked,0);assert.deepEqual(db.state,state)
 state.quotes[0].company_id='c1';state.quotes[0].status='orcamento'
 db=database(state);result=await reconcileCompanyAgenda(db.pool,'c1',helpers)
 assert.equal(result.linked,0);assert.deepEqual(db.state,state)
})
