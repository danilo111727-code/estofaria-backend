const API = (window.API_BASE || '') + '/api'

;(function injectModelTagStyles() {
  const styleId = 'esd-model-tag-styles'
  const doc = (function() {
    try {
      if (window.parent && window.parent !== window && window.parent.document && window.parent.document.body)
        return window.parent.document
    } catch (_) {}
    return document
  })()
  if (doc.getElementById(styleId)) return
  const style = doc.createElement('style')
  style.id = styleId
  style.textContent = `.bloco-vaga-modelos{display:flex;flex-wrap:wrap;gap:4px;margin-top:3px}.bloco-vaga-modelo-tag{display:inline-block;background:#dbeafe;color:#1e40af;border-radius:20px;padding:2px 8px;font-size:11px;font-weight:700;line-height:1.5}`
  doc.head.appendChild(style)
})()



const PAINEL_SYNC_KEY = 'estofaria_sync:agenda'
const PAINEL_CACHE_PREFIX = 'estofaria_painel_cache:'
const DIAS_UTEIS_KEY = 'esd_dias_uteis'

const state = {
  config: { prazo_dias: 0, vagas_semana: 0, tipo_dias: '', city_code: '', data_inicio_entrega: '' },
  orders: [],
  blocos: [],
  actionContext: null,
  actionSheetOpen: false,
  actionSheetContextKey: '',
  actionSheetRestore: null,
  holidays: [],
  holidayMap: Object.create(null)
}

let renderSyncTimer = null
let agendaBootstrapped = false
let agendaMenuLockUntil = 0
let actionSheetCleanupTimer = null

function $(id) {
  return document.getElementById(id)
}

function ui(){
  return window.ESTOFARIA_UI
}

function notifySuccess(message){
  ui()?.success(message)
}

function notifyError(message){
  ui()?.error(message)
}

function notifyInfo(message){
  ui()?.info(message)
}

function notifyShellHeight() {
  try {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ type: 'estofaria-shell-height', module: 'agenda' }, '*')
    }
  } catch (_) {}
}

function scheduleRenderSync(delay = 40) {
  clearTimeout(renderSyncTimer)
  renderSyncTimer = setTimeout(() => {
    notifyShellHeight()
  }, delay)
}

function notifyPainelRefresh(reason = 'orders') {
  try {
    ;['summary', 'orders', 'agenda-config', 'quotes'].forEach(key => {
      localStorage.removeItem(PAINEL_CACHE_PREFIX + key)
    })
    localStorage.setItem(PAINEL_SYNC_KEY, JSON.stringify({ reason, at: Date.now() }))
  } catch (_) {}
}

function updateTime() {
  const now = new Date()
  const el = $('time')
  if (el) el.innerText = now.toLocaleString('pt-BR')
}

setInterval(updateTime, 1000)
updateTime()

async function apiGet(path) {
  const http = window.ESTOFARIA_HTTP
  return http.fetchJson(API + path, { cache: 'no-store' })
}

async function apiPost(path, body) {
  const http = window.ESTOFARIA_HTTP
  return http.fetchJson(API + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
}

async function apiPatch(path, body) {
  const http = window.ESTOFARIA_HTTP
  return http.fetchJson(API + path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
}

async function apiDelete(path) {
  const http = window.ESTOFARIA_HTTP
  return http.fetchJson(API + path, { method: 'DELETE' })
}

function formatShortDate(dateStr) {
  if (!dateStr) return '--/--'
  const d = new Date(dateStr + 'T00:00:00')
  if (isNaN(d)) return '--/--'
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
}

function formatFullDate(dateStr) {
  if (!dateStr) return '--/--'
  const d = new Date(dateStr + 'T00:00:00')
  if (isNaN(d)) return '--/--'
  return d.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  })
}

function toISODate(d) {
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function parseFlexibleDateInput(value) {
  const raw = String(value || '').trim()
  if (!raw) return ''

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw

  const br = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if (br) return `${br[3]}-${br[2]}-${br[1]}`

  return ''
}

function isValidISODate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return false
  const d = new Date(String(value) + 'T00:00:00')
  return Number.isFinite(d.getTime()) && toISODate(d) === String(value)
}

function normalizeEditableDateInput(value) {
  const iso = parseFlexibleDateInput(value)
  return isValidISODate(iso) ? iso : ''
}

function formatEditableDateInput(value) {
  const iso = normalizeEditableDateInput(value)
  return iso ? formatFullDate(iso) : ''
}

function normalizeHolidayRows(rows) {
  const unique = new Map()
  ;(Array.isArray(rows) ? rows : []).forEach(item => {
    const date = String(item && item.date || '').trim()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return
    if (!unique.has(date)) {
      unique.set(date, {
        date,
        name: String(item && item.name || 'Feriado nacional').trim() || 'Feriado nacional',
        scope: String(item && item.scope || 'national').trim() || 'national'
      })
    }
  })
  return Array.from(unique.values()).sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name, 'pt-BR'))
}

function setHolidayState(rows) {
  state.holidays = normalizeHolidayRows(rows)
  state.holidayMap = state.holidays.reduce((acc, item) => {
    acc[item.date] = item
    return acc
  }, Object.create(null))
}

function getHolidayName(dateStr) {
  return state.holidayMap[String(dateStr || '').trim()]?.name || ''
}

function getManualHolidayKey() {
  try {
    const user = JSON.parse(localStorage.getItem('esd_user') || '{}')
    return 'esd_manual_holidays_' + (user.company_id || 'default')
  } catch { return 'esd_manual_holidays_default' }
}

function getManualHolidays() {
  try { return JSON.parse(localStorage.getItem(getManualHolidayKey()) || '[]') } catch { return [] }
}

function saveManualHolidays(list) {
  localStorage.setItem(getManualHolidayKey(), JSON.stringify(list))
}

function getDiasUteis() {
  try {
    const stored = localStorage.getItem(DIAS_UTEIS_KEY)
    if (stored) return JSON.parse(stored)
  } catch {}
  return [1, 2, 3, 4, 5]
}

function promptDuasDatas({ title, prodValue, entValue }) {
  return new Promise(resolve => {
    const doc = (function() {
      try {
        if (window.parent && window.parent !== window && window.parent.document && window.parent.document.body)
          return window.parent.document
      } catch (_) {}
      return document
    })()

    const backdrop = doc.createElement('div')
    Object.assign(backdrop.style, {
      position: 'fixed', inset: '0', background: 'rgba(15,23,42,.56)',
      backdropFilter: 'blur(2px)', display: 'flex', alignItems: 'center',
      justifyContent: 'center', padding: '18px', zIndex: '1000001',
      boxSizing: 'border-box'
    })

    const modal = doc.createElement('div')
    Object.assign(modal.style, {
      background: '#fff', borderRadius: '18px', width: '100%', maxWidth: '340px',
      boxShadow: '0 8px 40px rgba(0,0,0,.18)', fontFamily: 'system-ui,sans-serif',
      overflow: 'hidden'
    })

    const head = doc.createElement('div')
    head.textContent = title
    Object.assign(head.style, {
      padding: '18px 20px 14px', fontWeight: '800', fontSize: '16px', color: '#0f172a'
    })

    const body = doc.createElement('div')
    Object.assign(body.style, { padding: '0 20px 16px', display: 'flex', flexDirection: 'column', gap: '12px' })

    function makeField(labelText, id, placeholder, value) {
      const wrap = doc.createElement('div')
      const lbl = doc.createElement('label')
      lbl.textContent = labelText
      Object.assign(lbl.style, { display: 'block', fontSize: '13px', fontWeight: '700', color: '#334155', marginBottom: '6px' })
      const inp = doc.createElement('input')
      inp.id = id; inp.type = 'text'; inp.placeholder = placeholder; inp.value = value
      inp.setAttribute('inputmode', 'numeric')
      Object.assign(inp.style, {
        width: '100%', boxSizing: 'border-box', border: '1px solid #cbd5e1',
        borderRadius: '12px', padding: '12px 14px', fontSize: '15px', outline: 'none'
      })
      inp.addEventListener('focus', () => { inp.style.borderColor = '#2563eb'; inp.style.boxShadow = '0 0 0 3px rgba(37,99,235,.14)' })
      inp.addEventListener('blur',  () => { inp.style.borderColor = '#cbd5e1'; inp.style.boxShadow = '' })
      function applyMask(inp) {
        const digits = inp.value.replace(/\D/g, '').slice(0, 8)
        let out = digits
        if (digits.length > 2) out = digits.slice(0,2) + '/' + digits.slice(2)
        if (digits.length > 4) out = digits.slice(0,2) + '/' + digits.slice(2,4) + '/' + digits.slice(4)
        if (inp.value !== out) {
          inp.value = out
          try { inp.setSelectionRange(out.length, out.length) } catch(e) {}
        }
      }
      inp.addEventListener('input', function() { applyMask(this) })
      inp.addEventListener('keyup',  function() { applyMask(this) })
      wrap.appendChild(lbl); wrap.appendChild(inp)
      return { wrap, inp }
    }

    const { wrap: wProd, inp: inputProd } = makeField('Produção (DD/MM/AAAA)', '_dp_prod', 'Ex.: 08/04/2026', prodValue)
    const { wrap: wEnt,  inp: inputEnt  } = makeField('Entrega (DD/MM/AAAA)',  '_dp_ent',  'Ex.: 14/04/2026', entValue)
    body.appendChild(wProd); body.appendChild(wEnt)

    const foot = doc.createElement('div')
    Object.assign(foot.style, {
      padding: '12px 20px 18px', display: 'flex', gap: '10px', justifyContent: 'flex-end'
    })

    function makeBtn(text, primary) {
      const b = doc.createElement('button')
      b.type = 'button'; b.textContent = text
      Object.assign(b.style, {
        border: 'none', borderRadius: '12px', padding: '11px 20px',
        fontSize: '14px', fontWeight: '800', cursor: 'pointer',
        background: primary ? '#2563eb' : '#e2e8f0',
        color: primary ? '#fff' : '#0f172a'
      })
      return b
    }
    const cancelBtn  = makeBtn('Cancelar', false)
    const confirmBtn = makeBtn('Salvar', true)
    foot.appendChild(cancelBtn); foot.appendChild(confirmBtn)

    modal.appendChild(head); modal.appendChild(body); modal.appendChild(foot)
    backdrop.appendChild(modal)
    doc.body.appendChild(backdrop)

    setTimeout(() => { inputProd.focus(); inputProd.select() }, 20)

    function close(val) { backdrop.remove(); resolve(val) }
    const getVal = () => ({ prod: inputProd.value, ent: inputEnt.value })

    confirmBtn.addEventListener('click', () => close(getVal()))
    cancelBtn.addEventListener('click',  () => close(null))
    backdrop.addEventListener('click', e => { if (e.target === backdrop) close(null) })
    modal.addEventListener('keydown', e => {
      if (e.key === 'Escape') close(null)
      if (e.key === 'Enter') { e.preventDefault(); close(getVal()) }
    })
  })
}

function isHolidayDate(value) {
  const iso = typeof value === 'string' ? value : toISODate(value)
  if (state.holidayMap[iso]) return true
  return getManualHolidays().some(h => h.date === iso)
}

function isWorkingDay(date) {
  const d = new Date(date)
  const day = d.getDay()
  const tipo = state.config.tipo_dias || 'corrido'
  if (tipo === 'uteis') {
    const diasUteis = getDiasUteis()
    if (!diasUteis.includes(day)) return false
  } else {
    if (day === 0 || day === 6) return false
  }
  return !isHolidayDate(d)
}

function getHolidayYearsToLoad() {
  const currentYear = new Date().getFullYear()
  return [currentYear - 1, currentYear, currentYear + 1].join(',')
}

function getPreferredHolidayYear() {
  return new Date().getFullYear()
}

async function loadHolidays() {
  try {
    const city = state.config.city_code || ''
    const cityParam = city ? '&city=' + encodeURIComponent(city) : ''
    const data = await apiGet('/calendar/holidays?years=' + encodeURIComponent(getHolidayYearsToLoad()) + cityParam)
    setHolidayState(data && data.holidays)
  } catch (e) {
    console.error('loadHolidays', e)
    setHolidayState([])
  }
}

async function handleCityChange() {
  const sel = $('cidadeSelecionada')
  if (!sel) return
  const city = sel.value || ''
  state.config.city_code = city
  await loadHolidays()
  renderHolidayTable()
  try {
    await apiPatch('/agenda/config', {
      prazo_dias: Number($('prazo')?.value || state.config.prazo_dias),
      vagas_semana: Number($('vagas')?.value || state.config.vagas_semana),
      tipo_dias: $('tipoDias')?.value || state.config.tipo_dias,
      city_code: city
    })
  } catch (e) {
    console.error('handleCityChange save', e)
  }
}

