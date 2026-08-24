'use strict'

const storeLib = require('./store')

const TIME_ZONE = 'America/Sao_Paulo'
const MONTH_NAMES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro']

function getPool(){
  const pool = storeLib && storeLib._pg && storeLib._pg.pool
  if(!pool){
    const err = new Error('PostgreSQL não disponível para Dashboard V2.')
    err.code = 'postgres_required'
    throw err
  }
  return pool
}

function text(value,fallback=''){
  if(value === undefined || value === null) return fallback
  return String(value).trim()
}

function number(value,fallback=0){
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function normalize(value){
  return text(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g,'')
    .replace(/\s+/g,' ')
    .trim()
    .toLowerCase()
}

function rowToOrder(row){
  const payload = row && row.payload && typeof row.payload === 'object' && !Array.isArray(row.payload)
    ? row.payload : {}
  return {
    ...payload,
    id: row.id,
    company_id: row.company_id,
    bloco_id: row.bloco_id || payload.bloco_id || undefined,
    cliente: row.cliente || payload.cliente || '',
    descricao: row.descricao || payload.descricao || '',
    prod_date: row.prod_date || payload.prod_date || '',
    ent_date: row.ent_date || payload.ent_date || '',
    status: row.status || payload.status || 'pendente',
    tecido: row.tecido || payload.tecido || '',
    qtd: Number(row.qtd || payload.qtd || 1),
    source_quote_id: row.source_quote_id || payload.source_quote_id || null,
    created_at: row.created_at || payload.created_at || null,
    updated_at: row.updated_at || payload.updated_at || null
  }
}

async function listDashboardOrders(companyId){
  const pool = getPool()
  const result = await pool.query(`
    SELECT company_id,id,bloco_id,cliente,descricao,prod_date,ent_date,status,tecido,qtd,
           source_quote_id,payload,created_at,updated_at
    FROM app_agenda_orders_v2
    WHERE company_id=$1
    ORDER BY created_at ASC,id ASC
  `,[text(companyId)])
  return result.rows.map(rowToOrder)
}

function isIgnoredPlaceholder(order){
  const cliente = normalize(order?.cliente)
  const descricao = normalize(order?.descricao)
  const status = normalize(order?.status)
  const tecido = normalize(order?.tecido)

  if(['cancelado','indisponivel'].includes(status)) return true
  if(cliente === 'data excluida') return true
  if([
    'data removida manualmente da agenda',
    'data excluida',
    'vaga livre',
    'horario livre',
    'slot livre',
    'livre',
    'sem pedido',
    'sem pedido nesta vaga'
  ].includes(descricao)) return true
  if(!cliente && ['vaga livre','horario livre','slot livre','livre','indisponivel'].includes(descricao)) return true
  if(tecido === 'indisponivel' || tecido === 'removido') return true
  return false
}

function extractQuoteRef(order){
  const direct = [
    order?.source_quote_id,order?.sourceQuoteId,order?.quote_id,order?.quoteId,
    order?.orcamento_id,order?.budget_id
  ]
  for(const value of direct){
    const ref = text(value)
    if(ref) return ref
  }
  const fields = [order?.tecido,order?.descricao,order?.observacao,order?.observacoes,order?.obs,order?.notes]
  for(const value of fields){
    const match = text(value).match(/quote\s*:\s*([a-zA-Z0-9_-]+)/i)
    if(match && match[1]) return text(match[1])
  }
  return ''
}

function isVendorHistoryOrder(order){
  if(extractQuoteRef(order)) return true
  const origem = normalize(order?.origem || order?.source || order?.tipo || order?.kind)
  return ['quote','orcamento','pedido-orcamento','pedido de orcamento'].includes(origem)
}

function buildOrderKey(order,index){
  const direct = [order?.id,order?._id,order?.order_id,order?.agenda_order_id]
  for(const value of direct){
    const ref = text(value)
    if(ref) return `id:${ref}`
  }
  const cliente = normalize(order?.cliente)
  const descricao = normalize(order?.descricao)
  const status = normalize(order?.status)
  const quantidade = text(order?.qtd || order?.quantidade || order?.quantity)
  const prod = text(order?.prod_date || order?.production_date || order?.data_producao)
  const ent = text(order?.ent_date || order?.delivery_date || order?.data_entrega)
  const composite = [cliente,descricao,prod,ent,status,quantidade].filter(Boolean).join('|')
  return composite || `row:${index}`
}

function onlyAgendaOrders(orders){
  return (Array.isArray(orders) ? orders : []).filter(order => !isVendorHistoryOrder(order))
}

function uniqueFiltered(orders,predicate){
  const seen = new Set()
  return onlyAgendaOrders(orders).filter((order,index) => {
    if(!predicate(order)) return false
    const key = buildOrderKey(order,index)
    if(seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function activeOrders(orders){
  return uniqueFiltered(orders,order => {
    const status = normalize(order?.status)
    if(['entregue','cancelado','indisponivel'].includes(status)) return false
    if(isIgnoredPlaceholder(order)) return false
    const cliente = normalize(order?.cliente)
    const descricao = normalize(order?.descricao)
    return Boolean(cliente || descricao)
  })
}

function billableOrders(orders){
  return uniqueFiltered(orders,order => {
    const status = normalize(order?.status)
    if(['cancelado','indisponivel'].includes(status)) return false
    if(isIgnoredPlaceholder(order)) return false
    const cliente = normalize(order?.cliente)
    const descricao = normalize(order?.descricao)
    return Boolean(cliente || descricao)
  })
}

function revenueCents(order){
  const cents = [
    order?.total_cents,order?.valor_total_cents,order?.subtotal_cents,order?.preco_total_cents,
    order?.preco_venda_cents,order?.sale_total_cents,order?.amount_cents,order?.valor_cents
  ]
  for(const value of cents){
    const n = Number(value)
    if(Number.isFinite(n) && n > 0) return Math.round(n)
  }
  const reais = [
    order?.total,order?.valor_total,order?.subtotal,order?.preco_total,
    order?.preco_venda,order?.sale_total,order?.amount,order?.valor
  ]
  for(const value of reais){
    const n = Number(value)
    if(Number.isFinite(n) && n > 0) return Math.round(n * 100)
  }
  return 0
}

function safeDate(value){
  if(!value) return null
  const raw = String(value)
  const d = /^\d{4}-\d{2}-\d{2}$/.test(raw)
    ? new Date(`${raw}T12:00:00-03:00`)
    : new Date(raw)
  return Number.isNaN(d.getTime()) ? null : d
}

function orderCreationDate(order){
  return safeDate(
    order?.created_at || order?.inserted_at || order?.updated_at ||
    order?.prod_date || order?.production_date || order?.data_producao ||
    order?.ent_date || order?.delivery_date || order?.data_entrega
  )
}

const partsFormatter = new Intl.DateTimeFormat('en-US',{
  timeZone:TIME_ZONE,year:'numeric',month:'numeric',day:'numeric'
})

function dateParts(date){
  const d = date instanceof Date ? date : safeDate(date)
  if(!d) return null
  const parts = partsFormatter.formatToParts(d)
  const out = {}
  for(const part of parts){
    if(part.type === 'year') out.year = Number(part.value)
    if(part.type === 'month') out.month = Number(part.value) - 1
    if(part.type === 'day') out.day = Number(part.value)
  }
  return out
}

function currentParts(){
  return dateParts(new Date())
}

function shiftMonth(year,month,delta){
  const d = new Date(Date.UTC(year,month + delta,1,12,0,0))
  return {year:d.getUTCFullYear(),month:d.getUTCMonth()}
}

function modelsRanking(orders){
  const counts = new Map()
  for(const order of onlyAgendaOrders(orders)){
    const modelos = Array.isArray(order?.modelos) ? order.modelos : []
    for(const modelo of modelos){
      const nome = text(modelo?.name || modelo?.modelo || 'Modelo','Modelo') || 'Modelo'
      counts.set(nome,(counts.get(nome) || 0) + 1)
    }
  }
  return Array.from(counts.entries())
    .sort((a,b) => b[1] - a[1])
    .slice(0,10)
    .map(([name,sales]) => ({name,sales}))
}

async function getSummary(companyId){
  const orders = await listDashboardOrders(companyId)
  const active = activeOrders(orders)
  const billable = billableOrders(orders)
  const now = currentParts() || {year:new Date().getUTCFullYear(),month:new Date().getUTCMonth()}

  const last6Months = []
  for(let i=5;i>=0;i--){
    const p = shiftMonth(now.year,now.month,-i)
    last6Months.push({year:p.year,month:p.month,count:0,revenue_cents:0})
  }
  const yearMonths = Array.from({length:now.month + 1},(_,month)=>({month,count:0,revenue_cents:0}))
  const yearRevenueMonths = Array.from({length:12},(_,month)=>({month,revenue_cents:0}))

  let pedidosAno = 0
  let faturamentoAno = 0
  let faturamentoMes = 0
  let pedidosMes = 0

  for(const order of billable){
    const d = orderCreationDate(order)
    const p = dateParts(d)
    if(!p) continue
    const rev = Math.max(0,revenueCents(order))

    const six = last6Months.find(item => item.year === p.year && item.month === p.month)
    if(six){
      six.count += 1
      six.revenue_cents += rev
    }

    if(p.year === now.year){
      pedidosAno += 1
      faturamentoAno += rev
      if(yearMonths[p.month]){
        yearMonths[p.month].count += 1
        yearMonths[p.month].revenue_cents += rev
      }
      yearRevenueMonths[p.month].revenue_cents += rev
      if(p.month === now.month){
        pedidosMes += 1
        faturamentoMes += rev
      }
    }
  }

  return {
    dashboard_v2:true,
    dashboard_version:2,
    source:'postgresql',
    pedidos:active.length,
    faturamento_cents:faturamentoMes,
    ticket_medio_cents:pedidosMes ? Math.round(faturamentoMes / pedidosMes) : 0,
    pedidos_ano:pedidosAno,
    faturamento_ano_cents:faturamentoAno,
    charts:{
      last6_months:last6Months,
      year_months:yearMonths,
      year_revenue_months:yearRevenueMonths,
      top_models:modelsRanking(orders)
    },
    current_month:{
      year:now.year,
      month:now.month,
      name:MONTH_NAMES[now.month] || ''
    },
    generated_at:new Date().toISOString()
  }
}

module.exports = { getSummary, listDashboardOrders, activeOrders, billableOrders, revenueCents }
