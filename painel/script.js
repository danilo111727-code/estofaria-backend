const API = (window.API_BASE || '') + '/api'

let chartVendidosInstance = null
let chartLucroInstance = null

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
function computeHolidaySummary(payload) {
  const holidays = Array.isArray(payload?.holidays) ? payload.holidays : (Array.isArray(payload) ? payload : [])
  if (!holidays.length) return 'Nenhum'
  const todayKey = toISODate(new Date())
  const sorted = holidays.filter(h => h?.date).sort((a, b) => String(a.date).localeCompare(String(b.date)))
  const upcoming = sorted.find(h => String(h.date) >= todayKey) || sorted[0]
  if (!upcoming) return 'Nenhum'
  return `${formatShortDate(upcoming.date)} ${shortHolidayName(upcoming.name)}`
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
  return getActiveAgendaOrders(orders).filter(order => {
    const d = orderCreationDate(order)
    return d && d.getFullYear() === year && d.getMonth() === month
  }).reduce((sum, order) => sum + Math.max(0, getAgendaOrderRevenueCents(order)), 0)
}
function sumCurrentYearRevenueCents(orders) {
  const year = new Date().getFullYear()
  return getActiveAgendaOrders(orders).filter(order => {
    const d = orderCreationDate(order)
    return d && d.getFullYear() === year
  }).reduce((sum, order) => sum + Math.max(0, getAgendaOrderRevenueCents(order)), 0)
}
function countCurrentYearOrders(orders) {
  const year = new Date().getFullYear()
  return getActiveAgendaOrders(orders).filter(order => {
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
    if (['entregue', 'cancelado', 'indisponivel'].includes(item.status)) return false
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
function buildRankings(quotes) {
  const soldCount = {}
  const revenueSum = {}
  ;(Array.isArray(quotes) ? quotes : []).forEach(quote => {
    getQuoteModels(quote).forEach(modelo => {
      const nome = String(modelo?.modelo || modelo?.name || 'Modelo').trim() || 'Modelo'
      soldCount[nome] = (soldCount[nome] || 0) + 1
      revenueSum[nome] = (revenueSum[nome] || 0) + getModeloSubtotalCents(modelo)
    })
  })
  const soldEntries = Object.entries(soldCount).sort((a, b) => b[1] - a[1]).slice(0, 6)
  const revenueEntries = Object.entries(revenueSum).sort((a, b) => b[1] - a[1]).slice(0, 6)
  return {
    soldLabels: soldEntries.length ? soldEntries.map(([label]) => label) : ['Sem dados'],
    soldValues: soldEntries.length ? soldEntries.map(([, value]) => value) : [0],
    revenueLabels: revenueEntries.length ? revenueEntries.map(([label]) => label) : ['Sem dados'],
    revenueValues: revenueEntries.length ? revenueEntries.map(([, value]) => Number((value / 100).toFixed(0))) : [0]
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
  setText('feriados', 'Nenhum')
  setText('agenda', '-')
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
  const prazoDias   = Number(config?.prazo_dias   || 0)
  const tipoDias    = String(config?.tipo_dias || 'corrido').toLowerCase()
  if (!vagasSemana) { setText('agenda', '-'); return }

  // Lê direto da agenda — sem calcular
  // A agenda grava 'esd_proxima_vaga' no localStorage ao carregar
  try {
    const vaga = localStorage.getItem('esd_proxima_vaga')
    setText('agenda', vaga ? formatShortDate(vaga) : '-')
  } catch (_) {
    setText('agenda', '-')
  }
}
function renderRankings(quotes) {
  const rankings = buildRankings(quotes)
  chartVendidosInstance = buildBarChart('chartVendidos', chartVendidosInstance, rankings.soldLabels, rankings.soldValues, 'rgba(144, 202, 249, 0.9)', 'Mais vendido', false)
  chartLucroInstance = buildBarChart('chartLucro', chartLucroInstance, rankings.revenueLabels, rankings.revenueValues, 'rgba(144, 202, 249, 0.9)', 'Mais lucrativo', true)
}
function buildOverdueStatus(ordersResult) {
  if (!ordersResult || ordersResult.status !== 'fulfilled') {
    return { ok: false, text: '⚠️ Erro ao carregar pedidos' }
  }
  const orders = ordersResult.value?.data || []
  const atrasados = getOverdueOrders(orders)
  if (atrasados.length) {
    const nomes = atrasados.map(item => item.cliente).join(' • ')
    return { ok: false, text: `🚨 Atrasados: ${nomes}` }
  }
  return { ok: true, text: '✅ Sem pedidos atrasados' }
}
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
  setText('feriados', computeHolidaySummary(holidays))
  renderRankings(quotes)
  const status = buildOverdueStatus(results[0])
  setStatus(status.ok, status.text)
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
    setText('agenda', event.newValue ? formatShortDate(event.newValue) : '-')
  }
})
