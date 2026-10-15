'use strict'

const {test} = require('node:test')
const assert = require('node:assert/strict')
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path')
const helperContext={module:{exports:{}},Date,Intl,require:()=>({})}
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/lib/dashboard-v2-db.js'),'utf8'),helperContext)
const helpers=helperContext.module.exports
const {deleteQuoteWithAgenda,markReadyDelivery} = require('../src/lib/quote-order-lifecycle')

function fixture(overrides={}){
  return {
    quotes:[{id:'q1',legacy_id:'old-1',company_id:'c1',cliente:'Cliente',status:'pedido',active:true,
      total_cents:'500000',payload_meta:{agenda_status:'pendente',data_pedido:'2026-10-01',saldo_restante:2000,forma_pagamento:'Pix'}}],
    agenda:[],models:[{company_id:'c1',quote_id:'q1',model_id:'m1',model_name:'Sofá Elegance'}],...overrides
  }
}

function reference(row){
  const p=row.payload || {}
  return [row.source_quote_id,p.source_quote_id,p.sourceQuoteId,p.quote_id,p.quoteId,p.orcamento_id,p.budget_id].find(Boolean) ||
    [row.tecido,row.descricao,p.observacao,p.observacoes,p.obs,p.notes].join(' ').match(/quote\s*:\s*([a-zA-Z0-9_-]+)/i)?.[1]
}

