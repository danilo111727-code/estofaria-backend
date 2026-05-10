const API = (window.API_BASE || '') + '/api'

const PAINEL_SYNC_KEY = 'estofaria_sync:agenda'
const PAINEL_CACHE_PREFIX = 'estofaria_painel_cache:'
const SEMANA_BLOQUEIOS_KEY  = 'esd_semana_bloqueios'
const SEMANA_BLOQ_COUNT_KEY = 'esd_bloqueios_count'
const DIAS_UTEIS_KEY = 'esd_dias_uteis'
const SEMANAS_MANUAIS_KEY = 'esd_semanas_manuais'

const DIAS_SEMANA = [
  { label: 'Dom', value: 0 },
  { label: 'Seg', value: 1 },
  { label: 'Ter', value: 2 },
  { label: 'Qua', value: 3 },
  { label: 'Qui', value: 4 },
  { label: 'Sex', value: 5 },
  { label: 'Sáb', value: 6 }
]

const state = {
  config: { prazo_dias: 0, vagas_semana: 0, tipo_dias: '', city_code: '', data_inicio_entrega: '' },
  orders: [],
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

function formatWeekRange() {
  const { iniISO, fimISO } = getWeekWindow()
  const ini = new Date(iniISO + 'T00:00:00')
  const fim = new Date(fimISO + 'T00:00:00')
  const fmtDay = d => String(d.getDate()).padStart(2, '0')
  const fmtMon = d => String(d.getMonth() + 1).padStart(2, '0')
  const fmtYear = d => d.getFullYear()
  if (ini.getMonth() === fim.getMonth()) {
    return fmtDay(ini) + '/' + fmtMon(ini) + ' a ' + fmtDay(fim) + '/' + fmtMon(fim) + '/' + fmtYear(fim)
  }
  return fmtDay(ini) + '/' + fmtMon(ini) + ' a ' + fmtDay(fim) + '/' + fmtMon(fim) + '/' + fmtYear(fim)
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

function getSemanaKey(dateISO) {
  if (!dateISO) return ''
  const d = new Date(dateISO + 'T00:00:00')
  return toISODate(startOfWeek(d))
}

function getSemanaAjustes() {
  try { return JSON.parse(localStorage.getItem(SEMANA_BLOQUEIOS_KEY) || '{}') } catch { return {} }
}

function saveSemanaAjustes(obj) {
  try { localStorage.setItem(SEMANA_BLOQUEIOS_KEY, JSON.stringify(obj)) } catch {}
}

function getSemanaBloqueios() {
  try { return JSON.parse(localStorage.getItem(SEMANA_BLOQ_COUNT_KEY) || '{}') } catch { return {} }
}
function saveSemanaBloqueios(obj) {
  try { localStorage.setItem(SEMANA_BLOQ_COUNT_KEY, JSON.stringify(obj)) } catch {}
}
function getBloqueiosSemana(weekStartISO) {
  return getSemanaBloqueios()[weekStartISO] || 0
}

function getSemanaManuais() {
  try { return JSON.parse(localStorage.getItem(SEMANAS_MANUAIS_KEY) || '[]') } catch { return [] }
}

function saveSemanaManuais(arr) {
  try { localStorage.setItem(SEMANAS_MANUAIS_KEY, JSON.stringify(arr)) } catch {}
}

function adicionarSemana() {
  const input = $('dataSemana')
  if (!input || !input.value) {
    notifyError('Selecione uma data de entrega para a nova semana.')
    return
  }
  const entDate = input.value
  const weekKey = getSemanaKey(entDate)

  const manuais = getSemanaManuais()
  if (manuais.some(s => s.weekKey === weekKey)) {
    notifyError('Essa semana já foi adicionada manualmente.')
    return
  }
  const temPedido = getActiveOrders().some(o =>
    getSemanaKey(o.ent_date || o.prod_date) === weekKey
  )
  if (temPedido) {
    notifyError('Essa semana já existe na agenda (possui pedidos).')
    return
  }

  const prodDate = calcProdDate(entDate)
  manuais.push({ weekKey, entDate, prodDate })
  saveSemanaManuais(manuais)
  input.value = ''
  renderAgendaTabela()
}

function getDiasUteis() {
  try {
    const stored = localStorage.getItem(DIAS_UTEIS_KEY)
    if (stored) return JSON.parse(stored)
  } catch {}
  return [1, 2, 3, 4, 5]
}

function saveDiasUteis(arr) {
  try { localStorage.setItem(DIAS_UTEIS_KEY, JSON.stringify(arr)) } catch {}
}

function toggleDiaUtil(dia) {
  const current = getDiasUteis()
  const updated = current.includes(dia)
    ? current.filter(d => d !== dia)
    : [...current, dia].sort((a, b) => a - b)
  saveDiasUteis(updated)
  renderDiasUteisCheckboxes()
}

function renderDiasUteisCheckboxes() {
  const container = $('diasUteisCheckboxes')
  const wrapper = $('diasUteisWrapper')
  if (!container) return

  const tipoDias = $('tipoDias')?.value || state.config.tipo_dias || 'corrido'
  if (wrapper) wrapper.style.display = tipoDias === 'uteis' ? 'block' : 'none'
  if (tipoDias !== 'uteis') return

  const selected = getDiasUteis()
  container.innerHTML = ''
  DIAS_SEMANA.forEach(({ label, value }) => {
    const lbl = document.createElement('label')
    lbl.style.cssText = 'display:inline-flex;align-items:center;gap:5px;cursor:pointer;font-size:14px'
    const cb = document.createElement('input')
    cb.type = 'checkbox'
    cb.checked = selected.includes(value)
    cb.onchange = () => toggleDiaUtil(value)
    lbl.appendChild(cb)
    lbl.appendChild(document.createTextNode(label))
    container.appendChild(lbl)
  })
}

function getVagasSemana(weekStartISO) {
  const padrao = Math.max(0, Number(state.config.vagas_semana) || 0)
  const ajustes = getSemanaAjustes()
  const adj = ajustes[weekStartISO]
  // Aplica apenas ajustes para cima (extras abertas); ignora dados antigos de bloqueio
  return (adj !== undefined && adj > padrao) ? adj : padrao
}

function bloquearVaga(weekStartISO) {
  const bloqueios = getSemanaBloqueios()
  const bloqueiosAtual = bloqueios[weekStartISO] || 0
  bloqueios[weekStartISO] = bloqueiosAtual + 1
  saveSemanaBloqueios(bloqueios)
  renderAll()
  closeActionSheet()
}

function desbloquearVaga(weekStartISO) {
  const bloqueios = getSemanaBloqueios()
  const bloqueiosAtual = bloqueios[weekStartISO] || 0
  if (bloqueiosAtual > 0) {
    bloqueios[weekStartISO] = bloqueiosAtual - 1
    saveSemanaBloqueios(bloqueios)
  }
  renderAll()
  closeActionSheet()
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

async function reprogramarVaga(weekKey, currentEntDate, currentProdDate) {
  try {
    const prodCalculadaInicial = currentProdDate || calcProdDate(currentEntDate)
    const result = await promptDuasDatas({
      title: 'Reprogramar vaga',
      prodValue: formatEditableDateInput(prodCalculadaInicial),
      entValue:  formatEditableDateInput(currentEntDate)
    })
    if (result === null) return

    const novaEnt  = normalizeEditableDateInput(result.ent)
    const novaProd = normalizeEditableDateInput(result.prod)

    if (!novaEnt) {
      await ui().alert('Data de entrega inválida. Use o padrão DD/MM/AAAA.', { title: 'Data inválida' })
      return
    }
    if (!novaProd) {
      await ui().alert('Data de produção inválida. Use o padrão DD/MM/AAAA.', { title: 'Data inválida' })
      return
    }

    const novoWeek = getSemanaKey(novaEnt)

    // Remove entrada antiga e insere com novo weekKey/datas
    const manuais = getSemanaManuais().filter(s => s.weekKey !== weekKey && s.weekKey !== novoWeek)
    manuais.push({ weekKey: novoWeek, entDate: novaEnt, prodDate: novaProd })
    saveSemanaManuais(manuais)

    notifyPainelRefresh('slot-rescheduled')
    renderAll()
    closeActionSheet()
  } catch (e) {
    console.error(e)
    notifyError('Erro ao reprogramar vaga: ' + e.message)
  }
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

function getBaseDate() {
  if (state.config.data_inicio_entrega) {
    return new Date(state.config.data_inicio_entrega + 'T00:00:00')
  }
  return new Date()
}

function startOfWeek(base = new Date()) {
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate())
  const day = d.getDay()
  const diff = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + diff)
  d.setHours(0, 0, 0, 0)
  return d
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

function addScheduleDays(date, days, tipo) {
  if (tipo === 'uteis') return addBusinessDays(date, days)
  const d = new Date(date)
  d.setDate(d.getDate() + days)
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

function getAgendaRows() {
  return getActiveOrders()
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

function getWeekCandidates(weekStart, tipo) {
  const dates = []
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart)
    d.setDate(d.getDate() + i)
    if (tipo === 'uteis') {
      if (isWorkingDay(d)) dates.push(new Date(d))
    } else {
      dates.push(new Date(d))
    }
  }
  return dates
}

function getSlotDatesByIndex(index) {
  const vagas = Math.max(1, Number(state.config.vagas_semana) || 1)
  const tipo = state.config.tipo_dias || 'corrido'
  const prazo = Math.max(0, Number(state.config.prazo_dias) || 0)

  const weekIndex = Math.floor(index / vagas)
  const slotIndex = index % vagas

  const weekStart = startOfWeek(getBaseDate())
  weekStart.setDate(weekStart.getDate() + weekIndex * 7)

  const candidates = getWeekCandidates(weekStart, tipo)
  const fallbackDate = tipo === 'uteis' ? moveToNextWorkingDay(weekStart) : new Date(weekStart)

  let prodDate = fallbackDate
  if (candidates.length) {
    if (vagas <= 1) {
      prodDate = new Date(candidates[0])
    } else if (vagas <= candidates.length) {
      const mappedIndex = Math.round((slotIndex * (candidates.length - 1)) / (vagas - 1))
      prodDate = new Date(candidates[mappedIndex])
    } else {
      const mappedIndex = Math.min(candidates.length - 1, Math.floor((slotIndex * candidates.length) / vagas))
      prodDate = new Date(candidates[mappedIndex])
    }
  }

  const entDate = addScheduleDays(prodDate, prazo, tipo)

  return {
    prod: toISODate(prodDate),
    ent: toISODate(entDate)
  }
}

function getWeekWindow() {
  const inicio = startOfWeek(new Date())
  const fim = new Date(inicio)
  fim.setDate(fim.getDate() + 6)

  return {
    inicio,
    fim,
    iniISO: toISODate(inicio),
    fimISO: toISODate(fim)
  }
}

function isWithinWeek(dateStr, iniISO, fimISO) {
  return !!dateStr && dateStr >= iniISO && dateStr <= fimISO
}

function getUpcomingOrders(limit = 6) {
  const today = toISODate(new Date())

  return getAgendaRows()
    .filter(row => (row.ent_date || row.prod_date) >= today)
    .sort((a, b) =>
      String(a.ent_date || a.prod_date).localeCompare(String(b.ent_date || b.prod_date)) ||
      String(a.prod_date || '').localeCompare(String(b.prod_date || '')) ||
      a.id - b.id
    )
    .slice(0, limit)
}

function getNextAvailableSlot() {
  return findNextFreeSlot()
}

function getNextFreeSlot() {
  const ativos = getActiveOrders()
  const padrao = Math.max(1, Number(state.config.vagas_semana) || 1)
  const maxSearch = ativos.length + 52 * padrao
  for (let i = ativos.length; i < maxSearch; i++) {
    const slot = getSlotDatesByIndex(i)
    const weekKey = getSemanaKey(slot.ent)
    const vagasSemana = getVagasSemana(weekKey)
    const ordersInWeek = ativos.filter(o =>
      getSemanaKey(o.ent_date || o.prod_date) === weekKey
    ).length
    const bloqueios = getBloqueiosSemana(weekKey)
    if (ordersInWeek + bloqueios < vagasSemana) return slot
  }
  return getSlotDatesByIndex(ativos.length)
}

function getNextFreeSlots() {
  const vagas = Number(state.config.vagas_semana || 0)
  const prazo = Number(state.config.prazo_dias   || 0)
  if (!vagas || !prazo) return []

  const ativos    = getActiveOrders()
  const weekMap   = buildWeekMap()

  // Usa a mesma lógica do card de resumo: percorre semanas reais em ordem cronológica
  if (weekMap.size) {
    const sorted = Array.from(weekMap.keys()).sort()
    for (const weekKey of sorted) {
      const vagasSemana  = getVagasSemana(weekKey)
      const ordersInWeek = ativos.filter(o =>
        getSemanaKey(o.ent_date || o.prod_date) === weekKey
      ).length
      const bloqueios = getBloqueiosSemana(weekKey)
      if (ordersInWeek + bloqueios < vagasSemana) {
        const slotDates = weekMap.get(weekKey)
        const freeCount = vagasSemana - ordersInWeek - bloqueios
        return Array.from({ length: freeCount }, () => ({ prod: slotDates.prod, ent: slotDates.ent }))
      }
    }
    // Todas as semanas conhecidas estão cheias — avança pelas próximas até achar uma livre
    let lastKey = sorted[sorted.length - 1]
    for (let i = 0; i < 52; i++) {
      const nextSlot    = calcNextWeekSlot(lastKey)
      const nextWeekKey = getSemanaKey(nextSlot.ent)
      const nextBloq    = getBloqueiosSemana(nextWeekKey)
      const nextFree    = vagas - nextBloq
      if (nextFree > 0) {
        return Array.from({ length: nextFree }, () => ({ prod: nextSlot.prod, ent: nextSlot.ent }))
      }
      lastKey = nextWeekKey
    }
    return []
  }

  // Fallback: sem pedidos nem semanas manuais — usa cálculo por índice
  const slot      = getSlotDatesByIndex(ativos.length)
  const weekKey   = getSemanaKey(slot.ent)
  const vagasSem  = getVagasSemana(weekKey)
  const ordersWk  = ativos.filter(o => getSemanaKey(o.ent_date || o.prod_date) === weekKey).length
  const bloqWk    = getBloqueiosSemana(weekKey)
  const freeCount = vagasSem - ordersWk - bloqWk
  if (freeCount <= 0) {
    const nextSlot = calcNextWeekSlot(weekKey)
    return Array.from({ length: vagasSem }, () => ({ prod: nextSlot.prod, ent: nextSlot.ent }))
  }
  return Array.from({ length: freeCount }, () => ({ prod: slot.prod, ent: slot.ent }))
}

function buildWeekMap() {
  const ativos  = getActiveOrders()
  const manuais = getSemanaManuais()
  const map     = new Map()

  manuais.forEach(({ weekKey, entDate, prodDate }) => {
    if (!map.has(weekKey)) map.set(weekKey, { prod: prodDate, ent: entDate })
  })

  ativos.forEach(o => {
    const wk = getSemanaKey(o.ent_date || o.prod_date)
    if (wk && !map.has(wk)) map.set(wk, { prod: o.prod_date, ent: o.ent_date })
  })

  return map
}

function calcNextWeekSlot(weekStartISO) {
  const prazo = Math.max(0, Number(state.config.prazo_dias) || 0)
  const tipo  = state.config.tipo_dias || 'corrido'
  const next  = new Date(weekStartISO + 'T00:00:00')
  next.setDate(next.getDate() + 7)
  const prod  = tipo === 'uteis' ? moveToNextWorkingDay(next) : new Date(next)
  const ent   = addScheduleDays(prod, prazo, tipo)
  return { prod: toISODate(prod), ent: toISODate(ent) }
}

function findNextFreeSlot() {
  const vagas = Number(state.config.vagas_semana || 0)
  const prazo = Number(state.config.prazo_dias   || 0)
  if (!vagas || !prazo) return null

  const ativos  = getActiveOrders()
  const weekMap = buildWeekMap()
  if (!weekMap.size) return null

  const sorted = Array.from(weekMap.keys()).sort()
  for (const weekKey of sorted) {
    const vagasSemana  = getVagasSemana(weekKey)
    const ordersInWeek = ativos.filter(o =>
      getSemanaKey(o.ent_date || o.prod_date) === weekKey
    ).length
    const bloqueios = getBloqueiosSemana(weekKey)
    if (ordersInWeek + bloqueios < vagasSemana) return weekMap.get(weekKey)
  }

  // Todas as semanas conhecidas estão cheias — avança para a semana seguinte
  return calcNextWeekSlot(sorted[sorted.length - 1])
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

function abrirVagaExtra(weekStartISO) {
  const padrao = Math.max(1, Number(state.config.vagas_semana) || 1)
  const ajustes = getSemanaAjustes()
  // Garante base mínima de padrão (ignora dados antigos de bloqueio abaixo do padrão)
  const atual = Math.max(padrao, ajustes[weekStartISO] !== undefined ? ajustes[weekStartISO] : padrao)
  ajustes[weekStartISO] = atual + 1
  saveSemanaAjustes(ajustes)
}

async function loadConfig() {
  try {
    const c = await apiGet('/agenda/config')
    if (c) state.config = { ...state.config, ...c }
  } catch (e) {
    console.error('loadConfig', e)
  }

  if ($('prazo')) $('prazo').value = state.config.prazo_dias
  if ($('vagas')) $('vagas').value = state.config.vagas_semana
  if ($('tipoDias')) $('tipoDias').value = state.config.tipo_dias
  renderDiasUteisCheckboxes()
  const sel = $('cidadeSelecionada')
  if (sel && state.config.city_code) {
    const opt = sel.querySelector(`option[value="${state.config.city_code}"]`)
    if (opt) sel.value = state.config.city_code
  }
}

async function loadOrders() {
  const rows = await apiGet('/agenda/orders')
  state.orders = Array.isArray(rows) ? rows.map(normalizeOrder) : []
}

function calcularProducao(dataEntrega) {
    const prazo = Number(state.config.prazo_dias || 0)
    const tipo = state.config.tipo_dias || 'corrido'
    const base = new Date(dataEntrega + 'T00:00:00')
    if (tipo === 'uteis') {
      return toISODate(addBusinessDays(base, -prazo))
    }
    const d = new Date(base)
    d.setDate(d.getDate() - prazo)
    return toISODate(d)
  }

async function criarSemanaAutomatica(dataEntrega) {
    const prazo = Number(state.config.prazo_dias || 0)
    const tipo = state.config.tipo_dias || 'corrido'
    const vagas = Math.max(1, Number(state.config.vagas_semana) || 1)

    let prodDate = new Date(dataEntrega + 'T00:00:00')
    let diasSubtraidos = 0
    while (diasSubtraidos < prazo) {
      prodDate.setDate(prodDate.getDate() - 1)
      if (tipo === 'uteis') {
        const dia = prodDate.getDay()
        if (dia !== 0 && dia !== 6) diasSubtraidos++
      } else {
        diasSubtraidos++
      }
    }

    const baseProd = new Date(prodDate)

    for (let i = 0; i < vagas; i++) {
      let d = new Date(baseProd)
      if (tipo === 'uteis') {
        while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1)
      }
      const prodISO = toISODate(d)

      let ent = new Date(d)
      let added = 0
      while (added < prazo) {
        ent.setDate(ent.getDate() + 1)
        if (tipo === 'uteis') {
          const dia = ent.getDay()
          if (dia !== 0 && dia !== 6) added++
        } else {
          added++
        }
      }
      const entISO = toISODate(ent)

      await apiPost('/agenda/orders', {
        prod_date: prodISO,
        ent_date: entISO,
        cliente: '',
        descricao: 'Vaga disponível',
        qtd: 1,
        status: 'pendente'
      })
    }
  }

  async function salvarConfig() {
  return ui().runButtonAction('agendaConfigBtn', async () => {
    try {
      const updated = await apiPatch('/agenda/config', {
        prazo_dias: Number($('prazo')?.value || 0),
        vagas_semana: Number($('vagas')?.value || 0),
        tipo_dias: $('tipoDias')?.value || 'corrido'
      })

      state.config = { ...state.config, ...updated }

      if ($('dataSemana')?.value) {
        adicionarSemana()
      }

      notifyPainelRefresh('agenda-config')
      renderAll()
      notifySuccess('Configuração salva com sucesso.')

    } catch (e) {
      console.error(e)
      notifyError('Erro ao salvar configuração: ' + e.message)
    }
  }, { loadingText: 'Salvando...' })
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

  function limparFormulario() {
  if ($('cliente')) $('cliente').value = ''
  if ($('descricao')) $('descricao').value = ''
  if ($('qtd')) $('qtd').value = '1'
  if ($('valor')) $('valor').value = ''
}

async function novoPedido() {
  const vagas = Number(state.config.vagas_semana || 0)
  const prazo = Number(state.config.prazo_dias   || 0)

  if (!vagas || !prazo) {
    await ui().alert('Configure a agenda antes de registrar pedidos.', { title: 'Agenda não configurada' })
    return
  }

  const slot = findNextFreeSlot()
  if (!slot) {
    await ui().alert('Sem vagas disponíveis na agenda.', { title: 'Sem vagas' })
    return
  }

  const cliente = $('cliente')?.value.trim() || ''
  const descricao = $('descricao')?.value.trim() || ''
  const qtd = Math.max(1, Number($('qtd')?.value) || 1)
  const valor = Number($('valor')?.value) || 0

  if (!cliente || !descricao) {
    await ui().alert('Preencha cliente e descrição.', { title: 'Dados obrigatórios' })
    return
  }

  return ui().runButtonAction('agendaAddBtn', async () => {
    try {
      for (let i = 0; i < qtd; i++) {
        const s = findNextFreeSlot()
        if (!s) {
          notifyError('Sem vagas disponíveis para mais pedidos.')
          break
        }
        const row = await apiPost('/agenda/orders', {
          prod_date: s.prod,
          ent_date:  s.ent,
          cliente,
          descricao,
          valor,
          tecido: '',
          qtd: 1,
          tecido_comprado: false,
          status: 'pendente'
        })
        state.orders.push(normalizeOrder(row))
      }

      limparFormulario()
      notifyPainelRefresh('order-created')
      renderAll()
      notifySuccess('Pedido adicionado à agenda.')
    } catch (e) {
      console.error(e)
      notifyError('Erro ao registrar pedido: ' + e.message)
    }
  }, { loadingText: 'Registrando...' })
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

async function toggleTecido(id, current) {
  try {
    const row = await apiPatch('/agenda/orders/' + id, { tecido_comprado: !current })
    replaceOrder(row)
    renderAll()
  } catch (e) {
    console.error(e)
    notifyError('Erro ao atualizar tecido: ' + e.message)
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

async function excluirData(prodDate, entDate) {
  try {
    const row = await apiPost('/agenda/orders', {
      prod_date: prodDate,
      ent_date: entDate,
      cliente: 'Data excluída',
      descricao: 'Data removida manualmente da agenda',
      tecido: '-',
      qtd: 1,
      tecido_comprado: false,
      status: 'indisponivel'
    })

    state.orders.push(normalizeOrder(row))
    notifyPainelRefresh('slot-blocked')
    renderAll()
    closeActionSheet()
    notifySuccess('Data excluída da agenda.')
  } catch (e) {
    console.error(e)
    notifyError('Erro ao excluir a data: ' + e.message)
  }
}

async function recuperarData(id) {
  try {
    await apiDelete('/agenda/orders/' + id)
    state.orders = state.orders.filter(o => o.id !== id)
    notifyPainelRefresh('slot-restored')
    renderAll()
    notifySuccess('Data recuperada.')
  } catch (e) {
    console.error(e)
    notifyError('Erro ao recuperar a data: ' + e.message)
  }
}

async function recuperarPedido(id) {
  try {
    const current = state.orders.find(o => o.id === id) || {}
    const descricao = stripDeletedOrderMarker(current.descricao || '')
    const row = await apiPatch('/agenda/orders/' + id, {
      status: 'pendente',
      descricao: descricao || 'Pedido recuperado'
    })
    replaceOrder(row)
    notifyPainelRefresh('order-restored')
    renderAll()
    notifySuccess('Pedido recuperado.')
  } catch (e) {
    console.error(e)
    notifyError('Erro ao recuperar o pedido: ' + e.message)
  }
}

async function reprogramarEntrega(id) {
  try {
    const current = state.orders.find(o => o.id === id) || {}
    const entAtual = formatEditableDateInput(current.ent_date)
    const isAdiar = entDate => entDate > (current.ent_date || '')

    const novaEntInput = await ui().prompt({
      title: 'Reprogramar entrega',
      message: 'Informe a nova data de entrega. A data de produção será calculada automaticamente.',
      label: 'Nova data de entrega (DD/MM/AAAA)',
      value: entAtual,
      placeholder: 'Ex.: 14/04/2026',
      confirmText: 'Continuar'
    })
    if (novaEntInput === null) return false
    const novaEnt = normalizeEditableDateInput(novaEntInput)
    if (!novaEnt) {
      await ui().alert('Data de entrega inválida. Use o padrão DD/MM/AAAA.', { title: 'Data inválida' })
      return false
    }

    const weekKey = getSemanaKey(novaEnt)
    const vagasSemana = getVagasSemana(weekKey)
    const ordersInWeek = getActiveOrders().filter(o =>
      o.id !== id && getSemanaKey(o.ent_date || o.prod_date) === weekKey
    ).length
    const bloqueiosSemana = getBloqueiosSemana(weekKey)
    const semanaCheia = ordersInWeek + bloqueiosSemana >= vagasSemana

    if (semanaCheia) {
      if (isAdiar(novaEnt)) {
        await ui().alert(
          'Esta semana está cheia. Para adiar, escolha uma semana com vaga disponível.',
          { title: 'Semana cheia' }
        )
        return false
      }
      const confirmar = await ui().confirm(
        'Essa semana está cheia.\nDeseja abrir uma nova vaga para incluir este pedido?',
        { title: 'Semana cheia', confirmText: 'Abrir vaga', type: 'warning' }
      )
      if (!confirmar) return false
      abrirVagaExtra(weekKey)
    }

    const novaProd = calcProdDate(novaEnt)
    const row = await apiPatch('/agenda/orders/' + id, {
      prod_date: novaProd,
      ent_date: novaEnt
    })
    replaceOrder(row)
    notifyPainelRefresh('order-rescheduled')
    renderAll()
    await ui().alert(
      `Entrega reprogramada.\nProdução: ${formatFullDate(novaProd)}\nEntrega: ${formatFullDate(novaEnt)}`,
      { title: 'Datas atualizadas' }
    )
    return true
  } catch (e) {
    console.error(e)
    notifyError('Erro ao reprogramar a entrega: ' + e.message)
    return false
  }
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

function buildSheetButton({ label, hint, className, disabled, action }, targetDocument = document) {
  const btn = targetDocument.createElement('button')
  btn.type = 'button'
  btn.className = `sheet-action-btn ${className || ''}`.trim()
  btn.disabled = !!disabled

  if (targetDocument !== document) {
    btn.style.width = '100%'
    btn.style.display = 'block'
    btn.style.textAlign = 'left'
    btn.style.padding = '14px 16px'
    btn.style.border = 'none'
    btn.style.borderRadius = '12px'
    btn.style.cursor = disabled ? 'not-allowed' : 'pointer'
    btn.style.fontSize = '15px'
    btn.style.fontWeight = '700'
    btn.style.marginBottom = '10px'
    btn.style.boxSizing = 'border-box'
    btn.style.webkitTapHighlightColor = 'transparent'
    btn.style.touchAction = 'manipulation'
    if ((className || '').includes('is-danger')) {
      btn.style.background = '#ffe9ec'
      btn.style.color = '#ac3950'
    } else if ((className || '').includes('is-warning')) {
      btn.style.background = '#fff4dc'
      btn.style.color = '#765100'
    } else if ((className || '').includes('is-success')) {
      btn.style.background = '#eaf9f1'
      btn.style.color = '#1e7d59'
    } else {
      btn.style.background = '#eef3ff'
      btn.style.color = '#27457c'
    }
  }

  const title = targetDocument.createElement('strong')
  title.textContent = label
  title.style.display = 'block'
  btn.appendChild(title)

  if (hint) {
    const small = targetDocument.createElement('small')
    small.textContent = hint
    small.style.display = 'block'
    small.style.fontSize = '12px'
    small.style.fontWeight = '700'
    small.style.opacity = '.85'
    small.style.marginTop = '4px'
    btn.appendChild(small)
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
    if (context.row.status !== 'producao') {
      actions.appendChild(
        buildSheetButton({
          label: 'Marcar como em produção',
          hint: 'Atualiza o pedido para a etapa de produção.',
          action: async () => {
            await mudarStatus(context.row.id, 'producao')
            closeActionSheet()
          }
        }, targetDocument)
      )
    }

    if (context.row.status !== 'entregue') {
      actions.appendChild(
        buildSheetButton({
          label: 'Marcar como entregue',
          hint: 'Move o pedido para o histórico como entregue.',
          action: async () => {
            await mudarStatus(context.row.id, 'entregue')
            closeActionSheet()
          }
        }, targetDocument)
      )
    }

    actions.appendChild(
      buildSheetButton({
        label: 'Reprogramar entrega',
        hint: 'Permite ajustar as datas de produção e entrega do mesmo pedido.',
        className: 'is-success',
        action: async () => {
          const updated = await reprogramarEntrega(context.row.id)
          if (updated) closeActionSheet()
        }
      }, targetDocument)
    )

    const orderWeekKey = getSemanaKey(context.row.ent_date || context.row.prod_date)
    actions.appendChild(
      buildSheetButton({
        label: '➕ Abrir vaga extra',
        hint: 'Adiciona mais uma vaga nesta semana, além do padrão configurado.',
        className: 'is-success',
        action: () => {
          abrirVagaExtra(orderWeekKey)
          renderAll()
          closeActionSheet()
        }
      }, targetDocument)
    )

    actions.appendChild(
      buildSheetButton({
        label: 'Cancelar pedido',
        hint: 'Mantém o registro no histórico como cancelado.',
        className: 'is-warning',
        action: async () => {
          await mudarStatus(context.row.id, 'cancelado')
          closeActionSheet()
        }
      }, targetDocument)
    )

    actions.appendChild(
      buildSheetButton({
        label: 'Excluir pedido',
        hint: 'Remove definitivamente este pedido da agenda.',
        className: 'is-danger',
        action: async () => {
          const confirmed = await ui().confirm('Excluir este pedido definitivamente?', {
            title: 'Excluir pedido',
            confirmText: 'Excluir',
            type: 'danger'
          })
          if (confirmed) {
            await excluir(context.row.id)
            closeActionSheet()
          }
        }
      }, targetDocument)
    )
    return
  }

  if (context.kind === 'empty-slot') {
    const padrao  = Math.max(1, Number(state.config.vagas_semana) || 1)
    const weekKey = context.weekKey || getSemanaKey(context.ent_date || context.prod_date)
    const vagasAtuais = getVagasSemana(weekKey)

    if (context.isBlocked) {
      // Linha bloqueada: só mostra "Desbloquear"
      actions.appendChild(
        buildSheetButton({
          label: '🔓 Desbloquear vaga',
          hint: `Restaura 1 vaga nesta semana (${vagasAtuais}/${padrao}).`,
          action: () => { desbloquearVaga(weekKey); closeActionSheet() }
        }, targetDocument)
      )
    } else {
      // Linha disponível: "Reprogramar data" + "Bloquear"
      actions.appendChild(
        buildSheetButton({
          label: '📅 Reprogramar data',
          hint: 'Altera as datas de produção e entrega desta vaga.',
          action: () => reprogramarVaga(weekKey, context.ent_date, context.prod_date)
        }, targetDocument)
      )
      actions.appendChild(
        buildSheetButton({
          label: '🚫 Bloquear vaga',
          hint: `Reduz 1 vaga nesta semana.`,
          className: 'is-warning',
          action: () => { bloquearVaga(weekKey); closeActionSheet() }
        }, targetDocument)
      )
    }
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
      subtitle: `${payload.row.descricao || 'Sem descrição'} • produção em ${formatFullDate(payload.row.prod_date)}`
    })
    return
  }

  const weekKey = payload.weekKey || getSemanaKey(payload.ent_date || payload.prod_date)
  openActionSheet({
    kind: 'empty-slot',
    isBlocked: !!payload.isBlocked,
    title: payload.isBlocked ? 'Vaga bloqueada' : 'Vaga disponível',
    subtitle: `Entrega prevista: ${formatFullDate(payload.ent_date)}`,
    prod_date: payload.prod_date,
    ent_date: payload.ent_date,
    weekKey
  })
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

function renderAgendaTabela() {
  const tbody = $('agendaTabela')
  if (!tbody) return

  tbody.innerHTML = ''
  const ativos = getActiveOrders()
  const agendaRows = getAgendaRows()

  agendaRows.forEach(row => {
    const tr = document.createElement('tr')
    tr.className = 'status-' + row.status

    tr.innerHTML = `
      <td class="col-datas">
        <div class="cell-datas">
          <div class="dt-block dt-prod"><span class="lbl">Produção</span><span class="val">${formatShortDate(row.prod_date)}</span></div>
          <div class="dt-block dt-ent"><span class="lbl">Entrega</span><span class="val">${formatShortDate(row.ent_date)}</span></div>
        </div>
      </td>
      <td class="col-cli">
        <div class="cell-cli">
          <div class="nome">${row.cliente || '-'}</div>
          <div class="pedido">${row.descricao || '-'}</div>
        </div>
      </td>
      <td class="col-status"><button type="button" class="status-pill">${statusLabel(row)}</button></td>
    `

    const pillBtn = tr.querySelector('.status-pill')
    if (pillBtn) {
      pillBtn.addEventListener('click', () => menuPedido({ kind: 'order', row }))
    }

    tbody.appendChild(tr)
  })

  const padrao = Math.max(0, Number(state.config.vagas_semana) || 0)
  const prazo  = Math.max(0, Number(state.config.prazo_dias)   || 0)

  // Estado inicial: sem configuração
  if (!padrao && !prazo && ativos.length === 0) {
    const tr = document.createElement('tr')
    tr.innerHTML = `<td colspan="3" style="text-align:center;padding:40px 16px;color:var(--muted,#6b7280);font-size:14px;line-height:1.7">
      <strong style="display:block;font-size:15px;color:#374151;margin-bottom:4px">Agenda não configurada</strong>
      Defina prazo e vagas para começar
    </td>`
    tbody.appendChild(tr)
    return
  }

  // Helper: renderiza uma linha de slot extra (disponível ou bloqueado)
  function renderExtraSlot(entDate, prodDate, weekKey, isBloqueado) {
    const tr = document.createElement('tr')
    tr.className = isBloqueado ? 'slot-blocked' : 'slot-empty'
    tr.innerHTML = `
      <td class="col-datas">
        <div class="cell-datas">
          <div class="dt-block dt-prod"><span class="lbl">Produção</span><span class="val">${formatShortDate(prodDate)}</span></div>
          <div class="dt-block dt-ent"><span class="lbl">Entrega</span><span class="val">${formatShortDate(entDate)}</span></div>
        </div>
      </td>
      <td class="col-cli"><div class="cell-cli"><div class="nome">—</div><div class="pedido">${isBloqueado ? 'Vaga bloqueada' : 'Vaga disponível'}</div></div></td>
      <td class="col-status"><button type="button" class="status-pill${isBloqueado ? ' pill-blocked' : ''}">${isBloqueado ? 'Bloqueado' : 'Disponível'}</button></td>
    `
    const pillBtn = tr.querySelector('.status-pill')
    if (pillBtn) {
      pillBtn.addEventListener('click', () => menuPedido({ kind: 'empty-slot', isBlocked: isBloqueado, prod_date: prodDate, ent_date: entDate, weekKey }))
    }
    tbody.appendChild(tr)
  }

  // Para cada semana com pedidos, mostra também vagas disponíveis e bloqueadas restantes
  const coveredWeeks = new Set()
  ativos.forEach(o => coveredWeeks.add(getSemanaKey(o.ent_date || o.prod_date)))

  const weekDates = new Map() // weekKey -> { ent, prod }
  agendaRows.forEach(row => {
    const wk = getSemanaKey(row.ent_date || row.prod_date)
    if (wk && !weekDates.has(wk)) weekDates.set(wk, { ent: row.ent_date, prod: row.prod_date })
  })

  let hasExtraSlots   = false
  let totalDisponiveis = 0

  weekDates.forEach((dates, weekKey) => {
    const vagasSemana  = getVagasSemana(weekKey)
    const ordersInWeek = ativos.filter(o => getSemanaKey(o.ent_date || o.prod_date) === weekKey).length
    const bloqueadas   = getBloqueiosSemana(weekKey)
    const disponiveis  = Math.max(0, vagasSemana - ordersInWeek - bloqueadas)

    totalDisponiveis += disponiveis

    for (let i = 0; i < disponiveis; i++) {
      renderExtraSlot(dates.ent, dates.prod, weekKey, false)
      hasExtraSlots = true
    }
    for (let i = 0; i < bloqueadas; i++) {
      renderExtraSlot(dates.ent, dates.prod, weekKey, true)
      hasExtraSlots = true
    }
  })

  // Semanas manuais sem pedidos: mostra vagas disponíveis e bloqueadas
  getSemanaManuais().forEach(({ weekKey, entDate, prodDate }) => {
    if (coveredWeeks.has(weekKey)) return
    const vagasSemana   = getVagasSemana(weekKey)
    const bloqueadasSem = getBloqueiosSemana(weekKey)
    const disponivelSem = Math.max(0, vagasSemana - bloqueadasSem)

    totalDisponiveis += disponivelSem

    for (let s = 0; s < disponivelSem; s++) {
      renderExtraSlot(entDate, prodDate, weekKey, false)
      hasExtraSlots = true
    }
    for (let s = 0; s < bloqueadasSem; s++) {
      renderExtraSlot(entDate, prodDate, weekKey, true)
      hasExtraSlots = true
    }
  })

  // Exibe próxima semana livre SOMENTE quando não há vagas disponíveis visíveis
  // (semana cheia por pedidos + bloqueios, ou agenda ainda sem nenhuma linha)
  if (totalDisponiveis === 0 && padrao && prazo) {
    const freeSlots = getNextFreeSlots()
    freeSlots.forEach(slot => {
      const weekKey = getSemanaKey(slot.ent)
      renderExtraSlot(slot.ent, slot.prod, weekKey, false)
    })
  }

  // Se configurado mas nenhuma linha ainda (nenhum pedido, nenhuma semana manual)
  if (!tbody.querySelector('tr')) {
    const tr = document.createElement('tr')
    tr.innerHTML = `<td colspan="3" style="text-align:center;padding:32px 16px;color:var(--muted,#6b7280);font-size:14px">
      Nenhum pedido na agenda. Use <strong>+ Adicionar semana</strong> para abrir vagas ou registre um pedido.
    </td>`
    tbody.appendChild(tr)
  }
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

function renderSemana() {
  const tbody = $('pedidosSemana')
  if (!tbody) return

  tbody.innerHTML = ''

  const { iniISO, fimISO } = getWeekWindow()
  const ativos = getAgendaRows()

  const semana = ativos
    .filter(row => isWithinWeek(row.ent_date, iniISO, fimISO))
    .sort((a, b) =>
      String(a.ent_date || '').localeCompare(String(b.ent_date || '')) ||
      a.id - b.id
    )

  if (!semana.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="3">Nenhuma entrega nesta semana</td>
      </tr>
    `
    return
  }

  semana.forEach(row => {
    const tr = document.createElement('tr')
    tr.innerHTML = `
      <td>${formatShortDate(row.ent_date)}</td>
      <td>${row.cliente || '-'}</td>
      <td>${row.descricao || '-'}</td>
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

function renderSummary() {
    const ativos = getActiveOrders()
    const configurado =
      Number(state.config.vagas_semana) > 0 &&
      Number(state.config.prazo_dias) > 0

    const barra = $('barra')
    const barraTexto = $('barraTexto')
    const nextEntEl = $('nextEnt')
    const resumoDataEl = $('resumoData')

    if (!configurado) {
      if (barra) barra.style.width = '0%'
      if (barraTexto) barraTexto.innerText = '-'
      if (nextEntEl) nextEntEl.innerText = '-'
      if (resumoDataEl) resumoDataEl.innerText = formatWeekRange()
      return
    }

    const vagas = Number(state.config.vagas_semana)
    const nextSlots = getNextFreeSlots()
    const vagasLivres = nextSlots.length
    const percent = vagasLivres === 0 ? 100 : Math.min(100, Math.round(((vagas - vagasLivres) / vagas) * 100))
    if (barra) barra.style.width = percent + '%'
    if (barraTexto) barraTexto.innerText = `${vagasLivres} vagas`

    const next = nextSlots[0] || null
    if (nextEntEl) nextEntEl.innerText = next ? formatShortDate(next.ent) : '-'
    if (resumoDataEl) resumoDataEl.innerText = formatWeekRange()
    try { localStorage.setItem('esd_proxima_vaga', next ? next.ent : '') } catch (_) {}
  }

function renderAll() {
  renderSummary()
  renderSemana()
  renderAgendaTabela()
  renderHistoricoTabela()
  renderHolidayTable()
  renderManualHolidayTable()
  scheduleRenderSync()
}

async function load() {
  await Promise.all([loadConfig(), loadOrders()])
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

  load().catch(err => {
    console.error(err)
    notifyError('Não consegui carregar a agenda.')
  })
}

const ESTADOS_CIDADES = {
  'AL': { nome: 'Alagoas',           cidades: [{ code: 'AL-MACEIO',          label: 'Maceió' }] },
  'AM': { nome: 'Amazonas',          cidades: [{ code: 'AM-MANAUS',           label: 'Manaus' }] },
  'BA': { nome: 'Bahia',             cidades: [{ code: 'BA-SALVADOR',         label: 'Salvador' }, { code: 'BA-FEIRA_SANTANA', label: 'Feira de Santana' }] },
  'CE': { nome: 'Ceará',             cidades: [{ code: 'CE-FORTALEZA',        label: 'Fortaleza' }] },
  'DF': { nome: 'Distrito Federal',  cidades: [{ code: 'DF-BRASILIA',         label: 'Brasília' }] },
  'ES': { nome: 'Espírito Santo',    cidades: [{ code: 'ES-VITORIA',          label: 'Vitória' }] },
  'GO': { nome: 'Goiás',             cidades: [{ code: 'GO-GOIANIA',          label: 'Goiânia' }] },
  'MA': { nome: 'Maranhão',          cidades: [{ code: 'MA-SAO_LUIS',         label: 'São Luís' }] },
  'MG': { nome: 'Minas Gerais',      cidades: [{ code: 'MG-BELO_HORIZONTE',   label: 'Belo Horizonte' }, { code: 'MG-CONTAGEM', label: 'Contagem' }, { code: 'MG-UBERLANDIA', label: 'Uberlândia' }, { code: 'MG-JUIZ_DE_FORA', label: 'Juiz de Fora' }] },
  'MS': { nome: 'Mato Grosso do Sul',cidades: [{ code: 'MS-CAMPO_GRANDE',     label: 'Campo Grande' }] },
  'PA': { nome: 'Pará',              cidades: [{ code: 'PA-BELEM',            label: 'Belém' }] },
  'PE': { nome: 'Pernambuco',        cidades: [{ code: 'PE-RECIFE',           label: 'Recife' }, { code: 'PE-CARUARU', label: 'Caruaru' }] },
  'PI': { nome: 'Piauí',             cidades: [{ code: 'PI-TERESINA',         label: 'Teresina' }] },
  'PR': { nome: 'Paraná',            cidades: [{ code: 'PR-CURITIBA',         label: 'Curitiba' }, { code: 'PR-LONDRINA', label: 'Londrina' }] },
  'RJ': { nome: 'Rio de Janeiro',    cidades: [{ code: 'RJ-RIO_DE_JANEIRO',   label: 'Rio de Janeiro' }, { code: 'RJ-NITEROI', label: 'Niterói' }, { code: 'RJ-DUQUE_CAXIAS', label: 'Duque de Caxias' }, { code: 'RJ-NOVA_IGUACU', label: 'Nova Iguaçu' }] },
  'RN': { nome: 'Rio Grande do Norte',cidades:[{ code: 'RN-NATAL',            label: 'Natal' }] },
  'RS': { nome: 'Rio Grande do Sul', cidades: [{ code: 'RS-PORTO_ALEGRE',     label: 'Porto Alegre' }, { code: 'RS-CAXIAS_DO_SUL', label: 'Caxias do Sul' }] },
  'SC': { nome: 'Santa Catarina',    cidades: [{ code: 'SC-FLORIANOPOLIS',    label: 'Florianópolis' }, { code: 'SC-JOINVILLE', label: 'Joinville' }] },
  'SP': { nome: 'São Paulo',         cidades: [{ code: 'SP-SAO_PAULO',        label: 'São Paulo' }, { code: 'SP-CAMPINAS', label: 'Campinas' }, { code: 'SP-SANTOS', label: 'Santos' }, { code: 'SP-SAO_BERNARDO', label: 'São Bernardo do Campo' }, { code: 'SP-RIBEIRAO_PRETO', label: 'Ribeirão Preto' }, { code: 'SP-SOROCABA', label: 'Sorocaba' }, { code: 'SP-OSASCO', label: 'Osasco' }, { code: 'SP-GUARULHOS', label: 'Guarulhos' }, { code: 'SP-JUNDIAI', label: 'Jundiaí' }, { code: 'SP-BAURU', label: 'Bauru' }] }
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

window.salvarConfig = salvarConfig
window.novoPedido = novoPedido
window.mudarStatus = mudarStatus
window.toggleTecido = toggleTecido
window.menuPedido = menuPedido
window.closeActionSheet = closeActionSheet
window.excluir = excluir
window.recuperarData = recuperarData
window.recuperarPedido = recuperarPedido
window.reprogramarEntrega = reprogramarEntrega
window.addManualHoliday = addManualHoliday
window.deleteManualHoliday = deleteManualHoliday
window.updateCidadesSelect = updateCidadesSelect
window.handleCityChange = handleCityChange
window.bloquearVaga = bloquearVaga
window.desbloquearVaga = desbloquearVaga
window.reprogramarVaga = reprogramarVaga
window.toggleDiaUtil = toggleDiaUtil
window.renderDiasUteisCheckboxes = renderDiasUteisCheckboxes
window.adicionarSemana = adicionarSemana
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
  const m = document.getElementById('agendaFullscreen')
  if (!m) return
  m.hidden = false
  document.body.style.overflow = 'hidden'
  applyShellFullscreen(true)
  if (typeof renderAgendaTabela === 'function') { try { renderAgendaTabela() } catch (_) {} }
  requestAnimationFrame(function(){
    m.scrollTop = 0
    var wrap = m.querySelector('.fs-table-wrap')
    if(wrap) wrap.scrollTop = 0
  })
}
function closeAgendaFullscreen() {
  const m = document.getElementById('agendaFullscreen')
  if (!m) return
  m.hidden = true
  document.body.style.overflow = ''
  applyShellFullscreen(false)
}
function openPedidoFullscreen() {
  const m = document.getElementById('pedidoFullscreen')
  if (!m) return
  m.hidden = false
  document.body.style.overflow = 'hidden'
  applyShellFullscreen(true)
  requestAnimationFrame(function(){ m.scrollTop = 0 })
}
function closePedidoFullscreen() {
  const m = document.getElementById('pedidoFullscreen')
  if (!m) return
  m.hidden = true
  document.body.style.overflow = ''
  applyShellFullscreen(false)
}
window.openAgendaFullscreen = openAgendaFullscreen
window.closeAgendaFullscreen = closeAgendaFullscreen
window.openPedidoFullscreen = openPedidoFullscreen
window.closePedidoFullscreen = closePedidoFullscreen

// Update teaser counts on dashboard cards + modal header badges
function updateAgendaCardTeaser() {
  try {
    const ativos = (typeof getActiveOrders === 'function') ? getActiveOrders() : []
    const total = ativos.length || 0
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
function openConfigFullscreen(){ _openModal('configFullscreen'); }
function closeConfigFullscreen(){ _closeModal('configFullscreen'); }

/* ===== Feriados fullscreen ===== */
function openFeriadosFullscreen(){ _openModal('feriadosFullscreen'); }
function closeFeriadosFullscreen(){ _closeModal('feriadosFullscreen'); }

/* ===== Histórico fullscreen ===== */
function openHistoricoFullscreen(){ _openModal('historicoFullscreen'); }
function closeHistoricoFullscreen(){ _closeModal('historicoFullscreen'); }
