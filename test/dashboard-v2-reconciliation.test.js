'use strict'

const {test} = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const source = fs.readFileSync(path.join(__dirname,'../src/lib/dashboard-v2-db.js'),'utf8')
const retroSource = fs.readFileSync(path.join(__dirname,'../src/lib/dashboard-v2-retro.js'),'utf8')
const year = new Date().getUTCFullYear()
const createdAt = `${year}-01-02T15:00:00Z`

function fixtures({days=0,kind='Date'}={}){
  const date = value => kind === 'Date' ? new Date(value) : value
  const vendor = {
    id:'agenda-vendor',company_id:'test',bloco_id:'b1',source_quote_id:'q1',
    cliente:'Danilo Santana Ferreira',descricao:'Sofá',status:'pendente',
    created_at:date(`${year}-01-10T15:00:00Z`),payload:{valor:5000}
  }
  const manual = {
    id:'agenda-manual',company_id:'test',bloco_id:'b2',
    cliente:'Danilo Santana Ferreira',descricao:'Sofá',status:'pendente',
    created_at:date(new Date(Date.parse(createdAt)+days*86400000).toISOString()),
    payload:{valor:5000}
  }
  return {agenda:[vendor,manual],quotes:[{
    id:'q1',cliente:'Danilo Santana Ferreira',total_cents:'500000',created_at:date(createdAt)
  }]}
}