function moveToNextWorkingDay(date) {
  const d = new Date(date)
  while (!isWorkingDay(d)) {
    d.setDate(d.getDate() + 1)
  }
  return d
}

function addBusinessDays(date, days) {
  const d = moveToNextWorkingDay(date)
  if (days <= 0) return d

  let added = 0
  while (added < days) {
    d.setDate(d.getDate() + 1)
    if (isWorkingDay(d)) added++
  }
  return d
}

function normalizeLooseText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

function normalizeId(value) {
  return String(value || '').trim()
}

const DELETED_ORDER_PREFIX = '[pedido excluído] '

const VALOR_CACHE_KEY = 'esd_order_valores'

function getValorCache() {
  try { return JSON.parse(localStorage.getItem(VALOR_CACHE_KEY) || '{}') } catch (_) { return {} }
}

function makeValorCacheKey(o) {
  const cl = String(o.cliente || '').toLowerCase().trim().replace(/\s+/g, ' ')
  const de = String(o.descricao || '').toLowerCase().trim().replace(/\s+/g, ' ').slice(0, 50)
  return 'ck:' + cl + '|' + de
}

function saveValorCache(id, valor, order) {
  const cache = getValorCache()
  if (valor > 0) {
    if (id) cache[String(id)] = valor
    if (order) {
      const ck = makeValorCacheKey(order)
      if (ck !== 'ck:|') cache[ck] = valor
    }
  } else {
    if (id) delete cache[String(id)]
    if (order) {
      const ck = makeValorCacheKey(order)
      delete cache[ck]
    }
  }
  try { localStorage.setItem(VALOR_CACHE_KEY, JSON.stringify(cache)) } catch (_) {}
}

function mergeValorCache(orders) {
  const cache = getValorCache()
  return orders.map(o => {
    const byId = o.id ? Number(cache[String(o.id)] || 0) : 0
    const ck = makeValorCacheKey(o)
    const byCk = ck !== 'ck:|' ? Number(cache[ck] || 0) : 0
    const cacheValor = byId > 0 ? byId : byCk
    if (cacheValor > 0) {
      return { ...o, valor: cacheValor, valor_total: cacheValor }
    }
    const apiValor = Number(o.valor || 0)
    if (apiValor > 0) {
      saveValorCache(o.id, apiValor, o)
      return { ...o, valor_total: apiValor }
    }
    return o
  })
}

function isDeletedAgendaOrder(order) {
  return normalizeLooseText(order?.descricao).startsWith('[pedido excluido]')
}

function stripDeletedOrderMarker(value) {
  return String(value || '').replace(/^\s*\[pedido exclu[ií]do\]\s*/i, '').trim()
}