function database(initial,failPattern){
  let state=structuredClone(initial),snapshot=null
  const calls=[]
  let released=0
  const pool={connect:async()=>({
    release(){released++},
    async query(sql,args=[]){
      calls.push({sql,args})
      if(failPattern?.test(sql)) throw new Error('simulated write failure')
      if(sql==='BEGIN'){ snapshot=structuredClone(state);return {rows:[]} }
      if(sql==='ROLLBACK'){ if(snapshot)state=snapshot; snapshot=null;return {rows:[]} }
      if(sql==='COMMIT'){ snapshot=null;return {rows:[]} }
      if(sql.startsWith('INSERT')) assert.match(sql,/\(company_id,.*VALUES \(\$1,/s)
      else assert.match(sql,/company_id=\$1/,'Todas as operações devem estar isoladas por empresa')
      if(sql.startsWith('SELECT') && sql.includes('FROM app_quotes_v2')){
        assert.match(sql,/FOR UPDATE/,'Bloquear o pedido evita duas entregas concorrentes')
        return {rows:structuredClone(state.quotes.filter(q=>q.company_id===args[0] && (args[1] === undefined || q.id===args[1]) && (!sql.includes('active=TRUE') || (q.active && (args[1] !== undefined || q.status==='pedido')))))}
      }
      if(sql.startsWith('SELECT') && sql.includes('FROM app_agenda_orders_v2')){
        assert.match(sql,/FOR UPDATE/)
        return {rows:structuredClone(state.agenda.filter(a=>a.company_id===args[0] && (args[1] === undefined || args[1].includes(reference(a)))))}
      }
      if(sql.startsWith('DELETE FROM app_agenda_orders_v2')){
        assert.match(sql,/ANY\(\$2::text\[\]\)/)
        state.agenda=state.agenda.filter(a=>!(a.company_id===args[0] && args[1].includes(reference(a))))
        return {rows:[]}
      }
      if(sql.startsWith('DELETE FROM app_quotes_v2')){
        state.quotes=state.quotes.filter(q=>!(q.company_id===args[0] && q.id===args[1]))
        return {rows:[{id:args[1]}]}
      }
      if(sql.startsWith('SELECT model_id')) return {rows:state.models.filter(m=>m.company_id===args[0] && m.quote_id===args[1])}
      if(sql.startsWith('INSERT INTO app_agenda_orders_v2')){
        state.agenda.push({company_id:args[0],id:args[1],bloco_id:null,cliente:args[2],descricao:args[3],prod_date:'',
          ent_date:args[4],status:'entregue',source_quote_id:args[5],payload:JSON.parse(args[6])})
        return {rows:[]}
      }
      if(sql.startsWith('UPDATE app_agenda_orders_v2')){
        const a=state.agenda.find(a=>a.company_id===args[0] && a.id===args[1])
        if(sql.includes('source_quote_id=$3')){
          a.source_quote_id=args[2];a.payload={...a.payload,source_quote_id:args[2]};return {rows:[]}
        }
        Object.assign(a,{bloco_id:null,cliente:args[2],descricao:args[3],prod_date:'',ent_date:args[4],status:'entregue',source_quote_id:args[5],payload:JSON.parse(args[6])})
        return {rows:[]}
      }
      if(sql.startsWith('UPDATE app_quotes_v2')){
        const q=state.quotes.find(q=>q.company_id===args[0] && q.id===args[1])
        if(sql.includes('payload_meta=$3::jsonb')){q.payload_meta=JSON.parse(args[2]);return {rows:[]}}
        Object.assign(q,{status:'pedido',total_cents:args[2],payload_meta:JSON.parse(args[3])})
        return {rows:[]}
      }
      throw new Error('Unexpected SQL: '+sql)
    }
  })}
  return {pool,calls,get state(){return state},get released(){return released}}
}

test('Exclusão remove somente o pedido e os vínculos exatos da mesma empresa',async()=>{
  const state=fixture({agenda:[
    {id:'a1',company_id:'c1',source_quote_id:'q1'},
    {id:'a2',company_id:'c1',payload:{source_quote_id:'old-1'}},
    {id:'a3',company_id:'c1',payload:{quoteId:'q1'}},
    {id:'a4',company_id:'c1',descricao:'Pedido quote:q1'},
    {id:'manual',company_id:'c1',cliente:'Cliente',payload:{valor:5000}},
    {id:'other-quote',company_id:'c1',source_quote_id:'q2'},
    {id:'other-company',company_id:'c2',source_quote_id:'q1'}
  ]})
  const db=database(state)
  assert.equal(await deleteQuoteWithAgenda(db.pool,'c1','q1',helpers),true)
  assert.deepEqual(db.state.agenda.map(a=>a.id),['manual','other-quote','other-company'])
  assert.equal(db.state.quotes.length,0)
  assert.equal(db.calls.at(-1).sql,'COMMIT')
  assert.equal(db.released,1)
})

test('Falha ao excluir a Agenda preserva integralmente pedido e agenda',async()=>{
  const state=fixture({agenda:[{id:'a1',company_id:'c1',source_quote_id:'q1'}]})
  const db=database(state,/DELETE FROM app_agenda_orders_v2/)
  await assert.rejects(deleteQuoteWithAgenda(db.pool,'c1','q1',helpers),/simulated/)
  assert.deepEqual(db.state,state)
  assert.equal(db.calls.at(-1).sql,'ROLLBACK')
  assert.equal(db.released,1)
})

test('Falha ao excluir o pedido desfaz a remoção dos vínculos da Agenda',async()=>{
  const state=fixture({agenda:[{id:'a1',company_id:'c1',source_quote_id:'q1'}]})
  const db=database(state,/DELETE FROM app_quotes_v2/)
  await assert.rejects(deleteQuoteWithAgenda(db.pool,'c1','q1',helpers),/simulated/)
  assert.deepEqual(db.state,state)
})

test('Exclusão de pedido inexistente ou de outra empresa não remove agenda',async()=>{
  const state=fixture({agenda:[{id:'a1',company_id:'c1',source_quote_id:'q1'}]})
  const db=database(state)
  assert.equal(await deleteQuoteWithAgenda(db.pool,'c2','q1',helpers),false)
  assert.deepEqual(db.state,state)
})

test('Orçamento e pedido aguardando agendamento podem virar pronta entrega',async()=>{
  for(const status of ['orcamento','pedido']){
    const state=fixture();state.quotes[0].status=status
    const db=database(state)
    await markReadyDelivery(db.pool,'c1','q1',{delivery_date:'2026-10-15'})
    const q=db.state.quotes[0],a=db.state.agenda[0]
    assert.equal(q.status,'pedido')
    assert.equal(q.payload_meta.agenda_status,'pronta_entrega')
    assert.equal(q.payload_meta.data_pedido,'2026-10-01','Preservar mês do fechamento')
    assert.equal(q.payload_meta.saldo_restante,2000,'Entrega não significa quitação')
    assert.equal(a.status,'entregue')
    assert.equal(a.bloco_id,null)
    assert.equal(a.source_quote_id,'q1')
    assert.equal(a.ent_date,'2026-10-15')
    assert.equal(a.payload.vendido_pronta_entrega,true)
    assert.equal(a.descricao,'Sofá Elegance')
    assert.equal(a.payload.valor_total,5000)
    assert.equal(q.payload_meta.agenda_order_id,a.id)
  }
})

test('Fechamento à pronta entrega grava preço, desconto e pagamento juntos',async()=>{
  const db=database(fixture())
  await markReadyDelivery(db.pool,'c1','q1',{total_cents:450000,delivery_date:'2026-10-15',payload:{desconto:500,saldo_restante:1000,forma_pagamento:'Cartão'}})
  assert.equal(db.state.quotes[0].total_cents,450000)
  assert.equal(db.state.quotes[0].payload_meta.desconto,500)
  assert.equal(db.state.quotes[0].payload_meta.forma_pagamento,'Cartão')
  assert.equal(db.state.agenda[0].payload.valor_total,4500)
  assert.equal(db.state.agenda[0].payload.saldo_restante,1000)
})

test('Repetir a pronta entrega não cria dois pedidos entregues nem muda a data',async()=>{
  const db=database(fixture())
  const first=await markReadyDelivery(db.pool,'c1','q1',{delivery_date:'2026-10-15'})
  const second=await markReadyDelivery(db.pool,'c1','q1',{delivery_date:'2026-10-16'})
  assert.equal(second.agendaId,first.agendaId)
  assert.equal(db.state.agenda.length,1)
  assert.equal(db.state.agenda[0].ent_date,'2026-10-15')
})

test('Reaproveita registro sem bloco que ainda estava aguardando agendamento',async()=>{
  const db=database(fixture({agenda:[{id:'a1',company_id:'c1',source_quote_id:'q1',bloco_id:null,status:'pendente',payload:{}}]}))
  await markReadyDelivery(db.pool,'c1','q1')
  assert.equal(db.state.agenda.length,1)
  assert.equal(db.state.agenda[0].id,'a1')
  assert.equal(db.state.agenda[0].status,'entregue')
})

test('Pedido já agendado não é desagendado pela opção de pronta entrega',async()=>{
  for(const changed of ['agenda','quote']){
    const state=fixture()
    if(changed==='agenda')state.agenda=[{id:'a1',company_id:'c1',source_quote_id:'q1',bloco_id:'b1',status:'pendente'}]
    else state.quotes[0].payload_meta.agenda_status='agendado'
    const db=database(state)
    await assert.rejects(markReadyDelivery(db.pool,'c1','q1'),{code:'ready_delivery_conflict'})
    assert.deepEqual(db.state,state)
  }
})

test('Falha ao gravar entrega ou pedido reverte toda a operação',async()=>{
  for(const pattern of [/INSERT INTO app_agenda_orders_v2/,/UPDATE app_quotes_v2/]){
    const state=fixture(),db=database(state,pattern)
    await assert.rejects(markReadyDelivery(db.pool,'c1','q1'),/simulated/)
    assert.deepEqual(db.state,state)
    assert.equal(db.released,1)
  }
})

test('Outra empresa não consegue alterar a pronta entrega',async()=>{
  const state=fixture(),db=database(state)
  assert.equal(await markReadyDelivery(db.pool,'c2','q1'),null)
  assert.deepEqual(db.state,state)
})

test('Recusa data inválida sem gravar pronta entrega',async()=>{
  const state=fixture(),db=database(state)
  await assert.rejects(markReadyDelivery(db.pool,'c1','q1',{delivery_date:'2026-02-31'}),/Data.*inválida/)
  assert.deepEqual(db.state,state)
})

function manualPending(){
 const state=fixture({agenda:[{id:'manual-talita',company_id:'c1',cliente:'Talita Tavares',bloco_id:'b1',
   status:'pendente',created_at:new Date('2026-10-15T10:01:00Z'),payload:{valor:5000}}]})
 Object.assign(state.quotes[0],{cliente:'Talita Tavares',created_at:new Date('2026-10-15T10:00:00Z')})
 return state
}

test('Excluir antes de abrir Histórico confirma conciliação e remove manual na mesma transação',async()=>{
 const db=database(manualPending())
 await deleteQuoteWithAgenda(db.pool,'c1','q1',helpers)
 assert.equal(db.state.agenda.length,0);assert.equal(db.state.quotes.length,0)
 assert.equal(db.calls.filter(c=>c.sql==='BEGIN').length,1)
 assert.equal(db.calls.filter(c=>c.sql==='COMMIT').length,1)
})

test('Exclusão não escolhe manual quando existem dois candidatos de qualquer lado',async()=>{
 for(const side of ['agenda','quotes']){
  const state=manualPending();state[side].push({...state[side][0],id:'second'})
  const db=database(state)
  await deleteQuoteWithAgenda(db.pool,'c1','q1',helpers)
  assert.deepEqual(db.state.agenda,state.agenda)
 }
})

test('Exclusão preserva manuais com valor, nome, data ou empresa incompatíveis',async()=>{
 for(const mode of ['value','name','date','company']){
  const state=manualPending()
  if(mode==='value')state.agenda[0].payload.valor=5000.01
  if(mode==='name')state.agenda[0].cliente='Outra cliente'
  if(mode==='date')state.agenda[0].created_at=new Date('2026-10-30T10:00:00Z')
  if(mode==='company')state.agenda[0].company_id='c2'
  const db=database(state)
  await deleteQuoteWithAgenda(db.pool,'c1','q1',helpers)
  assert.deepEqual(db.state.agenda,state.agenda)
 }
})

test('Falha após conciliar desfaz vínculo, status e ambas as exclusões',async()=>{
 const state=manualPending(),db=database(state,/DELETE FROM app_quotes_v2/)
 await assert.rejects(deleteQuoteWithAgenda(db.pool,'c1','q1',helpers),/simulated/)
 assert.deepEqual(db.state,state)
})

test('Excluir alvo não modifica conciliação nem status dos outros pedidos',async()=>{
 const state=manualPending()
 state.quotes.push({...state.quotes[0],id:'other',cliente:'Outro cliente'})
 state.agenda.push({...state.agenda[0],id:'other-agenda',cliente:'Outro cliente'})
 const before=structuredClone(state),db=database(state)
 await deleteQuoteWithAgenda(db.pool,'c1','q1',helpers)
 assert.deepEqual(db.state.quotes,[before.quotes[1]])
 assert.deepEqual(db.state.agenda,[before.agenda[1]])
})
