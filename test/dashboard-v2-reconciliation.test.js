'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const source = fs.readFileSync(process.env.ORIGINAL_DASHBOARD || path.join(__dirname,'../src/lib/dashboard-v2-db.js'),'utf8')
const retroSource = fs.readFileSync(path.join(__dirname,'../src/lib/dashboard-v2-retro.js'),'utf8')
const year = new Date().getUTCFullYear()
const creation = `${year}-01-02T15:00:00.000Z`

function fixtures({kind='Date',days=0,amount=1050,linked=false,status='pendente'}={}){
  const convert = value => kind === 'Date' ? new Date(value) : value
  return {
    agenda:[{
      id:'a1',company_id:'test',bloco_id:'b1',cliente:'Lais tavares',descricao:'Sofá',
      status,source_quote_id:linked ? 'v1' : null,
      created_at:convert(new Date(Date.parse(creation)+days*86400000).toISOString()),
      payload:{valor:amount}
    }],
    quotes:[{
      id:'v1',company_id:'test',cliente:'Lais tavares',status:'pedido',
      total_cents:'105000',created_at:convert(creation),payload_meta:{data_pedido:`${year}-01-02`}
    }]
  }
}

function load(rows){
  const pool = {query:async(sql,params)=>{
    assert.match(sql.trim(),/^SELECT /)
    assert.equal(params[0],'test')
    if(sql.includes('FROM app_agenda_orders_v2')) return {rows:rows.agenda}
    if(sql.includes('FROM app_quotes_v2')) return {rows:rows.quotes}
    throw new Error('Unexpected query')
  }}
  const context = {module:{exports:{}},Date,Intl,require:name=>{
    assert.equal(name,'./store')
    return {_pg:{pool}}
  }}
  vm.runInNewContext(source,context)
  const db = context.module.exports
  const retroContext = {module:{exports:{}},Date,Intl,require:name=>{
    assert.equal(name,'./dashboard-v2-db')
    return db
  }}
  vm.runInNewContext(retroSource,retroContext)
  return {db,retro:retroContext.module.exports}
}

async function check(rows,{excluded=0,count=2,cents=210000}={}){
  const before = structuredClone(rows)
  const {db,retro} = load(rows)
  const orders = await db.listDashboardOrders('test')
  assert.equal(orders.filter(row=>row.exclude_from_revenue === true).length,excluded)
  assert.equal(db.billableOrders(orders).length,count)
  const summary = await retro.getSummary('test')
  assert.equal(summary.faturamento_ano_cents,cents)
  assert.equal(summary.pedidos_ano,count)
  assert.equal(summary.charts.year_revenue_months[0].revenue_cents,cents)
  assert.deepEqual(rows,before,'Leituras não devem modificar os registros originais')
  return {db,orders,summary}
}

test('Date retornado pelo pg: R$ 1.050 no Vendedor + Agenda contam uma venda',async()=>{
  const {orders} = await check(fixtures(),{excluded:1,count:1,cents:105000})
  assert.equal(orders[0].historical_reconciliation_quote_id,'v1')
})

test('Textos ISO continuam conciliando',async()=>{
  await check(fixtures({kind:'ISO'}),{excluded:1,count:1,cents:105000})
})

test('Formatos mistos: Date na Agenda e texto ISO no Vendedor',async()=>{
  const rows = fixtures()
  rows.quotes[0].created_at = creation
  await check(rows,{excluded:1,count:1,cents:105000})
})

test('Formatos mistos: texto ISO na Agenda e Date no Vendedor',async()=>{
  const rows = fixtures({kind:'ISO'})
  rows.quotes[0].created_at = new Date(creation)
  await check(rows,{excluded:1,count:1,cents:105000})
})

test('Dia 14 está incluído na conciliação',async()=>{
  await check(fixtures({days:14}),{excluded:1,count:1,cents:105000})
})

test('Dia 15 continua fora da conciliação',async()=>{
  await check(fixtures({days:15}))
})

test('Agenda criada antes do Vendedor continua fora da regra',async()=>{
  await check(fixtures({days:-1}))
})

test('Compara dias em America/Sao_Paulo, inclusive na virada UTC',async()=>{
  const rows = fixtures()
  rows.quotes[0].created_at = new Date(`${year}-01-01T23:30:00-03:00`)
  rows.agenda[0].created_at = `${year}-01-16T00:30:00-03:00`
  // Diferença local: 15 dias; truncar ISO em UTC daria somente 14.
  await check(rows)
})

test('Instantes equivalentes com offsets diferentes conciliam',async()=>{
  const rows = fixtures()
  rows.quotes[0].created_at = `${year}-01-02T01:30:00Z`
  rows.agenda[0].created_at = `${year}-01-01T22:30:00-03:00`
  await check(rows,{excluded:1,count:1,cents:105000})
})

test('Utiliza criação real do Vendedor, sem usar data_pedido retroativa',async()=>{
  const rows = fixtures()
  rows.quotes[0].payload_meta.data_pedido = `${year}-01-25`
  await check(rows,{excluded:1,count:1,cents:105000})
})

test('Reais na Agenda e centavos no Vendedor são comparados corretamente',async()=>{
  const rows = fixtures()
  rows.agenda[0].payload = {valor_cents:'105000'}
  await check(rows,{excluded:1,count:1,cents:105000})
})

test('Diferença de um centavo impede conciliação',async()=>{
  await check(fixtures({amount:1050.01}),{cents:210001})
})

test('Normaliza acentos, espaços e maiúsculas do cliente',async()=>{
  const rows = fixtures()
  rows.agenda[0].cliente = '  Laís   TAVARES  '
  await check(rows,{excluded:1,count:1,cents:105000})
})

test('Clientes diferentes não conciliam',async()=>{
  const rows = fixtures()
  rows.agenda[0].cliente = 'Outra cliente'
  await check(rows)
})

test('Dois candidatos na Agenda mantêm proteção contra ambiguidade',async()=>{
  const rows = fixtures()
  rows.agenda.push({...rows.agenda[0],id:'a2'})
  await check(rows,{count:3,cents:315000})
})

test('Dois candidatos no Vendedor mantêm proteção contra ambiguidade',async()=>{
  const rows = fixtures()
  rows.quotes.push({...rows.quotes[0],id:'v2'})
  await check(rows,{count:3,cents:315000})
})

test('Data inválida é ignorada sem lançar erro nem conciliar',async()=>{
  for(const value of [new Date(NaN),'data inválida',null]){
    const rows = fixtures()
    rows.agenda[0].created_at = value
    const {db} = load(rows)
    const orders = await db.listDashboardOrders('test')
    assert.equal(orders.filter(row=>row.exclude_from_revenue).length,0)
  }
})

test('Vínculo explícito mantém uma única venda',async()=>{
  await check(fixtures({linked:true}),{count:1,cents:105000})
})

test('Cancelar apenas o agendamento vinculado preserva faturamento do Vendedor',async()=>{
  const {orders} = await check(fixtures({linked:true,status:'cancelado'}),{count:1,cents:105000})
  assert.equal(orders[0].financial_order,true)
})

test('Remover o agendamento preserva a venda independente do Vendedor',async()=>{
  const rows = fixtures({linked:true})
  rows.agenda = []
  await check(rows,{count:1,cents:105000})
})

test('Pedido manual cancelado continua fora do faturamento',async()=>{
  const rows = fixtures({status:'cancelado'})
  rows.quotes = []
  await check(rows,{count:0,cents:0})
})

test('Venda já entregue continua faturada',async()=>{
  await check(fixtures({linked:true,status:'entregue'}),{count:1,cents:105000})
})
