const API = (window.API_BASE || '') + '/api'

let chartVendidosInstance = null

const CACHE_PREFIX = 'estofaria_painel_cache:'
const TTL_SUMMARY = 30 * 1000
const TTL_QUOTES = 60 * 1000
const TTL_ORDERS = 60 * 1000
const TTL_HOLIDAYS = 12 * 60 * 60 * 1000
const TTL_CONFIG = 12 * 60 * 60 * 1000
const AGENDA_SYNC_KEY = 'estofaria_sync:agenda'

let latestSummaryData = null
let latestOrdersData = []
let latestQuotesData = null
let latestOrdersLoaded = false
let latestQuotesLoaded = false
let painelRefreshTimer = null
let agendaSyncSerial = ''

function el(id) { return document.getElementById(id) }
function setText(id, value) { const node = el(id); if (node) node.innerText = value }
function setStatus(ok, text) {
  const node = el('statusPedidos')
  if (!node) return
  node.className = ok ? 'status ok' : 'status alert'
  node.innerText = text
}
function safeNumber(value, fallback = 0) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}
function safeDate(value) {
  if (!value) return null
  const s = String(value)
  const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(s + 'T00:00:00') : new Date(s)
  return Number.isFinite(d.getTime()) ? d : null
}
function toISODate(date) {
  const s = String(date || '')
  const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(s + 'T00:00:00') : new Date(s)
  if (!Number.isFinite(d.getTime())) return ''
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
function formatShortDate(value) {
  const d = safeDate(value)
  if (!d) return '-'
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
}
function brlCompactFromCents(cents) {
  const reais = Number(cents || 0) / 100
  const hasCents = Math.round(Math.abs(Number(cents || 0))) % 100 !== 0
  return reais.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: hasCents ? 2 : 0,
    maximumFractionDigits: hasCents ? 2 : 0
  }).replace('R$ ', 'R$\u00A0')
}
function getToken() {
  try {
    return window.ESTOFARIA_HTTP && typeof window.ESTOFARIA_HTTP.getToken === 'function'
      ? window.ESTOFARIA_HTTP.getToken()
      : (localStorage.getItem('auth_token') || localStorage.getItem('token') || '')
  } catch { return '' }
}
function authHeaders(extra = {}) {
  return window.ESTOFARIA_HTTP && typeof window.ESTOFARIA_HTTP.authHeaders === 'function'
    ? window.ESTOFARIA_HTTP.authHeaders(extra)
    : { Accept: 'application/json', ...extra }
}
function withTimeout(promise, ms, label = 'requisição') {
  let timer = null
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Tempo esgotado em ${label}`)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}
async function apiGet(path, timeoutMs = 8000) {
  return window.ESTOFARIA_HTTP.fetchJson(`${API}${path}`, {
    headers: authHeaders(),
    timeoutMs,
    timeoutLabel: path
  })
}
function readCache(key) {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + key)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || Date.now() > Number(parsed.expiresAt || 0)) {
      localStorage.removeItem(CACHE_PREFIX + key)
      return null
    }
    return parsed.data
  } catch { return null }
}
function writeCache(key, data, ttlMs) {
  try {
    localStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ expiresAt: Date.now() + ttlMs, data }))
  } catch {}
}
function removeCache(key) {
  try {
    localStorage.removeItem(CACHE_PREFIX + key)
  } catch {}
}
function invalidatePainelCaches(keys = ['summary', 'orders', 'agenda-config', 'quotes']) {
  keys.forEach(removeCache)
}
function normalizeLooseText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}
function normalizeStatus(value) {
  return normalizeLooseText(value)
}
function normalizeId(value) {
  return String(value || '').trim()
}
function isIgnoredAgendaPlaceholder(order) {
  const cliente = normalizeLooseText(order?.cliente)
  const descricao = normalizeLooseText(order?.descricao)
  const status = normalizeStatus(order?.status)
  const tecido = normalizeLooseText(order?.tecido)

  if (['cancelado', 'indisponivel'].includes(status)) return true
  if (cliente === 'data excluida') return true
  if ([
    'data removida manualmente da agenda',
    'data excluida',
    'vaga livre',
    'horario livre',
    'slot livre',
    'livre',
    'sem pedido',
    'sem pedido nesta vaga'
  ].includes(descricao)) return true
  if (!cliente && ['vaga livre', 'horario livre', 'slot livre', 'livre', 'indisponivel'].includes(descricao)) return true
  if (tecido === 'indisponivel' || tecido === 'removido') return true
  return false
}
function extractQuoteRefFromAgenda(order) {
  const idCandidates = [
    order?.source_quote_id,
    order?.sourceQuoteId,
    order?.quote_id,
    order?.quoteId,
    order?.orcamento_id,
    order?.budget_id
  ]
  for (const candidate of idCandidates) {
    const ref = normalizeId(candidate)
    if (ref) return ref
  }

  const textCandidates = [
    order?.tecido,
    order?.descricao,
    order?.observacao,
    order?.observacoes,
    order?.obs,
    order?.notes
  ]
  for (const raw of textCandidates) {
    const text = String(raw || '').trim()
    const match = text.match(/quote\s*:\s*([a-zA-Z0-9_-]+)/)
    if (match && match[1]) return String(match[1]).trim()
  }
  return ''
}
function isQuoteBackedAgendaOrder(order) {
  return Boolean(extractQuoteRefFromAgenda(order))
}
function isLegacyQuoteAgendaOrder(order) {
  const origem = normalizeLooseText(order?.origem || order?.source || order?.tipo || order?.kind)
  return ['quote', 'orcamento', 'pedido-orcamento', 'pedido de orcamento'].includes(origem)
}
function isValidManualAgendaOrder(order) {
  const status = normalizeStatus(order?.status)
  if (['entregue', 'cancelado', 'indisponivel'].includes(status)) return false
  if (isQuoteBackedAgendaOrder(order) || isLegacyQuoteAgendaOrder(order)) return false
  if (isIgnoredAgendaPlaceholder(order)) return false

  const cliente = normalizeLooseText(order?.cliente)
  const descricao = normalizeLooseText(order?.descricao)
  if (!cliente && !descricao) return false
  if (!cliente && ['vaga livre', 'horario livre', 'slot livre', 'livre'].some(token => descricao.includes(token))) return false
  return true
}
function buildAgendaOrderKey(order, index) {
  const idCandidates = [order?.id, order?._id, order?.order_id, order?.agenda_order_id]
  for (const candidate of idCandidates) {
    const ref = normalizeId(candidate)
    if (ref) return `id:${ref}`
  }

  const quoteRef = extractQuoteRefFromAgenda(order)
  const cliente = normalizeLooseText(order?.cliente)
  const descricao = normalizeLooseText(order?.descricao)
  const status = normalizeStatus(order?.status)
  const quantidade = normalizeId(order?.qtd || order?.quantidade || order?.quantity)
  const prodDate = normalizeId(order?.prod_date || order?.production_date || order?.data_producao)
  const entDate = normalizeId(order?.ent_date || order?.delivery_date || order?.data_entrega)

  if (quoteRef) return ['quote', quoteRef, prodDate, entDate, status, quantidade].filter(Boolean).join(':')

  const composite = [cliente, descricao, prodDate, entDate, status, quantidade].filter(Boolean).join('|')
  return composite || `row:${index}`
}
function getManualAgendaOrders(orders) {
  const seen = new Set()
  return (Array.isArray(orders) ? orders : []).filter((order, index) => {
    if (!isValidManualAgendaOrder(order)) return false
    const key = buildAgendaOrderKey(order, index)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
function countManualAgendaOrders(orders) {
  return getManualAgendaOrders(orders).length
}
function getAgendaOrderRevenueCents(order) {
  const centsCandidates = [
    order?.total_cents,
    order?.valor_total_cents,
    order?.subtotal_cents,
    order?.preco_total_cents,
    order?.preco_venda_cents,
    order?.sale_total_cents,
    order?.amount_cents,
    order?.valor_cents
  ]
  for (const value of centsCandidates) {
    const n = Number(value)
    if (Number.isFinite(n) && n > 0) return Math.round(n)
  }

  const reaisCandidates = [
    order?.total,
    order?.valor_total,
    order?.subtotal,
    order?.preco_total,
    order?.preco_venda,
    order?.sale_total,
    order?.amount,
    order?.valor
  ]
  for (const value of reaisCandidates) {
    const n = Number(value)
    if (Number.isFinite(n) && n > 0) return Math.round(n * 100)
  }
  return 0
}
function sumManualAgendaRevenueCents(orders) {
  return getManualAgendaOrders(orders).reduce((sum, order) => sum + Math.max(0, getAgendaOrderRevenueCents(order)), 0)
}
function isPedidoQuote(quote) {
  if (normalizeStatus(quote?.status) !== 'pedido') return false

  const cliente = normalizeLooseText(quote?.cliente || quote?.payload?.cliente)
  if (!cliente || cliente === 'cliente') return false

  if (getQuoteRevenueCents(quote) > 0) return true
  return getQuoteModels(quote).length > 0
}
function countPedidoQuotes(quotes) {
  return (Array.isArray(quotes) ? quotes : []).filter(isPedidoQuote).length
}
function buildDisplaySummary(summary, orders, quotes) {
  const base = summary && typeof summary === 'object' ? summary : {}
  const pedidos = latestOrdersLoaded ? countActiveAgendaOrders(orders) : 0
  const faturamentoCents = latestOrdersLoaded ? sumCurrentMonthRevenueCents(orders) : 0
  const pedidosAno = latestOrdersLoaded ? countCurrentYearOrders(orders) : 0
  const faturamentoAnoCents = latestOrdersLoaded ? sumCurrentYearRevenueCents(orders) : 0
  return {
    ...base,
    pedidos,
    faturamento_cents: faturamentoCents,
    pedidos_ano: pedidosAno,
    faturamento_ano_cents: faturamentoAnoCents
  }
}
function updateSummaryWithAgenda(summary = latestSummaryData, orders = latestOrdersData, quotes = latestQuotesData) {
  updateSummary(buildDisplaySummary(summary, orders, quotes))
  if (latestOrdersLoaded) buildDashboardCharts(orders)
}
function schedulePainelRefresh(delay = 120) {
  clearTimeout(painelRefreshTimer)
  painelRefreshTimer = setTimeout(() => {
    renderPainel()
  }, delay)
}
function handleAgendaSync(serializedPayload) {
  const serial = String(serializedPayload || '').trim()
  if (!serial || serial === agendaSyncSerial) return
  agendaSyncSerial = serial
  latestOrdersData = []
  latestQuotesData = null
  latestOrdersLoaded = false
  latestQuotesLoaded = false
  invalidatePainelCaches()
  schedulePainelRefresh(80)
}
function syncAgendaStateOnBoot() {
  try {
    const pending = String(localStorage.getItem(AGENDA_SYNC_KEY) || '').trim()
    if (!pending || pending === agendaSyncSerial) return
    agendaSyncSerial = pending
    latestOrdersData = []
    latestQuotesData = null
    latestOrdersLoaded = false
    latestQuotesLoaded = false
    invalidatePainelCaches()
  } catch (_) {}
}
async function getWithCache(key, path, ttlMs, timeoutMs = 8000) {
  const cached = readCache(key)
  if (cached) return { data: cached, fromCache: true }
  const data = await apiGet(path, timeoutMs)
  writeCache(key, data, ttlMs)
  return { data, fromCache: false }
}
function getHolidayYears() {
  const now = new Date()
  const next = new Date(now)
  next.setMonth(next.getMonth() + 6)
  return [...new Set([now.getFullYear(), next.getFullYear()])].sort((a, b) => a - b)
}
function shortHolidayName(name) {
  return String(name || '').replace(/-feira/gi, '').replace(/\s+/g, ' ').trim()
}
function getDiaSemana(dateISO) {
  const d = safeDate(dateISO)
  if (!d) return ''
  const s = d.toLocaleDateString('pt-BR', { weekday: 'long' })
  return s.charAt(0).toUpperCase() + s.slice(1)
}
function updateFeriadoInfo(payload) {
  const holidays = Array.isArray(payload?.holidays) ? payload.holidays : (Array.isArray(payload) ? payload : [])
  if (!holidays.length) {
    setText('feriado-data', '—'); setText('feriado-nome', 'Nenhum'); setText('feriado-dia', ''); return
  }
  const todayKey = toISODate(new Date())
  const sorted = holidays.filter(h => h?.date).sort((a, b) => String(a.date).localeCompare(String(b.date)))
  const upcoming = sorted.find(h => String(h.date) >= todayKey) || sorted[0]
  if (!upcoming) {
    setText('feriado-data', '—'); setText('feriado-nome', 'Nenhum'); setText('feriado-dia', ''); return
  }
  setText('feriado-data', formatShortDate(upcoming.date))
  setText('feriado-nome', shortHolidayName(upcoming.name))
  setText('feriado-dia', getDiaSemana(upcoming.date))
}
function getActiveAgendaOrders(orders) {
  const seen = new Set()
  return (Array.isArray(orders) ? orders : []).filter((order, index) => {
    const status = normalizeStatus(order?.status)
    if (['entregue', 'cancelado', 'indisponivel'].includes(status)) return false
    if (isIgnoredAgendaPlaceholder(order)) return false

    const cliente = normalizeLooseText(order?.cliente)
    const descricao = normalizeLooseText(order?.descricao)
    if (!cliente && !descricao) return false

    const key = buildAgendaOrderKey(order, index)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
function countActiveAgendaOrders(orders) {
  return getActiveAgendaOrders(orders).length
}
function sumActiveAgendaRevenueCents(orders) {
  return getActiveAgendaOrders(orders).reduce((sum, order) => sum + Math.max(0, getAgendaOrderRevenueCents(order)), 0)
}
const MONTHS_PT = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro']
function getCurrentMonthName() {
  return MONTHS_PT[new Date().getMonth()]
}
function orderCreationDate(order) {
  const ds = order?.created_at || order?.inserted_at || order?.updated_at
  if (!ds) return null
  const d = new Date(String(ds))
  return isNaN(d) ? null : d
}
function sumCurrentMonthRevenueCents(orders) {
  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth()
  return getAllBillableOrders(orders).filter(order => {
    const d = orderCreationDate(order)
    return d && d.getFullYear() === year && d.getMonth() === month
  }).reduce((sum, order) => sum + Math.max(0, getAgendaOrderRevenueCents(order)), 0)
}
function sumCurrentYearRevenueCents(orders) {
  const year = new Date().getFullYear()
  return getAllBillableOrders(orders).filter(order => {
    const d = orderCreationDate(order)
    return d && d.getFullYear() === year
  }).reduce((sum, order) => sum + Math.max(0, getAgendaOrderRevenueCents(order)), 0)
}
// Todos pedidos não-cancelados (ativos + entregues) — para contagem e faturamento acumulado
function getAllBillableOrders(orders) {
  const seen = new Set()
  return (Array.isArray(orders) ? orders : []).filter((order, index) => {
    const status = normalizeStatus(order?.status)
    if (['cancelado', 'indisponivel'].includes(status)) return false
    if (isIgnoredAgendaPlaceholder(order)) return false
    const cliente = normalizeLooseText(order?.cliente)
    const descricao = normalizeLooseText(order?.descricao)
    if (!cliente && !descricao) return false
    const key = buildAgendaOrderKey(order, index)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
function countCurrentYearOrders(orders) {
  const year = new Date().getFullYear()
  return getAllBillableOrders(orders).filter(order => {
    const d = orderCreationDate(order)
    return d && d.getFullYear() === year
  }).length
}
function getClientName(order, index) {
  const name = order?.cliente || order?.client_name || order?.nome_cliente || order?.nome || order?.customer || order?.customer_name
  return String(name || `Pedido ${index + 1}`).trim()
}
function getOverdueOrders(orders) {
  const now = new Date(); now.setHours(23, 59, 59, 999)
  return (Array.isArray(orders) ? orders : []).map((order, index) => ({
    raw: order,
    cliente: getClientName(order, index),
    entrega: safeDate(order?.ent_date) || safeDate(order?.delivery_date) || safeDate(order?.entrega) || safeDate(order?.data_entrega),
    status: String(order?.status || '').toLowerCase()
  })).filter(item => {
    if (['entregue', 'cancelado', 'indisponivel', 'disponivel'].includes(item.status)) return false
    return item.entrega ? item.entrega < now : false
  })
}
function getNearestAgendaDate(orders) {
  const dates = (Array.isArray(orders) ? orders : [])
    .map(order => safeDate(order?.ent_date) || safeDate(order?.delivery_date))
    .filter(Boolean)
    .sort((a, b) => a - b)
  return dates[0] || null
}
function startOfWeek(base = new Date()) {
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate())
  const day = d.getDay()
  const diff = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + diff)
  d.setHours(0, 0, 0, 0)
  return d
}
function addBusinessDays(date, days) {
  const d = new Date(date)
  let added = 0
  while (added < days) {
    d.setDate(d.getDate() + 1)
    const day = d.getDay()
    if (day !== 0 && day !== 6) added++
  }
  return d
}
function addScheduleDays(date, days, tipoDias) {
  if (String(tipoDias || '').toLowerCase() === 'uteis') return addBusinessDays(date, days)
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d
}
function getNextAvailableSlotDate(orders, config) {
    const vagasSemana = Number(config?.vagas_semana || 0)
    const prazoDias = Number(config?.prazo_dias || 0)
    const tipoDias = String(config?.tipo_dias || '').toLowerCase()
    if (!vagasSemana || !prazoDias) return null
    const ativos = countActiveAgendaOrders(orders)
    const weekIndex = Math.floor(ativos / vagasSemana)
    const slotIndex = ativos % vagasSemana
    const weekStart = startOfWeek(new Date())
    weekStart.setDate(weekStart.getDate() + weekIndex * 7)
    const daysInWeek = tipoDias === 'uteis' ? 5 : 7
    const dayOffset = vagasSemana <= 1 ? 0 : Math.round((slotIndex * (daysInWeek - 1)) / (vagasSemana - 1))
    const prodDate = addScheduleDays(weekStart, dayOffset, tipoDias)
    return addScheduleDays(prodDate, prazoDias, tipoDias)
  }
function isValidQuoteModel(modelo) {
  const subtotalCents = Number(modelo?.subtotal_cents)
  const precoCents = Number(modelo?.preco_cents)
  const preco = safeNumber(modelo?.preco, 0)
  const itens = Array.isArray(modelo?.itens) ? modelo.itens : []
  const extras = itens.reduce((sum, item) => {
    if (Number.isFinite(Number(item?.valor_cents))) return sum + Number(item.valor_cents)
    return sum + Math.round(safeNumber(item?.valor, 0) * 100)
  }, 0)
  return [subtotalCents, precoCents].some(value => Number.isFinite(value) && value > 0) || preco > 0 || extras > 0
}
function getQuoteModels(quote) {
  const payload = quote?.payload || {}
  const modelos = Array.isArray(payload.modelos) ? payload.modelos : (Array.isArray(quote?.modelos) ? quote.modelos : [])
  return modelos.filter(isValidQuoteModel)
}
function getModeloSubtotalCents(modelo) {
  if (Number.isFinite(Number(modelo?.subtotal_cents))) return Number(modelo.subtotal_cents)
  const base = Number.isFinite(Number(modelo?.preco_cents)) ? Number(modelo.preco_cents) : Math.round(safeNumber(modelo?.preco, 0) * 100)
  const itens = Array.isArray(modelo?.itens) ? modelo.itens : []
  const extras = itens.reduce((sum, item) => {
    if (Number.isFinite(Number(item?.valor_cents))) return sum + Number(item.valor_cents)
    return sum + Math.round(safeNumber(item?.valor, 0) * 100)
  }, 0)
  return base + extras
}
function getQuoteRevenueCents(quote) {
  const payload = quote?.payload || {}
  const centsCandidates = [
    quote?.total_cents,
    payload?.total_cents,
    quote?.valor_total_cents,
    payload?.valor_total_cents,
    quote?.subtotal_cents,
    payload?.subtotal_cents
  ]
  for (const value of centsCandidates) {
    const n = Number(value)
    if (Number.isFinite(n) && n > 0) return Math.round(n)
  }

  const reaisCandidates = [
    quote?.total,
    payload?.total,
    quote?.valor_total,
    payload?.valor_total,
    quote?.subtotal,
    payload?.subtotal
  ]
  for (const value of reaisCandidates) {
    const n = Number(value)
    if (Number.isFinite(n) && n > 0) return Math.round(n * 100)
  }

  const modelos = getQuoteModels(quote)
  if (modelos.length) {
    return modelos.reduce((sum, modelo) => sum + Math.max(0, getModeloSubtotalCents(modelo)), 0)
  }
  return 0
}
function sumPedidoQuotesRevenueCents(quotes) {
  return (Array.isArray(quotes) ? quotes : []).reduce((sum, quote) => {
    if (!isPedidoQuote(quote)) return sum
    return sum + Math.max(0, getQuoteRevenueCents(quote))
  }, 0)
}
function buildRankings(orders) {
  const soldCount = {}
  ;(Array.isArray(orders) ? orders : []).forEach(order => {
    const modelos = Array.isArray(order.modelos) ? order.modelos : []
    modelos.forEach(modelo => {
      const nome = String(modelo?.name || modelo?.modelo || 'Modelo').trim() || 'Modelo'
      soldCount[nome] = (soldCount[nome] || 0) + 1
    })
  })
  const soldEntries = Object.entries(soldCount).sort((a, b) => b[1] - a[1]).slice(0, 6)
  return {
    soldLabels: soldEntries.length ? soldEntries.map(([label]) => label) : ['Sem dados'],
    soldValues: soldEntries.length ? soldEntries.map(([, value]) => value) : [0],
    revenueLabels: [],
    revenueValues: []
  }
}
function animateChartCanvas(id) {
  const node = el(id)
  if (!node) return
  node.classList.remove('chart-enter')
  void node.offsetWidth
  node.classList.add('chart-enter')
}
function buildBarChart(canvasId, currentInstance, labels, values, color, datasetLabel, asCurrency = false) {
  if (!window.Chart) return currentInstance
  const canvas = el(canvasId)
  if (!canvas) return currentInstance
  if (currentInstance) currentInstance.destroy()
  animateChartCanvas(canvasId)
  return new Chart(canvas, {
    type: 'bar',
    data: { labels, datasets: [{ label: datasetLabel, data: values, backgroundColor: color, borderColor: color, borderWidth: 1, borderRadius: 6, maxBarThickness: 56, categoryPercentage: 0.72, barPercentage: 0.88 }] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 700 },
      scales: {
        x: { grid: { display: false }, ticks: { color: '#555' } },
        y: {
          beginAtZero: true,
          ticks: {
            color: '#555',
            callback(value) {
              if (!asCurrency) return value
              return Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 0, maximumFractionDigits: 0 })
            }
          },
          grid: { color: '#e6e6e6' }
        }
      },
      plugins: {
        legend: { display: true, labels: { color: '#666', boxWidth: 20 } },
        tooltip: {
          callbacks: {
            label(context) {
              const raw = context?.raw
              if (!asCurrency) return `${datasetLabel}: ${raw}`
              return `${datasetLabel}: ${Number(raw || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
            }
          }
        }
      }
    }
  })
}
function setFaturamentoLabel() {
  const el = document.getElementById('faturamento-label')
  if (el) el.textContent = 'Faturamento (' + getCurrentMonthName() + ')'
}
function renderDefaults() {
  setText('feriado-data', '—')
  setText('feriado-nome', 'Nenhum')
  setText('feriado-dia', '')
  setText('agenda-data', '—')
  setText('agenda-dia', '—')
  setText('agenda-vagas', '')
  setText('pedidos', '0')
  setText('pedidos-ano', '0')
  setText('faturamento', brlCompactFromCents(0))
  setText('faturamento-ano', brlCompactFromCents(0))
  setFaturamentoLabel()
}
function updateSummary(summary) {
  const pedidos = safeNumber(summary?.pedidos, 0)
  const faturamentoCents = safeNumber(summary?.faturamento_cents, 0)
  const pedidosAno = safeNumber(summary?.pedidos_ano, 0)
  const faturamentoAnoCents = safeNumber(summary?.faturamento_ano_cents, 0)
  setText('pedidos', String(pedidos).padStart(2, '0'))
  setText('pedidos-ano', String(pedidosAno))
  setText('faturamento', brlCompactFromCents(faturamentoCents))
  setText('faturamento-ano', brlCompactFromCents(faturamentoAnoCents))
  setFaturamentoLabel()
}
function getNextFreeSlotProdDate(orders, config) {
  const vagasSemana = Number((config && config.vagas_semana) || 0)
  if (!vagasSemana) return null
  const ativos = getActiveAgendaOrders(orders)
  const weekCounts = {}
  ativos.forEach(function(o) {
    const dateISO = o.prod_date || o.ent_date || o.delivery_date
    if (!dateISO) return
    const d = new Date(String(dateISO) + 'T00:00:00')
    const wStart = startOfWeek(d)
    const key = toISODate(wStart)
    weekCounts[key] = (weekCounts[key] || 0) + 1
  })
  let bloqueios = {}
  try { bloqueios = JSON.parse(localStorage.getItem('esd_bloqueios_count') || '{}') } catch(e) {}
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const currentWeekStart = startOfWeek(today)
  for (let i = 0; i < 52; i++) {
    const weekStart = new Date(currentWeekStart)
    weekStart.setDate(weekStart.getDate() + i * 7)
    const key = toISODate(weekStart)
    const occupied = (weekCounts[key] || 0) + (bloqueios[key] || 0)
    if (occupied < vagasSemana) return weekStart
  }
  return null
}
function updateAgendaInfo(orders, config) {
  const vagasSemana = Number(config?.vagas_semana || 0)
  if (!vagasSemana) {
    setText('agenda-data', '—'); setText('agenda-dia', '—'); setText('agenda-vagas', ''); return
  }
  try {
    const vaga = localStorage.getItem('esd_proxima_vaga')
    if (!vaga) { setText('agenda-data', '—'); setText('agenda-dia', '—'); setText('agenda-vagas', ''); return }
    setText('agenda-data', formatShortDate(vaga))
    setText('agenda-dia', getDiaSemana(vaga))
    // Calcula vagas disponíveis na semana da próxima vaga
    const ativos = getActiveAgendaOrders(orders)
    const weekCounts = {}
    ativos.forEach(function(o) {
      const dateISO = o.prod_date || o.ent_date || o.delivery_date
      if (!dateISO) return
      const d = new Date(String(dateISO) + 'T00:00:00')
      const key = toISODate(startOfWeek(d))
      weekCounts[key] = (weekCounts[key] || 0) + 1
    })
    let bloqueios = {}
    try { bloqueios = JSON.parse(localStorage.getItem('esd_bloqueios_count') || '{}') } catch(e) {}
    const vagaDate = safeDate(vaga)
    const vagaWeekKey = vagaDate ? toISODate(startOfWeek(vagaDate)) : ''
    const occupied = (weekCounts[vagaWeekKey] || 0) + (bloqueios[vagaWeekKey] || 0)
    const available = Math.max(1, vagasSemana - occupied)
    setText('agenda-vagas', available === 1 ? '1 vaga disponível' : `${available} vagas disponíveis`)
  } catch (_) {
    setText('agenda-data', '—'); setText('agenda-dia', '—'); setText('agenda-vagas', '')
  }
}
/* ── Dashboard sparklines ── */
const _dashCharts = {}
function _destroyDashChart(id) {
  if (_dashCharts[id]) { try { _dashCharts[id].destroy() } catch(_){} delete _dashCharts[id] }
}
function _getLast6Months(orders) {
  const now = new Date()
  const months = []
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    months.push({ y: d.getFullYear(), m: d.getMonth(), count: 0, rev: 0 })
  }
  getAllBillableOrders(orders).forEach(order => {
    const d = orderCreationDate(order)
    if (!d) return
    const idx = months.findIndex(x => x.y === d.getFullYear() && x.m === d.getMonth())
    if (idx < 0) return
    months[idx].count++
    months[idx].rev += Math.max(0, getAgendaOrderRevenueCents(order))
  })
  return months
}
function _getYearMonths(orders) {
  const year = new Date().getFullYear()
  const curMonth = new Date().getMonth()
  const months = Array.from({ length: curMonth + 1 }, (_, i) => ({ m: i, count: 0, rev: 0 }))
  getAllBillableOrders(orders).forEach(order => {
    const d = orderCreationDate(order)
    if (!d || d.getFullYear() !== year || d.getMonth() > curMonth) return
    months[d.getMonth()].count++
    months[d.getMonth()].rev += Math.max(0, getAgendaOrderRevenueCents(order))
  })
  return months
}
function _sparkBar(canvasId, values) {
  const canvas = el(canvasId); if (!canvas || !window.Chart) return
  _destroyDashChart(canvasId)
  _dashCharts[canvasId] = new Chart(canvas.getContext('2d'), {
    type: 'bar',
    data: { labels: values.map(() => ''), datasets: [{ data: values, backgroundColor: '#3b5ec6', borderRadius: 3, borderSkipped: false }] },
    options: { responsive: false, plugins: { legend: { display: false }, tooltip: { enabled: false } }, scales: { x: { display: false }, y: { display: false, beginAtZero: true } }, animation: false }
  })
}
function _sparkLine(canvasId, values, fill) {
  const canvas = el(canvasId); if (!canvas || !window.Chart) return
  _destroyDashChart(canvasId)
  const ctx = canvas.getContext('2d')
  let bg = false
  if (fill) {
    const g = ctx.createLinearGradient(0, 0, 0, 64)
    g.addColorStop(0, 'rgba(59,94,198,0.28)')
    g.addColorStop(1, 'rgba(59,94,198,0)')
    bg = { target: 'origin', above: g }
  }
  _dashCharts[canvasId] = new Chart(ctx, {
    type: 'line',
    data: { labels: values.map(() => ''), datasets: [{ data: values, borderColor: '#3b5ec6', borderWidth: 2, pointRadius: fill ? 0 : 3, pointBackgroundColor: '#3b5ec6', fill: bg, tension: 0.4 }] },
    options: { responsive: false, plugins: { legend: { display: false }, tooltip: { enabled: false } }, scales: { x: { display: false }, y: { display: false, beginAtZero: true } }, animation: false }
  })
}
function _sparkDonut(canvasId, value, total) {
  const canvas = el(canvasId); if (!canvas || !window.Chart) return
  _destroyDashChart(canvasId)
  _dashCharts[canvasId] = new Chart(canvas.getContext('2d'), {
    type: 'doughnut',
    data: { datasets: [{ data: [Math.max(value, 0), Math.max(total - value, 0)], backgroundColor: ['#3b5ec6', '#e8ecf5'], borderWidth: 0 }] },
    options: { responsive: false, cutout: '70%', plugins: { legend: { display: false }, tooltip: { enabled: false } }, animation: false }
  })
}
function buildDashboardCharts(orders) {
  const last6 = _getLast6Months(orders)
  const yearMonths = _getYearMonths(orders)
  const curRev = last6[last6.length - 1]?.rev || 0
  const yearRev = yearMonths.reduce((s, m) => s + m.rev, 0)
  const avgMonthRev = yearMonths.length ? yearRev / yearMonths.length : 1
  _sparkBar('dashChartPedidos', last6.map(m => m.count))
  _sparkLine('dashChartPedidosAno', yearMonths.map(m => m.count), false)
  _sparkDonut('dashChartFatMes', curRev, Math.max(avgMonthRev * 1.5, curRev, 1))
  _sparkLine('dashChartFatAno', yearMonths.map(m => m.rev), true)
}
function renderRankings(orders) {
  const rankings = buildRankings(orders)
  chartVendidosInstance = buildBarChart('chartVendidos', chartVendidosInstance, rankings.soldLabels, rankings.soldValues, 'rgba(144, 202, 249, 0.9)', 'Mais vendido', false)
}
function getWeekDeliveries(orders) {
  const now = new Date()
  const wStart = startOfWeek(now)
  const wEnd = new Date(wStart)
  wEnd.setDate(wEnd.getDate() + 6)
  wEnd.setHours(23, 59, 59, 999)
  return (Array.isArray(orders) ? orders : []).map((order, index) => ({
    raw: order,
    cliente: getClientName(order, index),
    descricao: String(order?.descricao || order?.modelo || order?.description || '').trim(),
    entrega: safeDate(order?.ent_date) || safeDate(order?.delivery_date) || safeDate(order?.entrega) || safeDate(order?.data_entrega),
    status: String(order?.status || '').toLowerCase()
  })).filter(item => {
    if (['entregue', 'cancelado', 'indisponivel'].includes(item.status)) return false
    if (isIgnoredAgendaPlaceholder(item.raw)) return false
    return item.entrega ? (item.entrega >= wStart && item.entrega <= wEnd) : false
  })
}
function escHtml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
}
function updateResumoSemana(orders) {
  const atrasados = getOverdueOrders(orders)
  const entregas = getWeekDeliveries(orders)
  const setText2 = (id, val) => { const n = el(id); if (n) n.textContent = val }
  setText2('rsAtrasadosCount', atrasados.length)
  setText2('rsAtrasadosUnit', atrasados.length === 1 ? 'pedido' : 'pedidos')
  setText2('rsEntregasCount', entregas.length)
  setText2('rsEntregasUnit', entregas.length === 1 ? 'pedido' : 'pedidos')
  window._rsAtrasados = atrasados
  window._rsEntregas = entregas
  const fmtD = d => d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
  const wStart = startOfWeek(new Date())
  const wEnd = new Date(wStart); wEnd.setDate(wEnd.getDate() + 6)
  setText2('rsPeriodo', `${fmtD(wStart)} – ${fmtD(wEnd)}`)
}
function _rsDoc() {
  try {
    if (window.parent && window.parent !== window && window.parent.document && window.parent.document.body) return window.parent.document
  } catch (_) {}
  return document
}
function _ensureRsStyles(doc) {
  if (doc.getElementById('rs-modal-styles')) return
  const s = doc.createElement('style')
  s.id = 'rs-modal-styles'
  s.textContent = `.rs-modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:2000;display:flex;align-items:center;justify-content:center;padding:16px}.rs-modal{background:#fff;border-radius:16px;width:100%;max-width:560px;max-height:80vh;display:flex;flex-direction:column;overflow:hidden}.rs-modal-header{display:flex;align-items:center;justify-content:space-between;padding:16px 18px 12px;border-bottom:1px solid #eee}.rs-modal-ttl{font-size:16px;font-weight:700;color:#111}.rs-modal-close{background:none;border:none;font-size:18px;color:#888;cursor:pointer;padding:4px 8px;border-radius:6px}.rs-modal-close:active{background:#f0f0f0}.rs-modal-body{overflow-y:auto;padding:8px 0 24px}.rs-modal-item{display:flex;align-items:flex-start;gap:12px;padding:12px 18px;border-bottom:1px solid #f0f0f0}.rs-modal-item:last-child{border-bottom:none}.rs-modal-item-icon{font-size:22px;flex-shrink:0;margin-top:1px}.rs-modal-item-info{flex:1;min-width:0}.rs-modal-item-name{font-size:14px;font-weight:700;color:#111;margin-bottom:2px}.rs-modal-item-desc{font-size:12px;color:#666;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.rs-modal-item-date{font-size:12px;font-weight:600;flex-shrink:0;padding:3px 8px;border-radius:20px;align-self:center}.rs-modal-item-date--red{background:#fdeaea;color:#c0392b}.rs-modal-item-date--green{background:#e8f7ee;color:#1f8a4c}.rs-modal-empty{text-align:center;padding:32px 18px;color:#aaa;font-size:14px}`
  doc.head.appendChild(s)
}
function openResumoModal(tipo) {
  const isAtraso = tipo === 'atrasados'
  const items = isAtraso ? (window._rsAtrasados || []) : (window._rsEntregas || [])
  const icon = isAtraso ? '🗓️' : '🚚'
  const colorClass = isAtraso ? 'red' : 'green'
  const titleText = isAtraso ? 'Pedidos em atraso' : 'Pedidos com vencimento essa semana'
  const bodyHtml = !items.length
    ? `<div class="rs-modal-empty">${isAtraso ? 'Nenhum pedido em atraso' : 'Nenhuma entrega esta semana'}</div>`
    : items.map(item => {
        const dateStr = item.entrega ? item.entrega.toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit' }) : '—'
        const desc = item.descricao || ''
        return `<div class="rs-modal-item"><span class="rs-modal-item-icon">${icon}</span><div class="rs-modal-item-info"><div class="rs-modal-item-name">${escHtml(item.cliente)}</div>${desc ? `<div class="rs-modal-item-desc">${escHtml(desc)}</div>` : ''}</div><span class="rs-modal-item-date rs-modal-item-date--${colorClass}">${dateStr}</span></div>`
      }).join('')
  const doc = _rsDoc()
  _ensureRsStyles(doc)
  const old = doc.getElementById('rsModalOverlay')
  if (old) old.remove()
  const overlay = doc.createElement('div')
  overlay.id = 'rsModalOverlay'
  overlay.className = 'rs-modal-overlay'
  overlay.innerHTML = `<div class="rs-modal"><div class="rs-modal-header"><span class="rs-modal-ttl">${escHtml(titleText)}</span><button class="rs-modal-close" id="rsModalCloseBtn" aria-label="Fechar">✕</button></div><div class="rs-modal-body">${bodyHtml}</div></div>`
  doc.body.appendChild(overlay)
  overlay.addEventListener('click', e => { if (e.target === overlay) closeResumoModal() })
  doc.getElementById('rsModalCloseBtn').addEventListener('click', closeResumoModal)
  doc.addEventListener('keydown', _rsKeyClose)
}
function closeResumoModal() {
  const doc = _rsDoc()
  const overlay = doc.getElementById('rsModalOverlay')
  if (overlay) overlay.remove()
  doc.removeEventListener('keydown', _rsKeyClose)
}
function _rsKeyClose(e) { if (e.key === 'Escape') closeResumoModal() }
async function loadSummaryFirst() {
  const cached = readCache('summary')
  if (cached) {
    latestSummaryData = cached
    updateSummaryWithAgenda(cached, latestOrdersData, latestQuotesData)
  }
  try {
    const summary = await apiGet('/dashboard/summary', 5000)
    latestSummaryData = summary || {}
    writeCache('summary', latestSummaryData, TTL_SUMMARY)
    updateSummaryWithAgenda(latestSummaryData, latestOrdersData)
    return true
  } catch {
    if (!cached) {
      latestSummaryData = { pedidos: 0, faturamento_cents: 0 }
      updateSummaryWithAgenda(latestSummaryData, latestOrdersData)
    }
    return false
  }
}
async function loadSecondaryData() {
  const years = getHolidayYears().join(',')
  const results = await Promise.allSettled([
    getWithCache('orders', '/agenda/orders', TTL_ORDERS, 6000),
    getWithCache('quotes', '/quotes?status=pedido', TTL_QUOTES, 6000),
    getWithCache('holidays:' + years, '/calendar/holidays?years=' + encodeURIComponent(years), TTL_HOLIDAYS, 6000),
    getWithCache('agenda-config', '/agenda/config', TTL_CONFIG, 6000)
  ])
  const orders = results[0].status === 'fulfilled' ? (results[0].value?.data || []) : []
  const quotes = results[1].status === 'fulfilled' ? (results[1].value?.data || []) : []
  const holidays = results[2].status === 'fulfilled' ? (results[2].value?.data || { holidays: [] }) : { holidays: [] }
  const config = results[3].status === 'fulfilled' ? (results[3].value?.data || { prazo_dias: 7, vagas_semana: 5, tipo_dias: 'corrido' }) : { prazo_dias: 7, vagas_semana: 5, tipo_dias: 'corrido' }
  latestOrdersData = Array.isArray(orders) ? orders : []
  latestQuotesData = Array.isArray(quotes) ? quotes : []
  latestOrdersLoaded = results[0].status === 'fulfilled'
  latestQuotesLoaded = results[1].status === 'fulfilled'
  updateSummaryWithAgenda(latestSummaryData, latestOrdersData, latestQuotesData)
  updateAgendaInfo(orders, config)
  updateFeriadoInfo(holidays)
  renderRankings(orders)
  updateResumoSemana(latestOrdersData)
}
async function renderPainel() {
  syncAgendaStateOnBoot()
  renderDefaults()
  const cachedSummary = readCache('summary')
  if (cachedSummary) {
    latestSummaryData = cachedSummary
    updateSummaryWithAgenda(cachedSummary, latestOrdersData, latestQuotesData)
  }
  setStatus(true, cachedSummary ? 'Atualizando painel...' : 'Carregando...')

  try {
    const summaryOk = await loadSummaryFirst()
    if (!summaryOk) setStatus(false, '⚠️ Resumo parcial')
  } catch (error) {
    console.error(error)
    setStatus(false, '⚠️ Erro ao carregar resumo')
  }

  const runSecondary = async () => {
    try {
      await loadSecondaryData()
    } catch (error) {
      console.error(error)
      setStatus(false, '⚠️ Erro ao carregar')
      setText('feriados', 'Nenhum')
    }
  }

  if (window.requestIdleCallback) {
    window.requestIdleCallback(() => { runSecondary() }, { timeout: 1200 })
  } else {
    setTimeout(() => { runSecondary() }, 0)
  }
}
window.addEventListener('DOMContentLoaded', renderPainel)
window.addEventListener('pageshow', () => schedulePainelRefresh(60))
window.addEventListener('focus', () => schedulePainelRefresh(90))
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) schedulePainelRefresh(90)
})
window.addEventListener('storage', event => {
  if (event.key === AGENDA_SYNC_KEY) handleAgendaSync(event.newValue)
  if (event.key === 'esd_proxima_vaga') {
    setText('agenda-data', event.newValue ? formatShortDate(event.newValue) : '—')
    setText('agenda-dia', event.newValue ? getDiaSemana(event.newValue) : '—')
  }
})
