'use strict'

// Correção isolada para o faturamento retroativo da Agenda.
// Pedidos manuais pertencem ao mês do bloco de produção (prod_date),
// e não ao mês em que foram cadastrados no banco (created_at).
const dashboardDb = require('./dashboard-v2-db')
const adjustmentsDb = require('./revenue-adjustments-db')

function safeDate(value){
  if(!value) return null
  const raw = String(value)
  const d = /^\d{4}-\d{2}-\d{2}$/.test(raw)
    ? new Date(`${raw}T12:00:00-03:00`)
    : new Date(raw)
  return Number.isNaN(d.getTime()) ? null : d
}

const partsFormatter = new Intl.DateTimeFormat('en-US',{
  timeZone:'America/Sao_Paulo',year:'numeric',month:'numeric',day:'numeric'
})

function dateParts(value){
  const d = value instanceof Date ? value : safeDate(value)
  if(!d) return null
  const out = {}
  for(const part of partsFormatter.formatToParts(d)){
    if(part.type === 'year') out.year = Number(part.value)
    if(part.type === 'month') out.month = Number(part.value) - 1
    if(part.type === 'day') out.day = Number(part.value)
  }
  return out
}

function shiftMonth(year,month,delta){
  const d = new Date(Date.UTC(year,month + delta,1,12,0,0))
  return {year:d.getUTCFullYear(),month:d.getUTCMonth()}
}

function revenueDate(order){
  // Pedidos do Vendedor pertencem ao mês do fechamento, não ao agendamento.
  if(order?.financial_order === true) return safeDate(order?.created_at)
  const productionDate = safeDate(
    order?.prod_date || order?.production_date || order?.data_producao
  )
  const creationDate = safeDate(
    order?.created_at || order?.inserted_at || order?.updated_at
  )

  // Mantém o faturamento retroativo, mas nunca empurra uma venda
  // para um mês futuro por causa da data de produção/agendamento.
  // A competência é a data mais antiga entre produção e criação.
  if(productionDate && creationDate){
    return productionDate.getTime() < creationDate.getTime() ? productionDate : creationDate
  }

  return productionDate || creationDate || safeDate(
    order?.ent_date || order?.delivery_date || order?.data_entrega
  )
}

async function getSummary(companyId){
  const base = await dashboardDb.getSummary(companyId)
  const orders = await dashboardDb.listDashboardOrders(companyId)
  const active = dashboardDb.activeOrders(orders)
  const billable = dashboardDb.billableOrders(orders)
  const adjustments = await adjustmentsDb.list(companyId)

  const now = base?.current_month && Number.isFinite(Number(base.current_month.year))
    ? { year:Number(base.current_month.year), month:Number(base.current_month.month) }
    : (dateParts(new Date()) || { year:new Date().getUTCFullYear(), month:new Date().getUTCMonth() })

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
    const p = dateParts(revenueDate(order))
    if(!p) continue
    const rev = adjustedCents(order,adjustments)

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
      if(yearRevenueMonths[p.month]) yearRevenueMonths[p.month].revenue_cents += rev
      if(p.month === now.month){
        pedidosMes += 1
        faturamentoMes += rev
      }
    }
  }

  return {
    ...base,
    pedidos:active.length,
    faturamento_cents:faturamentoMes,
    ticket_medio_cents:pedidosMes ? Math.round(faturamentoMes / pedidosMes) : 0,
    pedidos_ano:pedidosAno,
    faturamento_ano_cents:faturamentoAno,
    charts:{
      ...(base?.charts || {}),
      last6_months:last6Months,
      year_months:yearMonths,
      year_revenue_months:yearRevenueMonths
    },
    retroactive_agenda_revenue:true
  }
}

function recordKey(order){
  return order.financial_order === true ? 'quote:'+order.source_quote_id : 'agenda:'+order.id
}
function adjustedCents(order,adjustments){
  const adjustment=adjustments.get(recordKey(order))
  if(adjustment?.removed)return 0
  return adjustment?.amount_cents != null ? Number(adjustment.amount_cents) : Math.max(0,dashboardDb.revenueCents(order))
}
async function getRevenueHistory(companyId,year){
  const [orders,adjustments]=await Promise.all([dashboardDb.listDashboardOrders(companyId),adjustmentsDb.list(companyId)])
  const months=Array.from({length:12},(_,month)=>({month,total_cents:0,count:0,records:[]}))
  for(const order of dashboardDb.billableOrders(orders)){
    const date=revenueDate(order),parts=dateParts(date)
    if(!parts || parts.year!==year)continue
    const key=recordKey(order),adjustment=adjustments.get(key)
    if(adjustment?.removed)continue
    const amount=adjustedCents(order,adjustments)
    const number=order.numero_pedido || order.pedido_numero || order.numero || order.order_number || order.source_quote_id || order.id
    months[parts.month].records.push({
      key,number:String(number),client:String(order.cliente || ''),description:String(order.descricao || ''),
      status:String(order.status || ''),agenda_status:String(order.agenda_status || ''),
      source:order.financial_order===true?'Vendas':'Agenda',date:date.toISOString(),
      amount_cents:amount,original_amount_cents:Math.max(0,dashboardDb.revenueCents(order)),
      version:Number(adjustment?.version || 0)
    })
    months[parts.month].total_cents+=amount
    months[parts.month].count++
  }
  for(const month of months)month.records.sort((a,b)=>a.date.localeCompare(b.date)||a.key.localeCompare(b.key))
  return {year,months,total_cents:months.reduce((s,m)=>s+m.total_cents,0),count:months.reduce((s,m)=>s+m.count,0),generated_at:new Date().toISOString()}
}
async function adjustRevenue(companyId,key,body,remove){
  if(typeof key!=='string' || !/^(quote|agenda):.{1,180}$/.test(key)){
    const error=new Error('Registro inválido.');error.status=400;throw error
  }
  const amount=body.amount_cents,version=body.version
  if(!Number.isSafeInteger(version)||version<0 || (!remove && (!Number.isSafeInteger(amount)||amount<0||amount>999999999999))){
    const error=new Error('Informe um valor válido e atualize o registro.');error.status=400;throw error
  }
  const orders=await dashboardDb.listDashboardOrders(companyId)
  if(!dashboardDb.billableOrders(orders).some(order=>recordKey(order)===key)){
    const error=new Error('Registro não encontrado.');error.status=404;throw error
  }
  return adjustmentsDb.save(companyId,key,remove?null:amount,remove,version)
}
module.exports = { getSummary,getRevenueHistory,adjustRevenue,revenueDate,recordKey,adjustedCents }