async function evaluate(rows){
  const before = structuredClone(rows)
  const queries = []
  const pool = {query:async(sql,params)=>{
    queries.push(sql)
    assert.match(sql.trim(),/^SELECT /)
    assert.equal(params[0],'test')
    if(sql.includes('FROM app_agenda_orders_v2')) return {rows:rows.agenda}
    assert.match(sql,/FROM app_quotes_v2/)
    assert.match(sql,/active=TRUE/)
    assert.match(sql,/status.*='pedido'/)
    return {rows:rows.quotes.filter(row=>params[1].includes(row.id))}
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
  const orders = await db.listDashboardOrders('test')
  const billable = db.billableOrders(orders)
  const summary = await retroContext.module.exports.getSummary('test')
  assert.deepEqual(rows,before,'Não modificar os registros de origem')
  assert.equal(orders.length,rows.agenda.length,'Não acrescentar pedidos do Vendedor ao cálculo')
  return {orders,billable,summary,queries,active:db.activeOrders(orders)}
}

async function expectRevenue(rows,cents,count){
  const out = await evaluate(rows)
  assert.equal(out.summary.faturamento_ano_cents,cents)
  assert.equal(out.billable.length,count)
  return out
}

test('Par existente de R$ 5.000 conta uma venda com datas Date do pg',async()=>{
  const out = await expectRevenue(fixtures(),500000,1)
  assert.equal(out.orders[1].historical_reconciliation_quote_id,'q1')
  assert.equal(out.active.length,2,'Conciliação financeira não altera os pedidos ativos')
})

test('Par histórico de Lais por R$ 1.050 também concilia',async()=>{
  const rows = fixtures()
  for(const row of rows.agenda){ row.cliente='Lais tavares'; row.payload.valor=1050 }
  rows.quotes[0].cliente='Lais tavares'
  rows.quotes[0].total_cents='105000'
  await expectRevenue(rows,105000,1)
})

test('Datas ISO continuam conciliando',async()=>{
  await expectRevenue(fixtures({kind:'ISO'}),500000,1)
})

test('Formatos mistos Date e ISO conciliam',async()=>{
  const rows = fixtures()
  rows.agenda[1].created_at=createdAt
  await expectRevenue(rows,500000,1)
})

test('Limite de 14 dias utiliza criação do Vendedor, não do espelho na Agenda',async()=>{
  await expectRevenue(fixtures({days:14}),500000,1)
})

test('Dia 15 não concilia',async()=>{
  await expectRevenue(fixtures({days:15}),1000000,2)
})

test('Agenda anterior à criação no Vendedor não concilia',async()=>{
  await expectRevenue(fixtures({days:-1}),1000000,2)
})

test('Fuso de São Paulo define os dias, inclusive na virada UTC',async()=>{
  const rows = fixtures()
  rows.quotes[0].created_at=new Date(`${year}-01-01T23:30:00-03:00`)
  rows.agenda[1].created_at=`${year}-01-16T00:30:00-03:00`
  await expectRevenue(rows,1000000,2)
})

test('Instantes equivalentes com offsets diferentes conciliam',async()=>{
  const rows = fixtures()
  rows.quotes[0].created_at=`${year}-01-02T01:30:00Z`
  rows.agenda[1].created_at=`${year}-01-01T22:30:00-03:00`
  await expectRevenue(rows,500000,1)
})

test('Normaliza o nome sem aproximar clientes diferentes',async()=>{
  const rows = fixtures()
  rows.agenda[1].cliente='  Dánilo   SANTANA FERREIRA  '
  await expectRevenue(rows,500000,1)
  rows.agenda[1].cliente='Outro cliente'
  await expectRevenue(rows,1000000,2)
})

test('Diferença de um centavo preserva as duas vendas',async()=>{
  const rows = fixtures()
  rows.agenda[1].payload.valor=5000.01
  await expectRevenue(rows,1000001,2)
})

test('Valor divergente entre Vendedor e espelho preserva as vendas',async()=>{
  const rows = fixtures()
  rows.agenda[0].payload.valor=4900
  await expectRevenue(rows,990000,2)
})

test('Ambiguidade de dois manuais não é conciliada',async()=>{
  const rows = fixtures()
  rows.agenda.push({...rows.agenda[1],id:'manual-2'})
  await expectRevenue(rows,1500000,3)
})

test('Ambiguidade de dois pedidos vinculados não é conciliada',async()=>{
  const rows = fixtures()
  rows.agenda.push({...rows.agenda[0],id:'vendor-2',source_quote_id:'q2'})
  rows.quotes.push({...rows.quotes[0],id:'q2'})
  await expectRevenue(rows,1500000,3)
})

test('Sem correspondência ativa no Vendedor, mantém faturamento atual',async()=>{
  const rows = fixtures()
  rows.quotes=[]
  await expectRevenue(rows,1000000,2)
})

test('Vendedor sem agendamento não passa a entrar no faturamento',async()=>{
  const rows = fixtures()
  rows.agenda=[]
  const out = await expectRevenue(rows,0,0)
  assert.equal(out.queries.some(sql=>sql.includes('FROM app_quotes_v2')),false)
})

test('Manual sem outro pedido já faturado não é excluído',async()=>{
  const rows = fixtures()
  rows.agenda.shift()
  const out = await expectRevenue(rows,500000,1)
  assert.equal(out.orders[0].exclude_from_revenue,undefined)
})

test('Espelho sem bloco continua fora da regra de faturamento existente',async()=>{
  const rows = fixtures()
  delete rows.agenda[0].bloco_id
  await expectRevenue(rows,500000,1)
})

test('Cancelar o espelho preserva o manual e não oculta o único valor faturável',async()=>{
  const rows = fixtures()
  rows.agenda[0].status='cancelado'
  await expectRevenue(rows,500000,1)
})

test('Remover manual ou espelho preserva a outra venda já contabilizada',async()=>{
  const first = fixtures()
  first.agenda.pop()
  await expectRevenue(first,500000,1)
  const second = fixtures()
  second.agenda.shift()
  await expectRevenue(second,500000,1)
})

test('Não troca a competência atual pela data do fechamento',async()=>{
  const rows = fixtures()
  rows.agenda[0].prod_date=`${year}-01-01`
  rows.agenda[0].created_at=new Date(`${year}-02-10T15:00:00Z`)
  const out = await expectRevenue(rows,500000,1)
  assert.equal(out.summary.charts.year_revenue_months[0].revenue_cents,500000)
  assert.equal(out.summary.charts.year_revenue_months[1].revenue_cents,0)
})

test('Data inválida não concilia e não gera exceção',async()=>{
  const rows = fixtures()
  rows.quotes[0].created_at=new Date(NaN)
  await expectRevenue(rows,1000000,2)
})