function isIgnoredAgendaPlaceholder(order) {
  const cliente = normalizeLooseText(order?.cliente)
  const descricao = normalizeLooseText(order?.descricao)
  const status = normalizeLooseText(order?.status)
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

function buildAgendaOrderKey(order, index) {
  const idCandidates = [order?.id, order?._id, order?.order_id, order?.agenda_order_id]
  for (const candidate of idCandidates) {
    const ref = normalizeId(candidate)
    if (ref) return `id:${ref}`
  }

  const cliente = normalizeLooseText(order?.cliente)
  const descricao = normalizeLooseText(order?.descricao)
  const status = normalizeLooseText(order?.status)
  const quantidade = normalizeId(order?.qtd || order?.quantidade || order?.quantity)
  const prodDate = normalizeId(order?.prod_date || order?.production_date || order?.data_producao)
  const entDate = normalizeId(order?.ent_date || order?.delivery_date || order?.data_entrega)
  const composite = [cliente, descricao, prodDate, entDate, status, quantidade].filter(Boolean).join('|')
  return composite || `row:${index}`
}

function normalizeOrder(row) {
  return {
    ...row,
    tecido_comprado: row.tecido_comprado === true || row.tecido_comprado === 1,
    source_quote_id: row.source_quote_id || null
  }
}

function getActiveOrders() {
  const seen = new Set()
  return state.orders
    .filter((order, index) => {
      const status = normalizeLooseText(order?.status)
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
    .sort((a, b) => String(a.prod_date).localeCompare(String(b.prod_date)) || Number(a.id || 0) - Number(b.id || 0))
}

function getHistoricOrders() {
  const seen = new Set()
  return state.orders
    .filter((order, index) => {
      if (order.status !== 'entregue') return false
      const key = buildAgendaOrderKey(order, index)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .sort((a, b) =>
      String(b.updated_at || b.created_at || '').localeCompare(String(a.updated_at || a.created_at || '')) ||
      Number(b.id || 0) - Number(a.id || 0)
    )
}

function calcProdDate(entISO) {
  if (!entISO) return entISO
  const tipo = state.config.tipo_dias || 'corrido'
  const prazo = Math.max(0, Number(state.config.prazo_dias) || 0)
  let prod = new Date(entISO + 'T00:00:00')
  if (tipo === 'uteis') {
    let count = 0
    while (count < prazo) {
      prod.setDate(prod.getDate() - 1)
      if (isWorkingDay(prod)) count++
    }
  } else {
    prod.setDate(prod.getDate() - prazo)
  }
  return toISODate(prod)
}

async function loadConfig() {
  try {
    const c = await apiGet('/agenda/config')
    if (c) state.config = { ...state.config, ...c }
  } catch (e) {
    console.error('loadConfig', e)
  }

  const sel = $('cidadeSelecionada')
  if (sel && state.config.city_code) {
    const opt = sel.querySelector(`option[value="${state.config.city_code}"]`)
    if (opt) sel.value = state.config.city_code
  }
}

async function loadOrders() {
  const rows = await apiGet('/agenda/orders')
  console.log('[ESD-DIAG] loadOrders: API retornou', Array.isArray(rows) ? rows.length : 0, 'pedidos')
  if (Array.isArray(rows) && rows.length > 0) {
    const amostra = rows.slice(0, 3).map(r => ({ id: r.id, cliente: r.cliente, valor: r.valor, valor_total: r.valor_total }))
    console.log('[ESD-DIAG] Amostra dos pedidos (id/cliente/valor/valor_total):', JSON.stringify(amostra))
  }
  console.log('[ESD-DIAG] Cache localStorage atual:', localStorage.getItem('esd_order_valores'))
  const normalized = Array.isArray(rows) ? rows.map(normalizeOrder) : []
  const prevOrders = state.orders.slice()
  const withCache = mergeValorCache(normalized)
  state.orders = withCache.map(o => {
    const apiValor = Number(o.valor_total || o.valor || 0)
    if (apiValor > 0) return o
    const prev = prevOrders.find(p => p.id && p.id === o.id)
    const prevValor = prev ? Number(prev.valor_total || prev.valor || 0) : 0
    if (prevValor > 0) return { ...o, valor: prevValor, valor_total: prevValor }
    return o
  })
  const comValor = state.orders.filter(o => Number(o.valor || o.valor_total || 0) > 0)
  console.log('[ESD-DIAG] Pedidos com valor após merge:', comValor.length, comValor.map(o => ({ id: o.id, cliente: o.cliente, valor: o.valor })))
}

async function limparAgenda() {
  const confirmed = await ui().confirm(
    'Isso vai apagar TODOS os pedidos e resetar as configurações. Deseja continuar?',
    { title: 'Limpar agenda', confirmText: 'Limpar tudo', type: 'danger' }
  )
  if (!confirmed) return
  try {
    const orders = await apiGet('/agenda/orders')
    for (const o of orders) {
      await apiDelete('/agenda/orders/' + o.id)
    }
    await apiPatch('/agenda/config', {
      prazo_dias: 0,
      vagas_semana: 0,
      tipo_dias: 'corrido'
    })
    try { localStorage.removeItem(SEMANA_BLOQUEIOS_KEY)  } catch (_) {}
    try { localStorage.removeItem(SEMANA_BLOQ_COUNT_KEY) } catch (_) {}
    try { localStorage.removeItem(SEMANAS_MANUAIS_KEY)   } catch (_) {}
    try { localStorage.removeItem('esd_proxima_vaga')    } catch (_) {}
    notifyPainelRefresh('agenda-reset')
    await load()
    notifySuccess('Agenda limpa com sucesso.')
  } catch (e) {
    console.error(e)
    notifyError('Erro ao limpar agenda')
  }
}

async function mudarStatus(id, status) {
  try {
    const row = await apiPatch('/agenda/orders/' + id, { status })
    replaceOrder(row)
    notifyPainelRefresh('order-status')
    renderAll()
  } catch (e) {
    console.error(e)
    notifyError('Erro ao atualizar status: ' + e.message)
  }
}

async function excluir(id) {
  try {
    const current = state.orders.find(o => o.id === id) || {}
    const descricaoAtual = stripDeletedOrderMarker(current.descricao || '')
    const row = await apiPatch('/agenda/orders/' + id, {
      status: 'cancelado',
      descricao: `${DELETED_ORDER_PREFIX}${descricaoAtual || 'Pedido excluído'}`.trim()
    })
    replaceOrder(row)
    notifyPainelRefresh('order-delete')
    renderAll()
    closeActionSheet()
    notifySuccess('Pedido movido para o histórico.')
  } catch (e) {
    console.error(e)
    notifyError('Erro ao excluir: ' + e.message)
  }
}

function replaceOrder(row) {
  const idx = state.orders.findIndex(o => o.id === row.id)
  if (idx >= 0) state.orders[idx] = normalizeOrder(row)
  else state.orders.push(normalizeOrder(row))
}

function buildActionContextKey(context) {
  if (!context || typeof context !== 'object') return ''
  if (context.kind === 'order') {
    const row = context.row || {}
    return [
      'order',
      row.id || row._id || '',
      row.prod_date || '',
      row.ent_date || '',
      row.status || ''
    ].join('|')
  }
  if (context.kind === 'empty-slot') {
    return ['empty-slot', context.prod_date || '', context.ent_date || ''].join('|')
  }
  return String(context.kind || '')
}

function buildSheetButton({ label, icon, className, disabled, action }, targetDocument = document) {
  const cls = className || ''
  const btn = targetDocument.createElement('button')
  btn.type = 'button'
  btn.className = `sheet-action-btn ${cls}`.trim()
  btn.disabled = !!disabled

  // Inline styles needed when rendered inside cross-document iframes
  if (targetDocument !== document) {
    let bg = '#eef3ff', color = '#27457c', iconBg = '#d5e3ff'
    if (cls.includes('is-danger'))    { bg = '#fff0f3'; color = '#ac3950'; iconBg = '#ffd5dc' }
    else if (cls.includes('is-warning'))   { bg = '#fff8ec'; color = '#765100'; iconBg = '#ffe8b0' }
    else if (cls.includes('is-success'))   { bg = '#eaf9f1'; color = '#1e7d59'; iconBg = '#c8f0dc' }
    else if (cls.includes('is-available')) { bg = '#f0ecff'; color = '#4a27a0'; iconBg = '#ddd5ff' }
    Object.assign(btn.style, {
      width: '100%', display: 'flex', alignItems: 'center', gap: '14px',
      padding: '12px 14px', border: 'none', borderRadius: '14px',
      cursor: disabled ? 'not-allowed' : 'pointer', textAlign: 'left',
      webkitTapHighlightColor: 'transparent', touchAction: 'manipulation',
      marginBottom: '10px', boxSizing: 'border-box', background: bg, color
    })
    const iconEl = targetDocument.createElement('span')
    iconEl.textContent = icon || '•'
    Object.assign(iconEl.style, {
      width: '46px', height: '46px', borderRadius: '12px', background: iconBg,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: '22px', flexShrink: '0', lineHeight: '1'
    })
    btn.appendChild(iconEl)
    const labelEl = targetDocument.createElement('span')
    labelEl.textContent = label
    Object.assign(labelEl.style, { flex: '1', fontSize: '15px', fontWeight: '700', color: 'inherit' })
    btn.appendChild(labelEl)
    const arrow = targetDocument.createElement('span')
    arrow.textContent = '›'
    Object.assign(arrow.style, { fontSize: '22px', fontWeight: '300', color: '#b0bcd4', lineHeight: '1' })
    btn.appendChild(arrow)
  } else {
    const iconEl = targetDocument.createElement('span')
    iconEl.className = 'sheet-btn-icon'
    iconEl.textContent = icon || '•'
    btn.appendChild(iconEl)
    const labelEl = targetDocument.createElement('span')
    labelEl.className = 'sheet-btn-label'
    labelEl.textContent = label
    btn.appendChild(labelEl)
    const arrow = targetDocument.createElement('span')
    arrow.className = 'sheet-btn-arrow'
    arrow.textContent = '›'
    btn.appendChild(arrow)
  }

  if (action) {
    let lastPressAt = 0
    const trigger = event => {
      const now = Date.now()
      if (now - lastPressAt < 220) return
      lastPressAt = now
      if (event) {
        event.preventDefault()
        event.stopPropagation()
      }
      action(event)
    }
    btn.addEventListener('pointerdown', event => event.stopPropagation())
    btn.addEventListener('click', trigger)
    btn.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') trigger(event)
    })
  }
  return btn
}

function getActionSheetHost() {
  try {
    if (window.parent && window.parent !== window && window.parent.document && window.parent.document.body) {
      return { win: window.parent, doc: window.parent.document, hosted: true }
    }
  } catch (_) {}
  return { win: window, doc: document, hosted: false }
}

function ensureActionSheetHost() {
  const host = getActionSheetHost()
  if (!host.hosted) {
    return {
      hostWindow: host.win,
      hostDocument: host.doc,
      backdrop: $('sheetBackdrop'),
      sheet: $('actionSheet'),
      title: $('sheetTitle'),
      subtitle: $('sheetSubtitle'),
      actions: $('sheetActions')
    }
  }

  let backdrop = host.doc.getElementById('agendaHostBackdrop')
  let sheet = host.doc.getElementById('agendaHostSheet')
  let title = host.doc.getElementById('agendaHostTitle')
  let subtitle = host.doc.getElementById('agendaHostSubtitle')
  let actions = host.doc.getElementById('agendaHostActions')
  let closeBtn = host.doc.getElementById('agendaHostClose')

  if (!backdrop || !sheet || !title || !subtitle || !actions || !closeBtn) {
    backdrop = host.doc.createElement('div')
    backdrop.id = 'agendaHostBackdrop'
    backdrop.hidden = true
    backdrop.setAttribute('aria-hidden', 'true')
    backdrop.style.position = 'fixed'
    backdrop.style.inset = '0'
    backdrop.style.background = 'rgba(0,0,0,.4)'
    backdrop.style.zIndex = '999998'
    backdrop.style.display = 'none'
    backdrop.style.pointerEvents = 'none'
    backdrop.style.touchAction = 'none'

    sheet = host.doc.createElement('div')
    sheet.id = 'agendaHostSheet'
    sheet.setAttribute('aria-hidden', 'true')
    sheet.style.position = 'fixed'
    sheet.style.left = '0'
    sheet.style.right = '0'
    sheet.style.bottom = '0'
    sheet.style.background = '#fff'
    sheet.style.borderRadius = '16px 16px 0 0'
    sheet.style.boxShadow = '0 -10px 30px rgba(0,0,0,.18)'
    sheet.style.padding = '18px'
    sheet.style.zIndex = '999999'
    sheet.style.maxHeight = 'min(78vh, 640px)'
    sheet.style.overflow = 'auto'
    sheet.style.transform = 'translateY(110%)'
    sheet.style.transition = 'transform .22s ease'
    sheet.style.pointerEvents = 'none'
    sheet.style.boxSizing = 'border-box'
    sheet.style.touchAction = 'manipulation'

    const handle = host.doc.createElement('div')
    handle.style.width = '52px'
    handle.style.height = '6px'
    handle.style.borderRadius = '999px'
    handle.style.background = '#d6deef'
    handle.style.margin = '0 auto 12px'

    const header = host.doc.createElement('div')
    header.style.display = 'flex'
    header.style.justifyContent = 'space-between'
    header.style.gap = '12px'
    header.style.alignItems = 'flex-start'
    header.style.padding = '0 0 8px'

    const copyWrap = host.doc.createElement('div')
    copyWrap.style.minWidth = '0'
    title = host.doc.createElement('strong')
    title.id = 'agendaHostTitle'
    title.style.display = 'block'
    subtitle = host.doc.createElement('div')
    subtitle.id = 'agendaHostSubtitle'
    subtitle.style.fontSize = '13px'
    subtitle.style.color = '#5b6780'
    subtitle.style.marginTop = '4px'
    copyWrap.appendChild(title)
    copyWrap.appendChild(subtitle)

    closeBtn = host.doc.createElement('button')
    closeBtn.id = 'agendaHostClose'
    closeBtn.type = 'button'
    closeBtn.textContent = '✕'
    closeBtn.setAttribute('aria-label', 'Fechar menu')
    closeBtn.style.border = 'none'
    closeBtn.style.background = 'transparent'
    closeBtn.style.color = '#42506e'
    closeBtn.style.fontSize = '22px'
    closeBtn.style.padding = '0 0 10px'
    closeBtn.style.cursor = 'pointer'
    closeBtn.style.touchAction = 'manipulation'

    header.appendChild(copyWrap)
    header.appendChild(closeBtn)

    actions = host.doc.createElement('div')
    actions.id = 'agendaHostActions'
    actions.style.display = 'grid'
    actions.style.gap = '10px'

    sheet.appendChild(handle)
    sheet.appendChild(header)
    sheet.appendChild(actions)
    host.doc.body.appendChild(backdrop)
    host.doc.body.appendChild(sheet)

    backdrop.addEventListener('click', event => closeActionSheet(event))
    closeBtn.addEventListener('click', event => closeActionSheet(event, { force: true }))
  }

  return { hostWindow: host.win, hostDocument: host.doc, backdrop, sheet, title, subtitle, actions }
}

function renderActionSheetButtons(context, actions, targetDocument) {
  actions.innerHTML = ''

  if (context.kind === 'order') {
    const st = context.row.status

    actions.appendChild(buildSheetButton({
      label: 'Em produção',
      icon: '📋',
      className: 'is-primary',
      action: async () => { await mudarStatus(context.row.id, 'producao'); closeActionSheet() }
    }, targetDocument))

    if (st !== 'disponivel' && st !== 'entregue') {
      actions.appendChild(buildSheetButton({
        label: 'Disponível para entrega',
        icon: '📦',
        className: 'is-available',
        action: async () => { await mudarStatus(context.row.id, 'disponivel'); closeActionSheet() }
      }, targetDocument))
    }

    if (st !== 'entregue') {
      actions.appendChild(buildSheetButton({
        label: 'Entregue',
        icon: '🚚',
        className: 'is-success',
        action: async () => { await mudarStatus(context.row.id, 'entregue'); closeActionSheet() }
      }, targetDocument))
    }

    actions.appendChild(buildSheetButton({
      label: 'Cancelar pedido',
      icon: '🚫',
      className: 'is-warning',
      action: async () => { await mudarStatus(context.row.id, 'cancelado'); closeActionSheet() }
    }, targetDocument))

    actions.appendChild(buildSheetButton({
      label: 'Excluir pedido',
      icon: '🗑️',
      className: 'is-danger',
      action: async () => {
        const confirmed = await ui().confirm('Excluir este pedido definitivamente?', {
          title: 'Excluir pedido', confirmText: 'Excluir', type: 'danger'
        })
        if (confirmed) { await excluir(context.row.id); closeActionSheet() }
      }
    }, targetDocument))
    return
  }

}

function openActionSheet(context) {
  if (!context) return

  const contextKey = buildActionContextKey(context)
  if (state.actionSheetOpen && state.actionSheetContextKey === contextKey) return
  if (state.actionSheetOpen) closeActionSheet(null, { force: true, silent: true })

  state.actionContext = context
  state.actionSheetContextKey = contextKey

  const ui = ensureActionSheetHost()
  if (!ui.actions || !ui.sheet) return

  clearTimeout(actionSheetCleanupTimer)

  if (ui.title) ui.title.innerText = context.title
  if (ui.subtitle) ui.subtitle.innerText = context.subtitle || 'Escolha uma ação'
  renderActionSheetButtons(context, ui.actions, ui.hostDocument)

  agendaMenuLockUntil = Date.now() + 160

  if (ui.backdrop) {
    ui.backdrop.hidden = false
    ui.backdrop.style.display = 'block'
    ui.backdrop.style.pointerEvents = 'auto'
    ui.backdrop.setAttribute('aria-hidden', 'false')
  }

  ui.sheet.hidden = false
  ui.sheet.style.display = 'block'
  ui.sheet.style.pointerEvents = 'auto'
  ui.sheet.style.transform = 'translateY(0)'
  ui.sheet.classList.add('open')
  ui.sheet.setAttribute('aria-hidden', 'false')

  state.actionSheetRestore = {
    doc: ui.hostDocument,
    bodyOverflow: ui.hostDocument.body.style.overflow,
    htmlOverflow: ui.hostDocument.documentElement.style.overflow
  }
  state.actionSheetOpen = true
  ui.hostDocument.body.style.overflow = 'hidden'
  ui.hostDocument.documentElement.style.overflow = 'hidden'
  scheduleRenderSync(20)
}

function closeActionSheet(ev, options = {}) {
  const ui = ensureActionSheetHost()
  const force = options === true || options.force === true
  const silent = options && options.silent === true
  const target = ev && ev.target ? ev.target : null
  if (!force && ev && ui.backdrop && target && target !== ui.backdrop && target.id !== 'sheetBackdrop') return
  if (!force && target === ui.backdrop && Date.now() < agendaMenuLockUntil) return

  clearTimeout(actionSheetCleanupTimer)

  if (ui.backdrop) {
    ui.backdrop.hidden = true
    ui.backdrop.style.display = 'none'
    ui.backdrop.style.pointerEvents = 'none'
    ui.backdrop.setAttribute('aria-hidden', 'true')
  }
  if (ui.sheet) {
    ui.sheet.classList.remove('open')
    ui.sheet.setAttribute('aria-hidden', 'true')
    ui.sheet.style.pointerEvents = 'none'
    ui.sheet.style.transform = 'translateY(110%)'
    actionSheetCleanupTimer = setTimeout(() => {
      if (ui.sheet.getAttribute('aria-hidden') === 'true') {
        ui.sheet.style.display = 'none'
        ui.sheet.hidden = true
      }
    }, 220)
  }

  const restore = state.actionSheetRestore
  if (restore && restore.doc) {
    restore.doc.body.style.overflow = restore.bodyOverflow || ''
    restore.doc.documentElement.style.overflow = restore.htmlOverflow || ''
  } else {
    document.body.style.overflow = ''
    document.documentElement.style.overflow = ''
  }

  state.actionContext = null
  state.actionSheetOpen = false
  state.actionSheetContextKey = ''
  state.actionSheetRestore = null
  agendaMenuLockUntil = Date.now() + (silent ? 40 : 120)
}

function menuPedido(payload) {
  if (payload.kind === 'order') {
    openActionSheet({
      kind: 'order',
      row: payload.row,
      title: payload.row.cliente || 'Pedido',
      subtitle: `Produção em ${formatFullDate(payload.row.prod_date)}`
    })
    return
  }

}

function makeActionButton(onClick) {
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className = 'row-menu-btn'
  btn.innerHTML = '⋯'
  btn.setAttribute('aria-label', 'Abrir ações do pedido')

  let lastPressAt = 0
  const triggerMenu = event => {
    const now = Date.now()
    if (now - lastPressAt < 220) return
    lastPressAt = now
    if (event) {
      event.preventDefault()
      event.stopPropagation()
    }
    if (typeof onClick === 'function') onClick(event)
  }

  btn.addEventListener('pointerdown', event => event.stopPropagation())
  btn.addEventListener('click', triggerMenu)
  btn.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') triggerMenu(event)
  })
  return btn
}

function statusLabel(row) {
  if (row.status === 'producao') return 'Em produção'
  if (row.status === 'pendente') return 'Pendente'
  if (row.status === 'entregue') return 'Entregue'
  if (row.status === 'cancelado' && isDeletedAgendaOrder(row)) return 'Pedido excluído'
  if (row.status === 'cancelado') return 'Cancelado'
  if (row.status === 'indisponivel') return 'Data excluída'
  return row.status
}

async function limparHistorico() {
  const historico = getHistoricOrders()
  if (!historico.length) {
    alert('Nenhum pedido entregue no histórico.')
    return
  }
  const confirmed = await ui().confirm(
    `Remover ${historico.length} pedido${historico.length !== 1 ? 's' : ''} entregue${historico.length !== 1 ? 's' : ''} do histórico? Esta ação não pode ser desfeita.`,
    { title: 'Limpar histórico', confirmText: 'Limpar' }
  )
  if (!confirmed) return
  for (const order of historico) {
    try { await apiDelete('/agenda/orders/' + order.id) } catch (e) { console.error('limparHistorico', order.id, e) }
  }
  await loadOrders()
  renderAll()
}

function renderHistoricoTabela() {
  const tbody = $('historicoTabela')
  if (!tbody) return

  tbody.innerHTML = ''
  const historico = getHistoricOrders()

  const anoAtual = new Date().getFullYear()
  const totalAno = historico.filter(r => {
    const raw = r.ent_date || r.updated_at || ''
    const d = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? new Date(raw + 'T00:00:00') : new Date(raw)
    return d.getFullYear() === anoAtual
  }).length
  const counter = $('historicoCounter')
  if (counter) counter.textContent = `Pedidos entregues em ${anoAtual}: ${totalAno}`

  if (!historico.length) {
    tbody.innerHTML = '<tr><td colspan="3">Nenhum pedido entregue no histórico.</td></tr>'
    return
  }

  historico.forEach(row => {
    const tr = document.createElement('tr')
    tr.className = 'status-entregue'
    tr.innerHTML = `
      <td>${row.cliente || '-'}</td>
      <td>${row.descricao || '-'}</td>
      <td>${formatShortDate(row.ent_date)}</td>
      <td><span class="status-pill">Entregue</span></td>
    `
    tbody.appendChild(tr)
  })
}

function getVisibleHolidays(limit = 12) {
  const preferredYear = String(getPreferredHolidayYear())
  const sameYear = state.holidays.filter(item => String(item.date || '').startsWith(preferredYear + '-'))
  const rows = sameYear.length ? sameYear : state.holidays
  return rows.slice(0, limit)
}

function scopeBadge(scope) {
  if (scope === 'state') return '<span style="display:inline-block;font-size:.72rem;padding:1px 6px;border-radius:10px;background:#dbeafe;color:#1e40af;font-weight:600;white-space:nowrap;">Estadual</span>'
  if (scope === 'city') return '<span style="display:inline-block;font-size:.72rem;padding:1px 6px;border-radius:10px;background:#dcfce7;color:#166534;font-weight:600;white-space:nowrap;">Municipal</span>'
  return '<span style="display:inline-block;font-size:.72rem;padding:1px 6px;border-radius:10px;background:#f3f4f6;color:#374151;font-weight:600;white-space:nowrap;">Nacional</span>'
}

function renderHolidayTable() {
  const tbody = $('feriadosTabela')
  if (!tbody) return

  tbody.innerHTML = ''
  const limit = state.config.city_code ? 40 : 12
  const rows = getVisibleHolidays(limit)

  if (!rows.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="3">Nenhum feriado carregado.</td>
      </tr>
    `
    return
  }

  rows.forEach(item => {
    const tr = document.createElement('tr')
    const isToday = item.date === toISODate(new Date())
    tr.innerHTML = `
      <td>${formatFullDate(item.date)}</td>
      <td>${item.name}${isToday ? ' <strong>— hoje</strong>' : ''}</td>
      <td>${scopeBadge(item.scope)}</td>
    `
    tbody.appendChild(tr)
  })
}

function renderAll() {
  renderBlocos()
  renderHistoricoTabela()
  renderHolidayTable()
  renderManualHolidayTable()
  scheduleRenderSync()
}

async function load() {
  await Promise.all([loadConfig(), loadOrders(), loadBlocos()])
  await limparBlocosVazios()
  await loadHolidays()
  renderAll()
  populateEstadoSelect()
}

function initAgenda() {
  if (agendaBootstrapped) {
    scheduleRenderSync(10)
    return
  }

  agendaBootstrapped = true

  load().then(() => {
    const autoOpen = sessionStorage.getItem('agenda_auto_open')
    if (autoOpen) {
      sessionStorage.removeItem('agenda_auto_open')
      setTimeout(() => {
        if (autoOpen === 'feriados') openFeriadosFullscreen()
        if (autoOpen === 'historico') openHistoricoFullscreen()
      }, 300)
    } else {
      if (typeof renderBlocos === 'function') { try { renderBlocos() } catch (_) {} }
    }
  }).catch(err => {
    console.error(err)
    notifyError('Não consegui carregar a agenda.')
  })
}

const ESTADOS_CIDADES = {
  'AC': { nome: 'Acre',               cidades: [{ code: 'AC-RIO_BRANCO', label: 'Rio Branco' }, { code: 'AC-CRUZEIRO_DO_SUL', label: 'Cruzeiro do Sul' }] },
  'AL': { nome: 'Alagoas',            cidades: [{ code: 'AL-MACEIO', label: 'Maceió' }, { code: 'AL-ARAPIRACA', label: 'Arapiraca' }, { code: 'AL-PALMEIRA_DOS_INDIOS', label: 'Palmeira dos Índios' }] },
  'AM': { nome: 'Amazonas',           cidades: [{ code: 'AM-MANAUS', label: 'Manaus' }, { code: 'AM-PARINTINS', label: 'Parintins' }, { code: 'AM-ITACOATIARA', label: 'Itacoatiara' }, { code: 'AM-MANACAPURU', label: 'Manacapuru' }] },
  'AP': { nome: 'Amapá',              cidades: [{ code: 'AP-MACAPA', label: 'Macapá' }, { code: 'AP-SANTANA', label: 'Santana' }] },
  'BA': { nome: 'Bahia',              cidades: [{ code: 'BA-SALVADOR', label: 'Salvador' }, { code: 'BA-FEIRA_SANTANA', label: 'Feira de Santana' }, { code: 'BA-VITORIA_DA_CONQUISTA', label: 'Vitória da Conquista' }, { code: 'BA-CAMACARI', label: 'Camaçari' }, { code: 'BA-ITABUNA', label: 'Itabuna' }, { code: 'BA-ILHEUS', label: 'Ilhéus' }, { code: 'BA-JEQUIE', label: 'Jequié' }, { code: 'BA-LAURO_DE_FREITAS', label: 'Lauro de Freitas' }, { code: 'BA-BARREIRAS', label: 'Barreiras' }, { code: 'BA-PORTO_SEGURO', label: 'Porto Seguro' }, { code: 'BA-SIMOES_FILHO', label: 'Simões Filho' }, { code: 'BA-PAULO_AFONSO', label: 'Paulo Afonso' }] },
  'CE': { nome: 'Ceará',              cidades: [{ code: 'CE-FORTALEZA', label: 'Fortaleza' }, { code: 'CE-CAUCAIA', label: 'Caucaia' }, { code: 'CE-JUAZEIRO_DO_NORTE', label: 'Juazeiro do Norte' }, { code: 'CE-MARACANAU', label: 'Maracanaú' }, { code: 'CE-SOBRAL', label: 'Sobral' }, { code: 'CE-CRATO', label: 'Crato' }, { code: 'CE-ITAPIPOCA', label: 'Itapipoca' }, { code: 'CE-MARANGUAPE', label: 'Maranguape' }] },
  'DF': { nome: 'Distrito Federal',   cidades: [{ code: 'DF-BRASILIA', label: 'Brasília' }] },
  'ES': { nome: 'Espírito Santo',     cidades: [{ code: 'ES-VITORIA', label: 'Vitória' }, { code: 'ES-VILA_VELHA', label: 'Vila Velha' }, { code: 'ES-SERRA', label: 'Serra' }, { code: 'ES-CARIACICA', label: 'Cariacica' }, { code: 'ES-CACHOEIRO_ITAPEMIRIM', label: 'Cachoeiro de Itapemirim' }, { code: 'ES-LINHARES', label: 'Linhares' }, { code: 'ES-SAO_MATEUS', label: 'São Mateus' }, { code: 'ES-GUARAPARI', label: 'Guarapari' }, { code: 'ES-COLATINA', label: 'Colatina' }] },
  'GO': { nome: 'Goiás',              cidades: [{ code: 'GO-GOIANIA', label: 'Goiânia' }, { code: 'GO-APARECIDA_DE_GOIANIA', label: 'Aparecida de Goiânia' }, { code: 'GO-ANAPOLIS', label: 'Anápolis' }, { code: 'GO-RIO_VERDE', label: 'Rio Verde' }, { code: 'GO-LUZIANIA', label: 'Luziânia' }, { code: 'GO-AGUAS_LINDAS', label: 'Águas Lindas de Goiás' }, { code: 'GO-VALPARAISO', label: 'Valparaíso de Goiás' }, { code: 'GO-TRINDADE', label: 'Trindade' }, { code: 'GO-SENADOR_CANEDO', label: 'Senador Canedo' }, { code: 'GO-ITUMBIARA', label: 'Itumbiara' }] },
  'MA': { nome: 'Maranhão',           cidades: [{ code: 'MA-SAO_LUIS', label: 'São Luís' }, { code: 'MA-IMPERATRIZ', label: 'Imperatriz' }, { code: 'MA-SAO_JOSE_DE_RIBAMAR', label: 'São José de Ribamar' }, { code: 'MA-TIMON', label: 'Timon' }, { code: 'MA-CAXIAS', label: 'Caxias' }, { code: 'MA-CODO', label: 'Codó' }, { code: 'MA-BACABAL', label: 'Bacabal' }] },
  'MG': { nome: 'Minas Gerais',       cidades: [{ code: 'MG-BELO_HORIZONTE', label: 'Belo Horizonte' }, { code: 'MG-UBERLANDIA', label: 'Uberlândia' }, { code: 'MG-CONTAGEM', label: 'Contagem' }, { code: 'MG-JUIZ_DE_FORA', label: 'Juiz de Fora' }, { code: 'MG-BETIM', label: 'Betim' }, { code: 'MG-MONTES_CLAROS', label: 'Montes Claros' }, { code: 'MG-RIBEIRAO_DAS_NEVES', label: 'Ribeirão das Neves' }, { code: 'MG-UBERABA', label: 'Uberaba' }, { code: 'MG-GOVERNADOR_VALADARES', label: 'Governador Valadares' }, { code: 'MG-IPATINGA', label: 'Ipatinga' }, { code: 'MG-SETE_LAGOAS', label: 'Sete Lagoas' }, { code: 'MG-DIVINOPOLIS', label: 'Divinópolis' }, { code: 'MG-SANTA_LUZIA', label: 'Santa Luzia' }, { code: 'MG-IBIRITE', label: 'Ibirité' }, { code: 'MG-POCOS_DE_CALDAS', label: 'Poços de Caldas' }, { code: 'MG-PATOS_DE_MINAS', label: 'Patos de Minas' }, { code: 'MG-POUSO_ALEGRE', label: 'Pouso Alegre' }, { code: 'MG-CORONEL_FABRICIANO', label: 'Coronel Fabriciano' }, { code: 'MG-TEOFILO_OTONI', label: 'Teófilo Otoni' }, { code: 'MG-BARBACENA', label: 'Barbacena' }, { code: 'MG-VESPASIANO', label: 'Vespasiano' }, { code: 'MG-ITABIRA', label: 'Itabira' }, { code: 'MG-MURIAE', label: 'Muriaé' }, { code: 'MG-CONSELHEIRO_LAFAIETE', label: 'Conselheiro Lafaiete' }] },
  'MS': { nome: 'Mato Grosso do Sul', cidades: [{ code: 'MS-CAMPO_GRANDE', label: 'Campo Grande' }, { code: 'MS-DOURADOS', label: 'Dourados' }, { code: 'MS-TRES_LAGOAS', label: 'Três Lagoas' }, { code: 'MS-CORUMBA', label: 'Corumbá' }, { code: 'MS-PONTA_PORA', label: 'Ponta Porã' }, { code: 'MS-NAVIRAÍ', label: 'Naviraí' }] },
  'MT': { nome: 'Mato Grosso',        cidades: [{ code: 'MT-CUIABA', label: 'Cuiabá' }, { code: 'MT-VARZEA_GRANDE', label: 'Várzea Grande' }, { code: 'MT-RONDONOPOLIS', label: 'Rondonópolis' }, { code: 'MT-SINOP', label: 'Sinop' }, { code: 'MT-TANGARA_DA_SERRA', label: 'Tangará da Serra' }, { code: 'MT-CACERES', label: 'Cáceres' }, { code: 'MT-SORRISO', label: 'Sorriso' }] },
  'PA': { nome: 'Pará',               cidades: [{ code: 'PA-BELEM', label: 'Belém' }, { code: 'PA-ANANINDEUA', label: 'Ananindeua' }, { code: 'PA-SANTAREM', label: 'Santarém' }, { code: 'PA-MARABA', label: 'Marabá' }, { code: 'PA-CASTANHAL', label: 'Castanhal' }, { code: 'PA-ABAETETUBA', label: 'Abaetetuba' }, { code: 'PA-PARAUAPEBAS', label: 'Parauapebas' }] },
  'PB': { nome: 'Paraíba',            cidades: [{ code: 'PB-JOAO_PESSOA', label: 'João Pessoa' }, { code: 'PB-CAMPINA_GRANDE', label: 'Campina Grande' }, { code: 'PB-SANTA_RITA', label: 'Santa Rita' }, { code: 'PB-PATOS', label: 'Patos' }, { code: 'PB-BAYEUX', label: 'Bayeux' }, { code: 'PB-SOUSA', label: 'Sousa' }] },
  'PE': { nome: 'Pernambuco',         cidades: [{ code: 'PE-RECIFE', label: 'Recife' }, { code: 'PE-CARUARU', label: 'Caruaru' }, { code: 'PE-OLINDA', label: 'Olinda' }, { code: 'PE-JABOATAO', label: 'Jaboatão dos Guararapes' }, { code: 'PE-PETROLINA', label: 'Petrolina' }, { code: 'PE-PAULISTA', label: 'Paulista' }, { code: 'PE-CAMARAJIBE', label: 'Camaragibe' }, { code: 'PE-CABO_DE_SANTO_AGOSTINHO', label: 'Cabo de Santo Agostinho' }, { code: 'PE-GARANHUNS', label: 'Garanhuns' }, { code: 'PE-VITORIA_DE_SANTO_ANTAO', label: 'Vitória de Santo Antão' }] },
  'PI': { nome: 'Piauí',              cidades: [{ code: 'PI-TERESINA', label: 'Teresina' }, { code: 'PI-PARNAIBA', label: 'Parnaíba' }, { code: 'PI-PICOS', label: 'Picos' }, { code: 'PI-PIRIPIRI', label: 'Piripiri' }] },
  'PR': { nome: 'Paraná',             cidades: [{ code: 'PR-CURITIBA', label: 'Curitiba' }, { code: 'PR-LONDRINA', label: 'Londrina' }, { code: 'PR-MARINGA', label: 'Maringá' }, { code: 'PR-PONTA_GROSSA', label: 'Ponta Grossa' }, { code: 'PR-CASCAVEL', label: 'Cascavel' }, { code: 'PR-SAO_JOSE_DOS_PINHAIS', label: 'São José dos Pinhais' }, { code: 'PR-FOZ_DO_IGUACU', label: 'Foz do Iguaçu' }, { code: 'PR-COLOMBO', label: 'Colombo' }, { code: 'PR-GUARAPUAVA', label: 'Guarapuava' }, { code: 'PR-PARANAGUA', label: 'Paranaguá' }, { code: 'PR-ARAUCARIA', label: 'Araucária' }, { code: 'PR-TOLEDO', label: 'Toledo' }, { code: 'PR-APUCARANA', label: 'Apucarana' }, { code: 'PR-CAMPO_LARGO', label: 'Campo Largo' }, { code: 'PR-ALMIRANTE_TAMANDARE', label: 'Almirante Tamandaré' }, { code: 'PR-UMUARAMA', label: 'Umuarama' }, { code: 'PR-CAMPO_MOURAO', label: 'Campo Mourão' }, { code: 'PR-SARANDI', label: 'Sarandi' }] },
  'RJ': { nome: 'Rio de Janeiro',     cidades: [{ code: 'RJ-RIO_DE_JANEIRO', label: 'Rio de Janeiro' }, { code: 'RJ-SAO_GONCALO', label: 'São Gonçalo' }, { code: 'RJ-DUQUE_CAXIAS', label: 'Duque de Caxias' }, { code: 'RJ-NOVA_IGUACU', label: 'Nova Iguaçu' }, { code: 'RJ-NITEROI', label: 'Niterói' }, { code: 'RJ-BELFORD_ROXO', label: 'Belford Roxo' }, { code: 'RJ-SAO_JOAO_DE_MERITI', label: 'São João de Meriti' }, { code: 'RJ-CAMPOS', label: 'Campos dos Goytacazes' }, { code: 'RJ-PETROPOLIS', label: 'Petrópolis' }, { code: 'RJ-VOLTA_REDONDA', label: 'Volta Redonda' }, { code: 'RJ-MAGE', label: 'Magé' }, { code: 'RJ-ITABORAI', label: 'Itaboraí' }, { code: 'RJ-MESQUITA', label: 'Mesquita' }, { code: 'RJ-NOVA_FRIBURGO', label: 'Nova Friburgo' }, { code: 'RJ-BARRA_MANSA', label: 'Barra Mansa' }, { code: 'RJ-MARICA', label: 'Maricá' }, { code: 'RJ-ANGRA_DOS_REIS', label: 'Angra dos Reis' }, { code: 'RJ-TERESOPOLIS', label: 'Teresópolis' }, { code: 'RJ-QUEIMADOS', label: 'Queimados' }] },
  'RN': { nome: 'Rio Grande do Norte', cidades: [{ code: 'RN-NATAL', label: 'Natal' }, { code: 'RN-MOSSORO', label: 'Mossoró' }, { code: 'RN-PARNAMIRIM', label: 'Parnamirim' }, { code: 'RN-SAO_GONCALO_DO_AMARANTE', label: 'São Gonçalo do Amarante' }, { code: 'RN-CEARA_MIRIM', label: 'Ceará-Mirim' }] },
  'RO': { nome: 'Rondônia',           cidades: [{ code: 'RO-PORTO_VELHO', label: 'Porto Velho' }, { code: 'RO-JI_PARANA', label: 'Ji-Paraná' }, { code: 'RO-ARIQUEMES', label: 'Ariquemes' }, { code: 'RO-VILHENA', label: 'Vilhena' }] },
  'RR': { nome: 'Roraima',            cidades: [{ code: 'RR-BOA_VISTA', label: 'Boa Vista' }, { code: 'RR-RORAINOPOLIS', label: 'Rorainópolis' }] },
  'RS': { nome: 'Rio Grande do Sul',  cidades: [{ code: 'RS-PORTO_ALEGRE', label: 'Porto Alegre' }, { code: 'RS-CAXIAS_DO_SUL', label: 'Caxias do Sul' }, { code: 'RS-CANOAS', label: 'Canoas' }, { code: 'RS-PELOTAS', label: 'Pelotas' }, { code: 'RS-SANTA_MARIA', label: 'Santa Maria' }, { code: 'RS-GRAVATAI', label: 'Gravataí' }, { code: 'RS-VIAMAOO', label: 'Viamão' }, { code: 'RS-NOVO_HAMBURGO', label: 'Novo Hamburgo' }, { code: 'RS-SAO_LEOPOLDO', label: 'São Leopoldo' }, { code: 'RS-RIO_GRANDE', label: 'Rio Grande' }, { code: 'RS-ALVORADA', label: 'Alvorada' }, { code: 'RS-PASSO_FUNDO', label: 'Passo Fundo' }, { code: 'RS-SAPUCAIA_DO_SUL', label: 'Sapucaia do Sul' }, { code: 'RS-URUGUAIANA', label: 'Uruguaiana' }, { code: 'RS-SANTA_CRUZ_DO_SUL', label: 'Santa Cruz do Sul' }, { code: 'RS-CACHOEIRINHA', label: 'Cachoeirinha' }, { code: 'RS-BAGE', label: 'Bagé' }, { code: 'RS-ERECHIM', label: 'Erechim' }] },
  'SC': { nome: 'Santa Catarina',     cidades: [{ code: 'SC-FLORIANOPOLIS', label: 'Florianópolis' }, { code: 'SC-JOINVILLE', label: 'Joinville' }, { code: 'SC-BLUMENAU', label: 'Blumenau' }, { code: 'SC-SAO_JOSE', label: 'São José' }, { code: 'SC-CHAPECO', label: 'Chapecó' }, { code: 'SC-ITAJAI', label: 'Itajaí' }, { code: 'SC-CRICIUMA', label: 'Criciúma' }, { code: 'SC-JARAGUA_DO_SUL', label: 'Jaraguá do Sul' }, { code: 'SC-LAGES', label: 'Lages' }, { code: 'SC-PALHOCA', label: 'Palhoça' }, { code: 'SC-BRUSQUE', label: 'Brusque' }, { code: 'SC-TUBARAO', label: 'Tubarão' }, { code: 'SC-BALNEARIO_CAMBORIU', label: 'Balneário Camboriú' }, { code: 'SC-SAO_FRANCISCO_DO_SUL', label: 'São Francisco do Sul' }] },
  'SE': { nome: 'Sergipe',            cidades: [{ code: 'SE-ARACAJU', label: 'Aracaju' }, { code: 'SE-NOSSA_SENHORA_DO_SOCORRO', label: 'Nossa Senhora do Socorro' }, { code: 'SE-LAGARTO', label: 'Lagarto' }, { code: 'SE-ITABAIANA', label: 'Itabaiana' }] },
  'SP': { nome: 'São Paulo',          cidades: [{ code: 'SP-SAO_PAULO', label: 'São Paulo' }, { code: 'SP-GUARULHOS', label: 'Guarulhos' }, { code: 'SP-CAMPINAS', label: 'Campinas' }, { code: 'SP-SAO_BERNARDO', label: 'São Bernardo do Campo' }, { code: 'SP-SANTO_ANDRE', label: 'Santo André' }, { code: 'SP-OSASCO', label: 'Osasco' }, { code: 'SP-SAO_JOSE_DOS_CAMPOS', label: 'São José dos Campos' }, { code: 'SP-RIBEIRAO_PRETO', label: 'Ribeirão Preto' }, { code: 'SP-SOROCABA', label: 'Sorocaba' }, { code: 'SP-MAUA', label: 'Mauá' }, { code: 'SP-SAO_JOSE_RIO_PRETO', label: 'São José do Rio Preto' }, { code: 'SP-MOGI_DAS_CRUZES', label: 'Mogi das Cruzes' }, { code: 'SP-SANTOS', label: 'Santos' }, { code: 'SP-DIADEMA', label: 'Diadema' }, { code: 'SP-JUNDIAI', label: 'Jundiaí' }, { code: 'SP-PIRACICABA', label: 'Piracicaba' }, { code: 'SP-CARAPICUIBA', label: 'Carapicuíba' }, { code: 'SP-BAURU', label: 'Bauru' }, { code: 'SP-ITAQUAQUECETUBA', label: 'Itaquaquecetuba' }, { code: 'SP-SAO_CAETANO', label: 'São Caetano do Sul' }, { code: 'SP-FRANCA', label: 'Franca' }, { code: 'SP-PRAIA_GRANDE', label: 'Praia Grande' }, { code: 'SP-BARUERI', label: 'Barueri' }, { code: 'SP-SUZANO', label: 'Suzano' }, { code: 'SP-TABOAO_DA_SERRA', label: 'Taboão da Serra' }, { code: 'SP-LIMEIRA', label: 'Limeira' }, { code: 'SP-SAO_CARLOS', label: 'São Carlos' }, { code: 'SP-AMERICANA', label: 'Americana' }, { code: 'SP-ARARAQUARA', label: 'Araraquara' }, { code: 'SP-MARILIA', label: 'Marília' }, { code: 'SP-PRESIDENTE_PRUDENTE', label: 'Presidente Prudente' }, { code: 'SP-COTIA', label: 'Cotia' }, { code: 'SP-INDAIATUBA', label: 'Indaiatuba' }, { code: 'SP-EMBU_DAS_ARTES', label: 'Embu das Artes' }, { code: 'SP-HORTOLANDIA', label: 'Hortolândia' }, { code: 'SP-SUMARE', label: 'Sumaré' }, { code: 'SP-JACAREI', label: 'Jacareí' }, { code: 'SP-TAUBATE', label: 'Taubaté' }, { code: 'SP-BRAGANCA_PAULISTA', label: 'Bragança Paulista' }, { code: 'SP-ATIBAIA', label: 'Atibaia' }, { code: 'SP-ITAPETININGA', label: 'Itapetininga' }, { code: 'SP-BOTUCATU', label: 'Botucatu' }, { code: 'SP-ARARAS', label: 'Araras' }, { code: 'SP-CATANDUVA', label: 'Catanduva' }, { code: 'SP-SERTAOZINHO', label: 'Sertãozinho' }, { code: 'SP-REGISTRO', label: 'Registro' }] },
  'TO': { nome: 'Tocantins',          cidades: [{ code: 'TO-PALMAS', label: 'Palmas' }, { code: 'TO-ARAGUAINA', label: 'Araguaína' }, { code: 'TO-GURUPI', label: 'Gurupi' }, { code: 'TO-PORTO_NACIONAL', label: 'Porto Nacional' }] }
}

function populateEstadoSelect() {
  const sel = $('estadoSelecionado')
  if (!sel) return
  sel.innerHTML = '<option value="">Selecione o estado</option>'
  Object.entries(ESTADOS_CIDADES)
    .sort((a, b) => a[1].nome.localeCompare(b[1].nome, 'pt-BR'))
    .forEach(([uf, data]) => {
      const opt = document.createElement('option')
      opt.value = uf
      opt.textContent = data.nome
      sel.appendChild(opt)
    })

  const cityCode = state.config.city_code || ''
  if (cityCode) {
    const uf = cityCode.split('-')[0]
    sel.value = uf
    updateCidadesSelect(true)
  }
}

function updateCidadesSelect(keepValue = false) {
  const estSel = $('estadoSelecionado')
  const cidSel = $('cidadeSelecionada')
  if (!estSel || !cidSel) return

  const uf = estSel.value
  cidSel.innerHTML = '<option value="">Selecione a cidade</option>'

  if (!uf || !ESTADOS_CIDADES[uf]) return
  ESTADOS_CIDADES[uf].cidades.forEach(c => {
    const opt = document.createElement('option')
    opt.value = c.code
    opt.textContent = c.label
    cidSel.appendChild(opt)
  })

  if (keepValue && state.config.city_code) {
    cidSel.value = state.config.city_code
  }
}

function addManualHoliday() {
  const dataInput = $('feriadoData')
  const nomeInput = $('feriadoNome')
  if (!dataInput || !nomeInput) return

  const date = dataInput.value.trim()
  const name = nomeInput.value.trim()
  if (!date || !name) { notifyError('Preencha a data e o nome do feriado.'); return }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { notifyError('Data inválida.'); return }

  const list = getManualHolidays()
  if (list.some(h => h.date === date)) { notifyError('Esta data já foi adicionada.'); return }

  list.push({ date, name })
  list.sort((a, b) => a.date.localeCompare(b.date))
  saveManualHolidays(list)

  dataInput.value = ''
  nomeInput.value = ''
  renderManualHolidayTable()
}

function deleteManualHoliday(date) {
  const list = getManualHolidays().filter(h => h.date !== date)
  saveManualHolidays(list)
  renderManualHolidayTable()
}

function renderManualHolidayTable() {
  const tbody = $('feriadosManuaisTabela')
  if (!tbody) return

  const list = getManualHolidays()
  tbody.innerHTML = ''

  if (!list.length) {
    tbody.innerHTML = '<tr><td colspan="3">Nenhum feriado municipal cadastrado.</td></tr>'
    return
  }

  list.forEach(item => {
    const tr = document.createElement('tr')
    const isToday = item.date === toISODate(new Date())
    tr.innerHTML = `
      <td>${formatFullDate(item.date)}</td>
      <td>${item.name}${isToday ? ' <strong>— hoje</strong>' : ''}</td>
      <td><button class="danger-btn" onclick="deleteManualHoliday('${item.date}')">Remover</button></td>
    `
    tbody.appendChild(tr)
  })
}

// ===== BLOCOS DE PRODUÇÃO =====

async function loadBlocos() {
  try {
    const blocos = await apiGet('/agenda/blocos')
    state.blocos = Array.isArray(blocos) ? blocos : []
  } catch (e) {
    console.error('loadBlocos', e)
    state.blocos = []
  }
}

async function limparBlocosVazios() {
  const vazios = state.blocos.filter(b =>
    (b.qtd_vagas || 0) <= 0 &&
    getActiveBlocoOrders(b.id).length === 0
  )
  if (!vazios.length) return
  for (const b of vazios) {
    try {
      // Deleta as orders associadas (canceladas/entregues) antes do bloco
      const ordersDoBloco = state.orders.filter(o => String(o.bloco_id) === String(b.id))
      for (const o of ordersDoBloco) {
        try { await apiDelete('/agenda/orders/' + o.id) } catch (_) {}
      }
      await apiDelete('/agenda/blocos/' + b.id)
      state.blocos = state.blocos.filter(x => String(x.id) !== String(b.id))
      state.orders = state.orders.filter(o => String(o.bloco_id) !== String(b.id))
    } catch (e) {
      // Se a API falhar, pelo menos o bloco não é renderizado (filtro no renderBlocos)
      console.error('limparBlocosVazios', b.id, e)
    }
  }
  notifyPainelRefresh('bloco-deleted')
}

function getActiveBlocoOrders(blocoId) {
  return state.orders.filter(o =>
    String(o.bloco_id) === String(blocoId) &&
    !['entregue', 'cancelado', 'indisponivel'].includes(String(o.status))
  )
}

function renderBlocos() {
  const container = document.getElementById('blocosList')
  if (!container) return

  const total = state.blocos.reduce((acc, b) => acc + getActiveBlocoOrders(b.id).length, 0)
  const countEl = document.getElementById('agendaModalCount')
  if (countEl) countEl.textContent = String(total)
  const cardEl = document.getElementById('agendaCardCount')
  if (cardEl) cardEl.textContent = String(total)

  container.innerHTML = ''

  if (!state.blocos.length) {
    container.innerHTML = '<div class="blocos-empty">Nenhum bloco de produção.<br>Toque em <strong>+ Adicionar nova produção</strong> para começar.</div>'
    return
  }

  state.blocos.forEach(bloco => {
    const ordens = getActiveBlocoOrders(bloco.id)
    const ocupadas = ordens.length
    const totalVagas = bloco.qtd_vagas
    const totalConsumidas = state.orders.filter(o =>
      String(o.bloco_id) === String(bloco.id) &&
      !['cancelado', 'indisponivel'].includes(String(o.status))
    ).length
    const livres = Math.max(0, totalVagas - totalConsumidas)

    // Não renderiza blocos sem vagas e sem pedidos ativos
    if (totalVagas <= 0 && ocupadas === 0) return

    const card = document.createElement('div')
    card.className = 'bloco-card'
    card.dataset.blocoId = bloco.id

    // ---- Header azul ----
    const header = document.createElement('div')
    header.className = 'bloco-header'
    header.innerHTML = `
      <div class="bloco-header-inner">
        <div class="bloco-date-col">
          <div class="bloco-date-label">📅 PRODUÇÃO</div>
          <div class="bloco-date-val">${formatShortDate(bloco.data_producao)}</div>
        </div>
        <div class="bloco-header-sep"></div>
        <div class="bloco-date-col">
          <div class="bloco-date-label">📅 ENTREGA</div>
          <div class="bloco-date-val">${formatShortDate(bloco.data_entrega)}</div>
        </div>
      </div>
      <button type="button" class="bloco-edit-dates-btn" data-bloco-id="${bloco.id}" aria-label="Editar datas">✏️</button>
    `
    header.querySelector('.bloco-edit-dates-btn').addEventListener('click', () => editarDatasBloco(bloco.id))
    card.appendChild(header)

    // ---- Contagem de vagas ----
    const countRow = document.createElement('div')
    countRow.className = 'bloco-count-row'
    countRow.innerHTML = `<span class="bloco-count-icon">👥</span> Vagas: <strong>${ocupadas} de ${totalVagas} ocupadas</strong>`
    card.appendChild(countRow)

    // ---- Lista de vagas ----
    const list = document.createElement('div')
    list.className = 'bloco-vagas-list'

    let vagaNum = 1

    // Vagas ocupadas
    ordens.forEach(ordem => {
      const row = document.createElement('div')
      row.className = 'bloco-vaga bloco-vaga-ocupada'

      const numEl = document.createElement('div')
      numEl.className = 'bloco-vaga-num bloco-vaga-num-ok'
      numEl.textContent = String(vagaNum)

      const info = document.createElement('div')
      info.className = 'bloco-vaga-info'
      info.style.cursor = 'pointer'
      info.title = 'Toque para editar'
      const valorInfo = Number(ordem.valor_total || ordem.valor || 0)
      const valorStr = valorInfo > 0
        ? `<div class="bloco-vaga-valor">R$ ${valorInfo.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</div>`
        : ''
      const _mods = Array.isArray(ordem.modelos) ? ordem.modelos : []
      const _modHtml = _mods.length > 0
        ? '<div class="bloco-vaga-modelos">' + _mods.map(m => `<span class="bloco-vaga-modelo-tag">${m.name || m.modelo || ''}</span>`).join('') + '</div>'
        : ''
      info.innerHTML = `<div class="bloco-vaga-cliente">${ordem.cliente || '-'}</div><div class="bloco-vaga-produto">${ordem.descricao || '-'}</div>${_modHtml}${valorStr}`
      info.addEventListener('click', (e) => { e.stopPropagation(); editarPedido(ordem) })

      const pill = document.createElement('button')
      pill.type = 'button'
      pill.className = 'bloco-status-pill status-' + (ordem.status || 'pendente')
      pill.textContent = statusLabel(ordem)
      pill.addEventListener('click', () => menuPedido({ kind: 'order', row: ordem }))

      const menuBtn = makeActionButton(() => menuPedido({ kind: 'order', row: ordem }))

      row.appendChild(numEl)
      row.appendChild(info)
      row.appendChild(pill)
      row.appendChild(menuBtn)
      list.appendChild(row)
      vagaNum++
    })

    // Vagas vazias
    for (let i = 0; i < livres; i++) {
      const vNum = vagaNum + i
      const row = document.createElement('div')
      row.className = 'bloco-vaga bloco-vaga-vazia'

      const numEl = document.createElement('div')
      numEl.className = 'bloco-vaga-num bloco-vaga-num-vazia'
      numEl.textContent = String(vNum)

      const info = document.createElement('div')
      info.className = 'bloco-vaga-info'
      info.innerHTML = '<span class="bloco-vaga-disponivel">Vaga disponível</span>'

      const addBtn = document.createElement('button')
      addBtn.type = 'button'
      addBtn.className = 'bloco-add-pedido-btn'
      addBtn.textContent = '+ Adicionar pedido'
      addBtn.addEventListener('click', () => adicionarPedidoNaVaga(bloco.id))

      const removeBtn = document.createElement('button')
      removeBtn.type = 'button'
      removeBtn.className = 'bloco-remove-vaga-btn'
      removeBtn.innerHTML = '&times;'
      removeBtn.title = 'Remover vaga'
      removeBtn.addEventListener('click', () => removerVagaDoBloco(bloco.id))

      row.appendChild(numEl)
      row.appendChild(info)
      row.appendChild(addBtn)
      row.appendChild(removeBtn)
      list.appendChild(row)
    }

    card.appendChild(list)

    // ---- Rodapé: Adicionar vaga ----
    const footer = document.createElement('div')
    footer.className = 'bloco-card-footer'
    const addVagaBtn = document.createElement('button')
    addVagaBtn.type = 'button'
    addVagaBtn.className = 'bloco-add-vaga-btn'
    addVagaBtn.textContent = '+ Adicionar vaga'
    addVagaBtn.addEventListener('click', () => adicionarVagaAoBloco(bloco.id))
    footer.appendChild(addVagaBtn)
    card.appendChild(footer)

    container.appendChild(card)
  })
  scheduleRenderSync()
}

async function adicionarBloco() {
  try {
    const result = await promptDuasDatas({
      title: 'Nova produção',
      prodValue: '',
      entValue: ''
    })
    if (result === null) return

    const dataProd = normalizeEditableDateInput(result.prod)
    const dataEnt  = normalizeEditableDateInput(result.ent)
    if (!dataProd) { notifyError('Data de produção inválida.'); return }
    if (!dataEnt)  { notifyError('Data de entrega inválida.'); return }

    const vagasInput = await ui().prompt({
      title: 'Quantidade de vagas',
      message: 'Quantas vagas terá este bloco de produção?',
      label: 'Vagas',
      value: '5',
      placeholder: 'Ex.: 5'
    })
    if (vagasInput === null) return
    const qtdVagas = Math.max(1, parseInt(vagasInput) || 1)

    const bloco = await apiPost('/agenda/blocos', {
      data_producao: dataProd,
      data_entrega: dataEnt,
      qtd_vagas: qtdVagas
    })
    state.blocos.push(bloco)
    state.blocos.sort((a, b) => String(a.data_producao).localeCompare(String(b.data_producao)))
    notifyPainelRefresh('bloco-created')
    renderBlocos()
    notifySuccess('Bloco de produção criado!')
  } catch (e) {
    console.error(e)
    notifyError('Erro ao criar bloco: ' + e.message)
  }
}

async function editarDatasBloco(blocoId) {
  try {
    const bloco = state.blocos.find(b => String(b.id) === String(blocoId))
    if (!bloco) return

    const result = await promptDuasDatas({
      title: 'Editar datas do bloco',
      prodValue: formatEditableDateInput(bloco.data_producao),
      entValue:  formatEditableDateInput(bloco.data_entrega)
    })
    if (result === null) return

    const dataProd = normalizeEditableDateInput(result.prod)
    const dataEnt  = normalizeEditableDateInput(result.ent)
    if (!dataProd) { notifyError('Data de produção inválida.'); return }
    if (!dataEnt)  { notifyError('Data de entrega inválida.'); return }

    const updated = await apiPatch('/agenda/blocos/' + blocoId, {
      data_producao: dataProd,
      data_entrega: dataEnt
    })
    const idx = state.blocos.findIndex(b => String(b.id) === String(blocoId))
    if (idx >= 0) state.blocos[idx] = updated
    state.blocos.sort((a, b) => String(a.data_producao).localeCompare(String(b.data_producao)))

    // Update matching orders' dates
    state.orders.forEach(o => {
      if (String(o.bloco_id) === String(blocoId)) {
        o.prod_date = dataProd
        o.ent_date = dataEnt
      }
    })

    notifyPainelRefresh('bloco-updated')
    renderBlocos()
    notifySuccess('Datas atualizadas!')
  } catch (e) {
    console.error(e)
    notifyError('Erro ao editar datas: ' + e.message)
  }
}

async function adicionarVagaAoBloco(blocoId) {
  try {
    const updated = await apiPost('/agenda/blocos/' + blocoId + '/vaga', {})
    const idx = state.blocos.findIndex(b => String(b.id) === String(blocoId))
    if (idx >= 0) state.blocos[idx] = updated
    renderBlocos()
  } catch (e) {
    console.error(e)
    notifyError('Erro ao adicionar vaga: ' + e.message)
  }
}

async function removerVagaDoBloco(blocoId) {
  try {
    const updated = await apiDelete('/agenda/blocos/' + blocoId + '/vaga')
    const idx = state.blocos.findIndex(b => String(b.id) === String(blocoId))
    if (idx >= 0) state.blocos[idx] = updated

    const semVagas = (updated.qtd_vagas || 0) <= 0
    const semPedidos = getActiveBlocoOrders(blocoId).length === 0
    if (semVagas && semPedidos) {
      await apiDelete('/agenda/blocos/' + blocoId)
      state.blocos = state.blocos.filter(b => String(b.id) !== String(blocoId))
      state.orders = state.orders.filter(o => String(o.bloco_id) !== String(blocoId))
      notifyPainelRefresh('bloco-deleted')
    }

    renderBlocos()
  } catch (e) {
    if (e.message && e.message.includes('no_empty_slots')) {
      notifyError('Não há vagas vazias para remover.')
    } else {
      console.error(e)
      notifyError('Erro ao remover vaga: ' + e.message)
    }
  }
}

async function excluirBloco(blocoId, ocupadas) {
  try {
    const bloco = state.blocos.find(b => String(b.id) === String(blocoId))
    if (!bloco) return
    const msg = ocupadas > 0
      ? `Este bloco tem ${ocupadas} pedido${ocupadas !== 1 ? 's' : ''}. Excluir irá remover o bloco e todos os seus pedidos. Deseja continuar?`
      : 'Excluir este bloco de produção?'
    const confirmed = await ui().confirm(msg, { title: 'Excluir bloco', confirmText: 'Excluir', type: 'danger' })
    if (!confirmed) return
    await apiDelete('/agenda/blocos/' + blocoId)
    state.blocos = state.blocos.filter(b => String(b.id) !== String(blocoId))
    state.orders = state.orders.filter(o => String(o.bloco_id) !== String(blocoId))
    notifyPainelRefresh('bloco-deleted')
    renderBlocos()
    notifySuccess('Bloco excluído.')
  } catch (e) {
    console.error(e)
    notifyError('Erro ao excluir bloco: ' + e.message)
  }
}


async function fetchCatalogModels() {
  try {
    const models = await apiGet('/models')
    return Array.isArray(models) ? models : []
  } catch (_) { return [] }
}

function promptSelecionarModelos(currentSelected, allModels) {
  return new Promise(resolve => {
    const doc = (function() {
      try {
        if (window.parent && window.parent !== window && window.parent.document && window.parent.document.body)
          return window.parent.document
      } catch (_) {}
      return document
    })()

    const selected = new Set((currentSelected || []).map(m => String(m.id || '')).filter(Boolean))

    const backdrop = doc.createElement('div')
    Object.assign(backdrop.style, {
      position: 'fixed', inset: '0', background: 'rgba(15,23,42,.56)',
      backdropFilter: 'blur(2px)', display: 'flex', alignItems: 'flex-end',
      justifyContent: 'center', zIndex: '1000002', boxSizing: 'border-box'
    })

    const sheet = doc.createElement('div')
    Object.assign(sheet.style, {
      background: '#fff', borderRadius: '18px 18px 0 0', width: '100%', maxWidth: '560px',
      maxHeight: '70vh', display: 'flex', flexDirection: 'column',
      boxShadow: '0 -4px 30px rgba(0,0,0,.18)', fontFamily: 'system-ui,sans-serif', overflow: 'hidden'
    })

    const head = doc.createElement('div')
    Object.assign(head.style, {
      padding: '18px 20px 14px', fontWeight: '800', fontSize: '16px', color: '#0f172a',
      borderBottom: '1px solid #f1f5f9', flexShrink: '0'
    })
    head.textContent = 'Selecionar Modelos'

    const body = doc.createElement('div')
    Object.assign(body.style, { overflowY: 'auto', flex: '1', padding: '6px 0' })

    if (!allModels.length) {
      const empty = doc.createElement('div')
      Object.assign(empty.style, { padding: '24px 20px', textAlign: 'center', color: '#94a3b8', fontSize: '14px' })
      empty.textContent = 'Nenhum modelo cadastrado no catálogo.'
      body.appendChild(empty)
    } else {
      allModels.forEach(model => {
        const modelId = String(model.id || '')
        const modelName = String(model.nome || model.name || model.modelo || 'Modelo').trim()
        const row = doc.createElement('label')
        Object.assign(row.style, {
          display: 'flex', alignItems: 'center', gap: '14px', padding: '14px 20px',
          cursor: 'pointer', borderBottom: '1px solid #f8fafc'
        })
        row.addEventListener('mouseenter', () => { row.style.background = '#f8fafc' })
        row.addEventListener('mouseleave', () => { row.style.background = '' })

        const cb = doc.createElement('input')
        cb.type = 'checkbox'
        cb.checked = selected.has(modelId)
        Object.assign(cb.style, { width: '20px', height: '20px', accentColor: '#2563eb', flexShrink: '0', cursor: 'pointer' })
        cb.addEventListener('change', () => {
          if (cb.checked) selected.add(modelId)
          else selected.delete(modelId)
        })

        const lbl = doc.createElement('span')
        Object.assign(lbl.style, { fontSize: '15px', color: '#0f172a', flex: '1', lineHeight: '1.4' })
        lbl.textContent = modelName

        row.appendChild(cb)
        row.appendChild(lbl)
        body.appendChild(row)
      })
    }

    const foot = doc.createElement('div')
    Object.assign(foot.style, {
      padding: '12px 20px 20px', display: 'flex', gap: '10px',
      borderTop: '1px solid #f1f5f9', flexShrink: '0'
    })

    function makeBtn(text, primary) {
      const b = doc.createElement('button')
      b.type = 'button'; b.textContent = text
      Object.assign(b.style, {
        flex: '1', border: 'none', borderRadius: '12px', padding: '13px 16px',
        fontSize: '15px', fontWeight: '700', cursor: 'pointer',
        background: primary ? '#2563eb' : '#e2e8f0',
        color: primary ? '#fff' : '#0f172a'
      })
      return b
    }

    const cancelBtn = makeBtn('Cancelar', false)
    const applyBtn  = makeBtn('Aplicar', true)

    cancelBtn.addEventListener('click', () => { backdrop.remove(); resolve(null) })
    applyBtn.addEventListener('click', () => {
      const result = allModels
        .filter(m => selected.has(String(m.id || '')))
        .map(m => ({ id: String(m.id || ''), name: String(m.nome || m.name || m.modelo || '') }))
      backdrop.remove()
      resolve(result)
    })
    backdrop.addEventListener('click', e => { if (e.target === backdrop) { backdrop.remove(); resolve(null) } })

    foot.appendChild(cancelBtn)
    foot.appendChild(applyBtn)
    sheet.appendChild(head)
    sheet.appendChild(body)
    sheet.appendChild(foot)
    backdrop.appendChild(sheet)
    doc.body.appendChild(backdrop)
  })
}

function promptDescricaoComModelos(title, currentDescricao, currentModelos, allModels) {
  return new Promise(resolve => {
    const doc = (function() {
      try {
        if (window.parent && window.parent !== window && window.parent.document && window.parent.document.body)
          return window.parent.document
      } catch (_) {}
      return document
    })()

    let selectedModelos = Array.isArray(currentModelos) ? [...currentModelos] : []

    const backdrop = doc.createElement('div')
    Object.assign(backdrop.style, {
      position: 'fixed', inset: '0', background: 'rgba(15,23,42,.56)',
      backdropFilter: 'blur(2px)', display: 'flex', alignItems: 'center',
      justifyContent: 'center', padding: '18px', zIndex: '1000001', boxSizing: 'border-box'
    })

    const modal = doc.createElement('div')
    Object.assign(modal.style, {
      background: '#fff', borderRadius: '18px', width: '100%', maxWidth: '360px',
      boxShadow: '0 8px 40px rgba(0,0,0,.18)', fontFamily: 'system-ui,sans-serif', overflow: 'hidden'
    })

    const head = doc.createElement('div')
    head.textContent = title
    Object.assign(head.style, {
      padding: '18px 20px 14px', fontWeight: '800', fontSize: '16px', color: '#0f172a'
    })

    const body = doc.createElement('div')
    Object.assign(body.style, { padding: '0 20px 16px', display: 'flex', flexDirection: 'column', gap: '12px' })

    // Label + botão Modelos na mesma linha
    const labelRow = doc.createElement('div')
    Object.assign(labelRow.style, { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' })

    const lbl = doc.createElement('label')
    lbl.textContent = 'Descrição do produto'
    Object.assign(lbl.style, { fontSize: '13px', fontWeight: '700', color: '#334155' })

    const modelBtn = doc.createElement('button')
    modelBtn.type = 'button'
    Object.assign(modelBtn.style, {
      border: 'none', borderRadius: '8px', padding: '5px 10px',
      fontSize: '12px', fontWeight: '700', cursor: 'pointer',
      background: '#eff6ff', color: '#2563eb'
    })

    function updateModelBtn() {
      modelBtn.textContent = selectedModelos.length > 0 ? `📦 Modelos (${selectedModelos.length})` : '📦 Modelos'
    }
    updateModelBtn()

    modelBtn.addEventListener('click', async () => {
      if (!allModels.length) { return }
      const result = await promptSelecionarModelos(selectedModelos, allModels)
      if (result !== null) {
        selectedModelos = result
        updateModelBtn()
        renderTags()
      }
    })

    labelRow.appendChild(lbl)
    if (allModels.length > 0) labelRow.appendChild(modelBtn)

    const textarea = doc.createElement('textarea')
    textarea.placeholder = 'Ex.: Sofá Istanbul 3 lugares'
    textarea.value = currentDescricao || ''
    Object.assign(textarea.style, {
      width: '100%', boxSizing: 'border-box', border: '1px solid #cbd5e1',
      borderRadius: '12px', padding: '12px 14px', fontSize: '15px', outline: 'none',
      resize: 'none', minHeight: '80px', fontFamily: 'system-ui,sans-serif', lineHeight: '1.4'
    })
    textarea.addEventListener('focus', () => { textarea.style.borderColor = '#2563eb'; textarea.style.boxShadow = '0 0 0 3px rgba(37,99,235,.14)' })
    textarea.addEventListener('blur', () => { textarea.style.borderColor = '#cbd5e1'; textarea.style.boxShadow = '' })

    const tagsContainer = doc.createElement('div')
    Object.assign(tagsContainer.style, { display: 'flex', flexWrap: 'wrap', gap: '6px', minHeight: '0' })

    function renderTags() {
      tagsContainer.innerHTML = ''
      selectedModelos.forEach(m => {
        const tag = doc.createElement('span')
        Object.assign(tag.style, {
          display: 'inline-flex', alignItems: 'center', gap: '5px',
          background: '#dbeafe', color: '#1e40af', borderRadius: '20px',
          padding: '3px 10px', fontSize: '12px', fontWeight: '600'
        })
        tag.textContent = m.name || m.modelo || ''
        tagsContainer.appendChild(tag)
      })
    }
    renderTags()

    const descWrap = doc.createElement('div')
    descWrap.appendChild(labelRow)
    descWrap.appendChild(textarea)

    body.appendChild(descWrap)
    body.appendChild(tagsContainer)

    const foot = doc.createElement('div')
    Object.assign(foot.style, {
      padding: '12px 20px 18px', display: 'flex', gap: '10px', justifyContent: 'flex-end'
    })

    function makeBtn(text, primary) {
      const b = doc.createElement('button')
      b.type = 'button'; b.textContent = text
      Object.assign(b.style, {
        border: 'none', borderRadius: '12px', padding: '11px 20px',
        fontSize: '14px', fontWeight: '800', cursor: 'pointer',
        background: primary ? '#2563eb' : '#e2e8f0',
        color: primary ? '#fff' : '#0f172a'
      })
      return b
    }
    const cancelBtn = makeBtn('Cancelar', false)
    const confirmBtn = makeBtn('Confirmar', true)

    cancelBtn.addEventListener('click', () => { backdrop.remove(); resolve(null) })
    confirmBtn.addEventListener('click', () => {
      backdrop.remove()
      resolve({ descricao: textarea.value.trim(), modelos: selectedModelos })
    })

    foot.appendChild(cancelBtn)
    foot.appendChild(confirmBtn)
    modal.appendChild(head)
    modal.appendChild(body)
    modal.appendChild(foot)
    backdrop.appendChild(modal)
    doc.body.appendChild(backdrop)
    setTimeout(() => textarea.focus(), 30)
  })
}

async function editarPedido(ordem) {
  try {
    const clienteVal = await ui().prompt({
      title: 'Editar pedido',
      message: 'Nome do cliente',
      label: 'Cliente',
      placeholder: 'Ex.: João Silva',
      value: ordem.cliente || ''
    })
    if (clienteVal === null) return
    const cliente = clienteVal.trim()
    if (!cliente) { notifyError('Informe o nome do cliente.'); return }

    const allModels = await fetchCatalogModels()
    const descResult = await promptDescricaoComModelos(
      'Editar pedido',
      ordem.descricao || '',
      Array.isArray(ordem.modelos) ? ordem.modelos : [],
      allModels
    )
    if (descResult === null) return
    const descricao = descResult.descricao
    if (!descricao) { notifyError('Informe a descrição do produto.'); return }
    const selectedModels = descResult.modelos

    const _vc = getValorCache()
    const _byId = ordem.id ? _vc[String(ordem.id)] : 0
    const _byCk = _vc[makeValorCacheKey(ordem)]
    const valorAtual = Number(ordem.valor_total || ordem.valor || 0) || Number(_byId || _byCk || 0)
    const valorVal = await ui().prompt({
      title: 'Editar pedido',
      message: 'Valor da venda (Cancelar = manter valor atual)',
      label: 'Valor (R$)',
      placeholder: 'Ex.: 1500,00',
      value: valorAtual > 0 ? String(valorAtual).replace('.', ',') : ''
    })
    const valorNum = valorVal === null
      ? valorAtual
      : valorVal.trim() === ''
        ? 0
        : parseFloat(valorVal.trim().replace(/\./g, '').replace(',', '.')) || 0

    console.log('[ESD-DIAG] editarPedido: ordem.id=', ordem.id, 'valorAtual=', valorAtual, 'valorNum=', valorNum, 'cliente=', cliente, 'descricao=', descricao)
    if (valorNum > 0) saveValorCache(ordem.id, valorNum, { cliente, descricao })
    console.log('[ESD-DIAG] Cache após saveValorCache:', localStorage.getItem('esd_order_valores'))
    const row = await apiPatch('/agenda/orders/' + ordem.id, {
      cliente,
      descricao,
      valor: valorNum,
      valor_total: valorNum,
      modelos: selectedModels
    })
    // Mescla valores do usuário sobre a resposta do servidor,
    // pois o backend pode não retornar os campos atualizados
    replaceOrder({ ...row, cliente, descricao, valor: valorNum, valor_total: valorNum, modelos: selectedModels })
    notifyPainelRefresh('order-updated')
    renderBlocos()
    notifySuccess('Pedido atualizado!')
  } catch (e) {
    console.error(e)
    notifyError('Erro ao editar pedido: ' + e.message)
  }
}

async function adicionarPedidoNaVaga(blocoId) {
  try {
    const clienteVal = await ui().prompt({
      title: 'Adicionar pedido',
      message: 'Nome do cliente',
      label: 'Cliente',
      placeholder: 'Ex.: João Silva'
    })
    if (clienteVal === null) return
    const cliente = clienteVal.trim()
    if (!cliente) { notifyError('Informe o nome do cliente.'); return }

    const allModels = await fetchCatalogModels()
    const descResult = await promptDescricaoComModelos(
      'Adicionar pedido',
      '',
      [],
      allModels
    )
    if (descResult === null) return
    const descricao = descResult.descricao
    if (!descricao) { notifyError('Informe a descrição do produto.'); return }
    const selectedModels = descResult.modelos

    const valorVal = await ui().prompt({
      title: 'Adicionar pedido',
      message: 'Valor da venda (Cancelar = pular este campo)',
      label: 'Valor (R$)',
      placeholder: 'Ex.: 1500,00'
    })
    const valorNum = (valorVal === null || valorVal.trim() === '')
      ? 0
      : parseFloat(valorVal.trim().replace(/\./g, '').replace(',', '.')) || 0

    saveValorCache(null, valorNum, { cliente, descricao })
    const row = await apiPost('/agenda/blocos/' + blocoId + '/pedido', {
      cliente,
      descricao,
      valor: valorNum,
      valor_total: valorNum,
      modelos: selectedModels
    })
    const newOrder = normalizeOrder({ ...row, cliente, descricao, valor: valorNum, valor_total: valorNum, modelos: selectedModels })
    state.orders.push(newOrder)
    if (newOrder.id) saveValorCache(newOrder.id, valorNum, { cliente, descricao })
    notifyPainelRefresh('order-created')
    renderBlocos()
    notifySuccess('Pedido adicionado!')
  } catch (e) {
    if (e.message && e.message.includes('bloco_full')) {
      notifyError('Todas as vagas deste bloco já estão ocupadas.')
    } else {
      console.error(e)
      notifyError('Erro ao adicionar pedido: ' + e.message)
    }
  }
}

window.editarPedido = editarPedido
window.adicionarBloco = adicionarBloco
window.editarDatasBloco = editarDatasBloco
window.adicionarVagaAoBloco = adicionarVagaAoBloco
window.removerVagaDoBloco = removerVagaDoBloco
window.excluirBloco = excluirBloco
window.adicionarPedidoNaVaga = adicionarPedidoNaVaga

window.mudarStatus = mudarStatus
window.menuPedido = menuPedido
window.closeActionSheet = closeActionSheet
window.excluir = excluir
window.addManualHoliday = addManualHoliday
window.deleteManualHoliday = deleteManualHoliday
window.updateCidadesSelect = updateCidadesSelect
window.handleCityChange = handleCityChange
window.limparHistorico = limparHistorico
window.limparAgenda = limparAgenda
window.initAgenda = initAgenda

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initAgenda, { once: true })
} else {
  initAgenda()
}

window.addEventListener('load', () => scheduleRenderSync(20))
window.addEventListener('pageshow', () => scheduleRenderSync(20))
window.addEventListener('resize', () => scheduleRenderSync(20))
window.addEventListener('orientationchange', () => scheduleRenderSync(20))
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    closeActionSheet(null, { force: true, silent: true })
    return
  }
  scheduleRenderSync(20)
})
window.addEventListener('pagehide', () => closeActionSheet(null, { force: true, silent: true }))

window.addEventListener('keydown', function(event){
  if(event.key === 'Escape') closeActionSheet()
})

/* === Fullscreen modal helpers === */
function applyShellFullscreen(on) {
  // When loaded inside app-shell iframe, hide parent header/nav and resize iframe to cover viewport.
  // Uses window.frameElement (our own <iframe> in the parent DOM) — works with the multi-frame pool
  // where there is no single #contentFrame element.
  try {
    if (window.parent === window) return
    const pdoc = window.parent.document
    const header = pdoc.querySelector('.header')
    const nav = pdoc.querySelector('.nav')
    const frame = window.frameElement   // our own <iframe> in the parent DOM
    const loading = pdoc.getElementById('shellLoading')
    if (on) {
      if (header) { header.dataset._prevDisplay = header.style.display || ''; header.style.display = 'none' }
      if (nav)    { nav.dataset._prevDisplay    = nav.style.display    || ''; nav.style.display    = 'none' }
      if (frame) {
        frame.dataset._prevPosition = frame.style.position || ''
        frame.dataset._prevTop      = frame.style.top      || ''
        frame.dataset._prevLeft     = frame.style.left     || ''
        frame.dataset._prevWidth    = frame.style.width    || ''
        frame.dataset._prevHeight   = frame.style.height   || ''
        frame.dataset._prevZ        = frame.style.zIndex   || ''
        frame.style.position = 'fixed'
        frame.style.top = '0'; frame.style.left = '0'
        frame.style.width = '100vw'; frame.style.height = '100vh'
        frame.style.zIndex = '9999'
      }
      if (loading) loading.classList.add('hidden')
    } else {
      if (header) header.style.display = header.dataset._prevDisplay || ''
      if (nav)    nav.style.display    = nav.dataset._prevDisplay    || ''
      if (frame) {
        frame.style.position = frame.dataset._prevPosition || ''
        frame.style.top      = frame.dataset._prevTop      || ''
        frame.style.left     = frame.dataset._prevLeft     || ''
        frame.style.width    = frame.dataset._prevWidth    || ''
        frame.style.height   = frame.dataset._prevHeight   || ''
        frame.style.zIndex   = frame.dataset._prevZ        || ''
      }
    }
  } catch (e) {
    // cross-origin or shell not available — fail silently; in-iframe overlay still works
  }
}

function openAgendaFullscreen() {
  if (typeof renderBlocos === 'function') { try { renderBlocos() } catch (_) {} }
}
function closeAgendaFullscreen() {}
window.openAgendaFullscreen = openAgendaFullscreen
window.closeAgendaFullscreen = closeAgendaFullscreen

// Update teaser counts on dashboard cards + modal header badges
function updateAgendaCardTeaser() {
  try {
    const ativos = (typeof getActiveOrders === 'function') ? getActiveOrders() : []
    const blocoTotal = (state.blocos || []).reduce((acc, b) => {
      if (typeof getActiveBlocoOrders === 'function') return acc + getActiveBlocoOrders(b.id).length
      return acc + ativos.filter(o => String(o.bloco_id) === String(b.id)).length
    }, 0)
    const total = Math.max(ativos.length, blocoTotal) || 0
    const setText = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val }
    setText('agendaCardCount',  String(total))
    setText('agendaModalCount', String(total))
    setText('agendaShown',      String(total))
    setText('agendaTotal',      String(total))
    // Count overdue orders (ent_date < today, still active)
    const today = new Date(); today.setHours(0,0,0,0)
    const atrasados = ativos.filter(o => {
      const d = o.ent_date ? new Date(o.ent_date) : null
      return d && d < today
    }).length
    setText('agendaCardLate', String(atrasados))
    const lateEl = document.querySelector('.pill-late')
    if (lateEl) {
      lateEl.style.background = atrasados > 0 ? '#b13f53' : ''
      lateEl.style.color = atrasados > 0 ? '#fff' : ''
      lateEl.style.fontWeight = atrasados > 0 ? '700' : ''
    }
  } catch (_) {}
}
const _origRenderAll = (typeof renderAll === 'function') ? renderAll : null
if (_origRenderAll) {
  renderAll = function() {
    _origRenderAll.apply(this, arguments)
    updateAgendaCardTeaser()
  }
}

/* ===== helper: open modal and scroll to top after layout ===== */
function _openModal(id){
  var el = document.getElementById(id);
  if(!el) return;
  el.hidden = false;
  document.body.style.overflow = 'hidden';
  // Fix: iframe position:fixed is relative to iframe viewport, not parent window.
  // applyShellFullscreen makes the iframe cover the parent viewport entirely,
  // so the modal always appears where the user can see it.
  applyShellFullscreen(true);
  // Double rAF: first frame lets browser unhide+layout, second frame resets scroll
  requestAnimationFrame(function(){
    requestAnimationFrame(function(){
      el.scrollTop = 0;
      var wrap = el.querySelector('.fs-table-wrap');
      if(wrap) wrap.scrollTop = 0;
    });
  });
}
function _closeModal(id){
  var el = document.getElementById(id);
  if(el){ el.hidden = true; document.body.style.overflow = ''; }
  applyShellFullscreen(false);
}

/* ===== Configurações fullscreen ===== */

/* ===== Feriados fullscreen ===== */
function openFeriadosFullscreen(){ _openModal('feriadosFullscreen'); }
function closeFeriadosFullscreen(){ _closeModal('feriadosFullscreen'); }

/* ===== Histórico fullscreen ===== */
function openHistoricoFullscreen(){ _openModal('historicoFullscreen'); }
function closeHistoricoFullscreen(){ _closeModal('historicoFullscreen'); }
