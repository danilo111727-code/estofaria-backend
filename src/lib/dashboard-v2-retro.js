'use strict'

// Correção isolada para o faturamento retroativo da Agenda.
// Pedidos manuais pertencem ao mês do bloco de produção (prod_date),
// e não ao mês em que foram cadastrados no banco (created_at).
const dashboardDb = require('./dashboard-v2-db')

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
  return safeDate(
    order?.prod_date || order?.production_date || order?.data_producao ||
    order?.created_at || order?.inserted_at || order?.updated_at ||
    order?.ent_date || order?.delivery_date || order?.data_entrega
  )
}

async function getSummary(companyId){
  const base = await dashboardDb.getSummary(companyId)
  const orders = await dashboardDb.listDashboardOrders(companyId)
  const active = dashboardDb.activeOrders(orders)
  const billable = dashboardDb.billableOrders(orders)

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
    const rev = Math.max(0,dashboardDb.revenueCents(order))

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

module.exports = { getSummary }
