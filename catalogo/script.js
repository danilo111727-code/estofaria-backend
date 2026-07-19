const API = (window.API_BASE || '') + '/api'

const _imgCache = new Map()

async function getImageBase64(modelo) {
  if (!modelo) return null
  const dataUrl =
    modelo.image_data_url || modelo.imageDataUrl ||
    modelo.foto_data_url  || modelo.fotoDataUrl  ||
    (modelo.raw && (modelo.raw.image_data_url || modelo.raw.imageDataUrl ||
                    modelo.raw.foto_data_url  || modelo.raw.fotoDataUrl))
  if (dataUrl && typeof dataUrl === 'string' && dataUrl.startsWith('data:image')) return dataUrl
  const k = `img:${modelo.id}`
  if (_imgCache.has(k)) return _imgCache.get(k)
  try {
    const res = await fetch(`${window.API_BASE || ''}/api/models/${modelo.id}`)
    if (!res.ok) return null
    const d = await res.json()
    const u = d?.image_data_url || d?.imageDataUrl || d?.foto_data_url || d?.fotoDataUrl
    if (u && typeof u === 'string' && u.startsWith('data:image')) { _imgCache.set(k, u); return u }
  } catch (_) {}
  return null
}

function calcularPrecoPorEspacamento({ metragem, baseMeters, basePriceCents, espacamentoCm, valorPorEspacamentoCents }) {
  if (!Number.isFinite(metragem) || !Number.isFinite(baseMeters) || !Number.isFinite(basePriceCents)) return 0
  const baseM = baseMeters > 10 ? baseMeters / 100 : baseMeters
  const espacamentoM = (espacamentoCm || 10) / 100
  const diferenca = metragem - baseM
  const ratio = Math.round((diferenca / espacamentoM) * 1e4) / 1e4
  const degraus = Math.ceil(ratio)
  return basePriceCents + degraus * (valorPorEspacamentoCents || 0)
}

let editavel = false
let modelos = []
let overrides = new Map()
let liveCatalogTimer = null
let lastCatalogSnapshot = ''

const ESPACAMENTO_PADRAO_CM = 10
const METRAGEM_INICIAL = 1
const METRAGEM_FINAL = 5
const STORAGE_PREFS = 'catalogo_pref_v2'
const STORAGE_OVERRIDES = 'catalogo_overrides_v2'
const STORAGE_SHARED_MODELS = 'precificacao_modelos'
const STORAGE_CATALOGO_MODELS = 'catalogo_modelos'
const STORAGE_ACTIVE_MODEL = 'estofaria_modelo_ativo_v1'

function el(id) {
  return document.getElementById(id)
}

function pick(...values) {
  for (const v of values) {
    if (v !== undefined && v !== null && v !== '') return v
  }
  return undefined
}

function parseNumber(value, fallback = 0) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallback
  if (value === null || value === undefined) return fallback

  let s = String(value).trim()
  if (!s) return fallback

  s = s.replace(/R\$/gi, '').replace(/\s+/g, '')

  const hasComma = s.includes(',')
  const hasDot = s.includes('.')

  if (hasComma && hasDot) {
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) {
      s = s.replace(/\./g, '').replace(',', '.')
    } else {
      s = s.replace(/,/g, '')
    }
  } else if (hasComma) {
    s = s.replace(',', '.')
  }

  s = s.replace(/[^\d.-]/g, '')

  const n = Number(s)
  return Number.isFinite(n) ? n : fallback
}

function toCentsFromCents(...values) {
  const raw = pick(...values)
  if (raw === undefined) return 0
  return Math.round(parseNumber(raw, 0))
}

function toCentsFromReais(...values) {
  const raw = pick(...values)
  if (raw === undefined) return 0
  return Math.round(parseNumber(raw, 0) * 100)
}

function moedaFromCents(cents) {
  return (Number(cents || 0) / 100).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  })
}

function formatPercent(v) {
  return `${parseNumber(v, 0).toFixed(1).replace('.', ',')}%`
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function safeFileName(value) {
  return String(value || 'catalogo')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9-_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase() || 'catalogo'
}

function getPreviewHost() {
  try {
    if (window.parent && window.parent !== window && window.parent.document && window.parent.document.body) {
      return { win: window.parent, doc: window.parent.document }
    }
  } catch (_) {}
  return { win: window, doc: document }
}

function getPdfPreviewMetrics(targetWindow = window, targetDocument = document) {
  const viewport = targetWindow.visualViewport || {}
  const viewportWidth = Math.max(320, Math.round(viewport.width || targetWindow.innerWidth || targetDocument.documentElement.clientWidth || 1024))
  const viewportHeight = Math.max(520, Math.round(viewport.height || targetWindow.innerHeight || targetDocument.documentElement.clientHeight || 768))
  const outerPadding = viewportWidth <= 640 ? 8 : 16
  const headerHeight = viewportWidth <= 640 ? 60 : 64
  const gap = 10
  const shellWidth = Math.max(280, Math.min(980, viewportWidth - outerPadding * 2))
  const availableWidth = Math.max(240, shellWidth)
  const availableHeight = Math.max(320, viewportHeight - (outerPadding * 2) - headerHeight - gap)
  const cardWidth = availableWidth
  const cardHeight = availableHeight
  return { outerPadding, headerHeight, gap, shellWidth, cardWidth, cardHeight }
}

function openPdfPreview(pdfBlob, fileName, title) {
  const host = getPreviewHost()
  const hostWindow = host.win
  const hostDocument = host.doc
  const urlApi = hostWindow.URL || URL
  const oldOverlay = hostDocument.getElementById('catalogoPdfOverlay')
  if (oldOverlay) {
    try { urlApi.revokeObjectURL(oldOverlay.dataset.pdfUrl || '') } catch (_) {}
    oldOverlay.remove()
  }

  const metrics = getPdfPreviewMetrics(hostWindow, hostDocument)
  const pdfUrl = urlApi.createObjectURL(pdfBlob)
  const overlay = hostDocument.createElement('div')
  overlay.id = 'catalogoPdfOverlay'
  overlay.dataset.pdfUrl = pdfUrl
  overlay.style.position = 'fixed'
  overlay.style.inset = '0'
  overlay.style.zIndex = '999999'
  overlay.style.background = '#0f172a'
  overlay.style.display = 'flex'
  overlay.style.alignItems = 'flex-start'
  overlay.style.justifyContent = 'center'
  overlay.style.padding = `${metrics.outerPadding}px`
  overlay.style.boxSizing = 'border-box'
  overlay.style.overflowX = 'hidden'
  overlay.style.overflowY = 'auto'
  overlay.style.overscrollBehavior = 'contain'
  overlay.style.webkitOverflowScrolling = 'touch'

  const safeTitle = escapeHtml(title || fileName || 'PDF')
  const safeFileName = escapeHtml(fileName || 'documento.pdf')
  overlay.innerHTML = `
    <div data-preview-shell style="width:${metrics.shellWidth}px;max-width:100%;display:grid;grid-template-rows:auto 1fr;gap:${metrics.gap}px;align-content:start;box-sizing:border-box;">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 12px;background:#1e293b;color:#e2e8f0;border-radius:16px;min-height:${metrics.headerHeight}px;box-sizing:border-box;">
        <div style="min-width:0;">
          <div style="font-size:14px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${safeTitle}</div>
          <div style="font-size:12px;opacity:.78;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">Visualização do arquivo ${safeFileName}</div>
        </div>
        <button id="catalogoPdfCloseBtn" type="button" style="border:0;border-radius:999px;padding:10px 14px;background:#4a67a1;color:#fff;font:inherit;font-weight:700;cursor:pointer;flex:0 0 auto;">Fechar</button>
      </div>
      <div style="min-height:0;display:flex;align-items:stretch;justify-content:center;overflow:hidden;">
        <div data-preview-card style="width:${metrics.cardWidth}px;height:${metrics.cardHeight}px;max-width:100%;background:#ffffff;border-radius:16px;box-shadow:0 10px 40px rgba(0,0,0,.35);overflow:hidden;display:block;">
          <iframe id="catalogoPdfFrame" title="${safeTitle}" scrolling="auto" style="display:block;width:100%;height:100%;border:0;background:#ffffff;overflow:auto;-webkit-overflow-scrolling:touch;"></iframe>
        </div>
      </div>
    </div>
  `

  const previousBodyOverflow = hostDocument.body.style.overflow
  const previousHtmlOverflow = hostDocument.documentElement.style.overflow
  hostDocument.body.style.overflow = 'hidden'
  hostDocument.documentElement.style.overflow = 'hidden'
  hostDocument.body.appendChild(overlay)
  overlay.scrollTop = 0

  const shell = overlay.querySelector('[data-preview-shell]')
  const previewCard = overlay.querySelector('[data-preview-card]')
  const syncLayout = () => {
    const next = getPdfPreviewMetrics(hostWindow, hostDocument)
    overlay.style.padding = `${next.outerPadding}px`
    if (shell) shell.style.width = `${next.shellWidth}px`
    if (previewCard) {
      previewCard.style.width = `${next.cardWidth}px`
      previewCard.style.height = `${next.cardHeight}px`
    }
  }

  const closePreview = () => {
    hostWindow.removeEventListener('resize', syncLayout)
    if (hostWindow.visualViewport) hostWindow.visualViewport.removeEventListener('resize', syncLayout)
    hostDocument.body.style.overflow = previousBodyOverflow
    hostDocument.documentElement.style.overflow = previousHtmlOverflow
    try { urlApi.revokeObjectURL(pdfUrl) } catch (_) {}
    overlay.remove()
  }

  overlay.addEventListener('click', event => {
    if (event.target === overlay) closePreview()
  })

  const closeBtn = overlay.querySelector('#catalogoPdfCloseBtn')
  if (closeBtn) closeBtn.addEventListener('click', closePreview)

  const frame = overlay.querySelector('#catalogoPdfFrame')
  if (frame) frame.src = pdfUrl + '#toolbar=0&navpanes=0&scrollbar=1&page=1&view=FitH&zoom=page-width'

  hostWindow.addEventListener('resize', syncLayout)
  if (hostWindow.visualViewport) hostWindow.visualViewport.addEventListener('resize', syncLayout)
  setTimeout(syncLayout, 60)

  return { ok: true, mode: 'overlay-preview' }
}

function getSpacingCm(model) {
  const raw = pick(
    model?.spacingCm,
    model?.spacing_cm,
    model?.espacamentoCm,
    model?.espacamento_cm,
    model?.spacing,
    model?.espacamento,
    ESPACAMENTO_PADRAO_CM
  )

  const n = Math.max(1, parseNumber(raw, ESPACAMENTO_PADRAO_CM))
  return n || ESPACAMENTO_PADRAO_CM
}

function normalizeMeterValue(value, fallback = 0) {
  const n = parseNumber(value, fallback)
  return n > 0 ? Number(n.toFixed(2)) : fallback
}

function collectMeterValues(value, bucket = []) {
  if (value === null || value === undefined || value === '') return bucket

  if (Array.isArray(value)) {
    value.forEach(entry => collectMeterValues(entry, bucket))
    return bucket
  }

  if (typeof value === 'object') {
    if (typeof value.metragem !== 'undefined') collectMeterValues(value.metragem, bucket)
    if (typeof value.meters !== 'undefined') collectMeterValues(value.meters, bucket)
    if (typeof value.valor !== 'undefined' && typeof value.metragem === 'undefined' && typeof value.meters === 'undefined') {
      Object.keys(value).forEach(key => collectMeterValues(key, bucket))
    } else {
      Object.keys(value).forEach(key => collectMeterValues(key, bucket))
    }
    return bucket
  }

  const text = String(value).trim()
  if (!text) return bucket

  const matches = text.match(/\d+(?:[.,]\d+)?/g)
  const values = (matches && matches.length ? matches : [text])
  values.forEach(part => {
    const n = normalizeMeterValue(part, 0)
    if (n > 0) bucket.push(n)
  })
  return bucket
}

function buildMetragens(spacingCm, startMeters = METRAGEM_INICIAL, endMeters = METRAGEM_FINAL) {
  const step = Math.max(0.01, parseNumber(spacingCm, ESPACAMENTO_PADRAO_CM) / 100)
  const start = Math.max(0.01, normalizeMeterValue(startMeters, METRAGEM_INICIAL))
  const end = Math.max(start, normalizeMeterValue(endMeters, METRAGEM_FINAL))
  const result = []
  let current = start

  while (current < end + 0.0001) {
    result.push(Number(current.toFixed(2)))
    current += step
  }

  const last = result[result.length - 1]
  if (!last || Math.abs(last - end) > 0.0001) {
    result.push(end)
  }

  return [...new Set(result.map(v => Number(v.toFixed(2))))].sort((a, b) => a - b)
}

function getOfficialMetragens(modelo) {
  const raw = modelo?.raw || {}
  const start = METRAGEM_INICIAL
  const end = METRAGEM_FINAL
  const fallback = buildMetragens(modelo?.spacingCm, start, end)
  const explicit = [
    raw.metragens,
    raw.meters,
    raw.measurements,
    raw.measurement_list,
    raw.measurementList,
    raw.tabela_metragens,
    raw.tabelaMetragens,
    raw.table_meters,
    raw.tableMeters,
    raw.valores_por_metragem,
    raw.valoresPorMetragem,
    raw.values_by_meter,
    raw.valuesByMeter
  ]

  for (const source of explicit) {
    const values = collectMeterValues(source, [])
      .map(value => Number(value.toFixed(2)))
      .filter(value => value >= start && value > 0)

    if (values.length) {
      const normalized = [...new Set(values)].sort((a, b) => a - b)
      const last = normalized[normalized.length - 1] || 0
      if (last < end) {
        normalized.push(end)
      }
      return [...new Set(normalized)].sort((a, b) => a - b)
    }
  }

  return fallback
}

async function apiGet(path) {
  return window.ESTOFARIA_HTTP.fetchJson(`${API}${path}`, {
    headers: { 'Accept': 'application/json' },
    cache: 'no-store'
  })
}

function saveSharedModels(lista) {
  const normalized = (Array.isArray(lista) ? lista : [])
    .map((model, index) => normalizeModel(model, index))
    .filter(model => model.name)
    .map(model => ({
      id: model.id,
      name: model.name,
      base_meters: model.baseMeters,
      spacing_cm: model.spacingCm,
      total_cost_cents: model.totalCostCents,
      target_profit_cents: model.targetProfitCents,
      sale_price_cents: model.salePriceCents
    }))

  try {
    localStorage.setItem(STORAGE_SHARED_MODELS, JSON.stringify(normalized))
  } catch {}

  try {
    localStorage.setItem(STORAGE_CATALOGO_MODELS, JSON.stringify(normalized))
  } catch {}
}

function normalizeModel(model, index = 0) {
  const baseMetersRaw = Math.max(0.01, parseNumber(
    pick(
      model.base_meters,
      model.baseMeters,
      model.base_measure,
      model.baseMeasure,
      model.base_medida,
      model.baseMedida,
      1
    ),
    1
  ))
  const baseMeters = baseMetersRaw > 10 ? baseMetersRaw / 100 : baseMetersRaw

  let salePriceCents =
    toCentsFromCents(
      model.sale_price_cents,
      model.salePriceCents,
      model.valor_venda_cents,
      model.valorVendaCents,
      model.price_cents
    ) ||
    toCentsFromReais(
      model.sale_price,
      model.salePrice,
      model.valor_venda,
      model.valorVenda,
      model.preco_venda,
      model.precoVenda,
      model.price
    )

  if (!salePriceCents) {
    const valorMetro = pick(
      model.valorMetro,
      model.valor_metro,
      model.sale_price_per_meter,
      model.salePricePerMeter
    )
    if (valorMetro !== undefined) {
      salePriceCents = Math.round(parseNumber(valorMetro, 0) * 100 * baseMeters)
    }
  }

  const totalCostCents =
    toCentsFromCents(
      model.total_cost_cents,
      model.totalCostCents,
      model.custo_total_cents,
      model.custoTotalCents,
      model.cost_cents
    ) ||
    toCentsFromReais(
      model.total_cost,
      model.totalCost,
      model.custo_total,
      model.custoTotal,
      model.cost
    )

  const targetProfitCents =
    toCentsFromCents(
      model.target_profit_cents,
      model.targetProfitCents,
      model.lucro_desejado_cents,
      model.lucroDesejadoCents,
      model.profit_cents
    ) ||
    toCentsFromReais(
      model.target_profit,
      model.targetProfit,
      model.lucro_desejado,
      model.lucroDesejado,
      model.profit
    )

  const valorPorEspacamentoCents =
    toCentsFromCents(
      model.valor_por_espacamento_cents,
      model.valorPorEspacamentoCents,
      model.spacing_value_cents,
      model.spacingValueCents
    ) ||
    toCentsFromReais(
      model.valor_por_espacamento,
      model.valorPorEspacamento,
      model.spacing_value,
      model.spacingValue
    )

  return {
    id: pick(model.id, model._id, `modelo-${index + 1}`),
    name: String(pick(model.name, model.nome, `Modelo ${index + 1}`)),
    baseMeters,
    spacingCm: getSpacingCm(model),
    salePriceCents: Math.max(0, salePriceCents),
    totalCostCents: Math.max(0, totalCostCents),
    targetProfitCents: Math.max(0, targetProfitCents),
    valorPorEspacamentoCents: Math.max(0, valorPorEspacamentoCents),
    descricaoModelo: String(pick(model.descricao_modelo, model.descricaoModelo, model.descricao, '') || '').trim(),
    raw: model
  }
}

function readModelStorage(key) {
  try {
    const raw = JSON.parse(localStorage.getItem(key) || '[]')
    const arr = Array.isArray(raw) ? raw : (Array.isArray(raw?.models) ? raw.models : [])
    return arr.map((m, i) => normalizeModel(m, i)).filter(m => m.name)
  } catch {
    return []
  }
}

function loadLocalFallback() {
  const seen = new Set()
  return [
    ...readModelStorage(STORAGE_SHARED_MODELS),
    ...readModelStorage(STORAGE_CATALOGO_MODELS)
  ].filter(model => {
    const key = `${String(model.id)}::${String(model.name).toLowerCase()}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function loadPrefs() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_PREFS) || '{}')
    return raw && typeof raw === 'object' ? raw : {}
  } catch {
    return {}
  }
}

function saveActiveModel(model) {
  try {
    if (!model) {
      localStorage.removeItem(STORAGE_ACTIVE_MODEL)
      return
    }
    localStorage.setItem(STORAGE_ACTIVE_MODEL, JSON.stringify({
      id: String(model.id),
      name: model.name,
      source: 'catalogo',
      savedAt: Date.now()
    }))
  } catch {}
}

function savePrefs() {
  const payload = {
    modelo: el('modelo')?.value || '',
    taxa: el('taxa')?.value || '1.05',
    notaFiscal: el('notaFiscal')?.value || '0.01'
  }
  localStorage.setItem(STORAGE_PREFS, JSON.stringify(payload))
  saveActiveModel(getModeloAtual())
}

function applySavedPrefs() {
  const prefs = loadPrefs()
  const taxa = el('taxa')
  const notaFiscal = el('notaFiscal')

  if (taxa && prefs.taxa && [...taxa.options].some(opt => opt.value === prefs.taxa)) {
    taxa.value = prefs.taxa
  }

  if (notaFiscal && prefs.notaFiscal && [...notaFiscal.options].some(opt => opt.value === prefs.notaFiscal)) {
    notaFiscal.value = prefs.notaFiscal
  }
}

function loadOverrides() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_OVERRIDES) || '{}')
    const map = new Map()
    Object.entries(raw || {}).forEach(([key, value]) => {
      if (value && typeof value === 'object') map.set(key, value)
    })
    overrides = map
  } catch {
    overrides = new Map()
  }
}

function saveOverrides() {
  const raw = Object.fromEntries(overrides.entries())
  localStorage.setItem(STORAGE_OVERRIDES, JSON.stringify(raw))
}

async function carregarModelos() {
  let lista = []

  try {
    const data = await apiGet('/models')
    const arr = Array.isArray(data) ? data : (Array.isArray(data?.models) ? data.models : [])
    lista = arr.map((m, i) => normalizeModel(m, i)).filter(m => m.name)
  } catch (_) {
    lista = []
  }

  if (!lista.length) {
    lista = loadLocalFallback()
  }

  if (lista.length) {
    saveSharedModels(lista)
  }

  modelos = lista
  preencherModelos()
  exibir()
}

function preencherModelos() {
  const select = el('modelo')
  if (!select) return

  const currentVal = select.value
  const prefs = loadPrefs()
  const atual = currentVal || prefs.modelo
  select.innerHTML = ''

  if (!modelos.length) {
    select.innerHTML = '<option value="">Cadastre modelos na precificação</option>'
    return
  }

  modelos.forEach(modelo => {
    const opt = document.createElement('option')
    opt.value = String(modelo.id)
    opt.textContent = modelo.name
    select.appendChild(opt)
  })

  const existeAtual = modelos.some(m => String(m.id) === String(atual))
  select.value = existeAtual ? atual : String(modelos[0].id)
  savePrefs()
}

function getModeloAtual() {
  const select = el('modelo')
  if (!select) return null
  return modelos.find(m => String(m.id) === String(select.value)) || null
}

function getTaxa() {
  return parseNumber(el('taxa')?.value, 1.05)
}

function getNotaFiscal() {
  return parseNumber(el('notaFiscal')?.value, 0.01)
}

function getTaxaLabel() {
  return el('taxa')?.selectedOptions?.[0]?.textContent?.trim() || 'Cartão 5%'
}

function getNotaFiscalLabel() {
  return el('notaFiscal')?.selectedOptions?.[0]?.textContent?.trim() || 'Nota fiscal 1%'
}

function getFiltroSignature() {
  return `${getTaxa().toFixed(4)}|${getNotaFiscal().toFixed(4)}`
}

function refreshCatalogo() {
  savePrefs()
  if (window.requestAnimationFrame) {
    requestAnimationFrame(() => exibir())
    return
  }
  setTimeout(() => exibir(), 0)
}

function getCatalogSnapshot() {
  return JSON.stringify(modelos.map(model => ({
    id: model.id,
    name: model.name,
    baseMeters: model.baseMeters,
    spacingCm: model.spacingCm,
    salePriceCents: model.salePriceCents,
    totalCostCents: model.totalCostCents,
    targetProfitCents: model.targetProfitCents
  })))
}

async function syncCatalogoLive(force = false) {
  if (editavel) return
  try {
    await carregarModelos()
    const nextSnapshot = getCatalogSnapshot()
    if (force || nextSnapshot !== lastCatalogSnapshot) {
      lastCatalogSnapshot = nextSnapshot
      refreshCatalogo()
    }
  } catch (error) {
    console.error('Falha ao sincronizar catálogo em tempo real:', error)
  }
}

function getLinhaCalculada(modelo, metragem) {
  const taxa = getTaxa()
  const notaFiscal = getNotaFiscal()

  const ve = modelo.valorPorEspacamentoCents || 0
  const sc = modelo.spacingCm
  const bm = modelo.baseMeters > 10 ? modelo.baseMeters / 100 : modelo.baseMeters

  const vendaBase = calcularPrecoPorEspacamento({
    metragem, baseMeters: bm, basePriceCents: modelo.salePriceCents, espacamentoCm: sc, valorPorEspacamentoCents: ve
  })
  const cartaoRaw   = Math.round(vendaBase * taxa)
  const vistaFinal  = Math.round(vendaBase * (1 + notaFiscal))
  const cartaoFinal = Math.round(cartaoRaw * (1 + notaFiscal))

  let lucro = 0

  if (modelo.salePriceCents > 0 && modelo.totalCostCents > 0) {
    const custoVe = ve > 0 ? Math.round(ve * modelo.totalCostCents / modelo.salePriceCents) : 0
    const custo = calcularPrecoPorEspacamento({
      metragem, baseMeters: bm, basePriceCents: modelo.totalCostCents, espacamentoCm: sc, valorPorEspacamentoCents: custoVe
    })
    lucro = vendaBase - custo
  } else if (modelo.targetProfitCents > 0) {
    const lucroVe = ve > 0 && modelo.salePriceCents > 0
      ? Math.round(ve * modelo.targetProfitCents / modelo.salePriceCents) : 0
    lucro = calcularPrecoPorEspacamento({
      metragem, baseMeters: bm, basePriceCents: modelo.targetProfitCents, espacamentoCm: sc, valorPorEspacamentoCents: lucroVe
    })
  } else {
    lucro = Math.round(vendaBase * 0.3)
  }

  const margem = vendaBase > 0 ? (lucro / vendaBase) * 100 : 0

  return { metragem, vendaBase: vistaFinal, cartao: cartaoFinal, lucro, margem }
}

function emptyState(message) {
  const corpo = el('corpo')
  if (!corpo) return

  corpo.innerHTML = `
    <tr>
      <td colspan="5" style="text-align:center; padding:16px;">
        ${escapeHtml(message)}
      </td>
    </tr>
  `

  const info = el('catalogoInfo')
  if (info) info.textContent = message
}

function setCellEditable(td, enabled, key, field) {
  // Somente "vendaBase" (Valor à vista) é editável; derivados são recalculados ao trancar
  if (!enabled || field !== 'vendaBase') return

  td.contentEditable = 'true'
  td.spellcheck = false
  td.dataset.key = key
  td.dataset.field = field
  td.classList.add('tabela_editando')

  td.addEventListener('blur', () => {
    const mapa = overrides.get(key) || {}
    mapa[field] = td.textContent
    overrides.set(key, mapa)
    saveOverrides()
  })
}

function recalcularDerivedOverrides() {
  const taxa = getTaxa()
  const notaFiscal = getNotaFiscal()

  overrides.forEach((mapa, key) => {
    const vistaRaw = mapa['vendaBase']
    if (!vistaRaw) return

    const vendaBaseCents = Math.round(parseNumber(vistaRaw, 0) * 100)
    if (!vendaBaseCents) return

    const cartaoCents = Math.round(vendaBaseCents * taxa)

    mapa['cartao'] = moedaFromCents(cartaoCents)

    // Lucro e margem voltam ao cálculo do modelo (sem override)
    delete mapa['lucro']
    delete mapa['margem']

    overrides.set(key, mapa)
  })

  saveOverrides()
}

function aplicarOverride(key, field, valorOriginal) {
  const row = overrides.get(key)
  if (!row) return valorOriginal

  const edited = row[field]
  if (edited === undefined || edited === null || edited === '') return valorOriginal

  if (field === 'margem') {
    return formatPercent(parseNumber(edited, parseNumber(valorOriginal, 0)))
  }

  const cents = Math.round(parseNumber(edited, Number(valorOriginal || 0) / 100) * 100)
  return moedaFromCents(cents)
}

function getLinhasExibicao(modelo) {
  return getOfficialMetragens(modelo).map(m => {
    const linha = getLinhaCalculada(modelo, m)
    const key = `${modelo.id}:${getFiltroSignature()}:${m.toFixed(2)}`

    return {
      key,
      metragem: `${m.toFixed(2).replace('.', ',')} m`,
      vista: aplicarOverride(key, 'vendaBase', moedaFromCents(linha.vendaBase)),
      cartao: aplicarOverride(key, 'cartao', moedaFromCents(linha.cartao)),
      lucro: aplicarOverride(key, 'lucro', moedaFromCents(linha.lucro)),
      margem: aplicarOverride(key, 'margem', formatPercent(linha.margem))
    }
  })
}

function atualizarResumo(modelo) {
  const info = el('catalogoInfo')
  if (!info) return

  if (!modelo) {
    info.textContent = 'Selecione um modelo para visualizar a tabela.'
    return
  }

  info.innerHTML = `
    <strong>${escapeHtml(modelo.name)}</strong> · Base ${modelo.baseMeters.toFixed(2).replace('.', ',')} m ·
    Degrau a cada ${String(modelo.spacingCm).replace('.', ',')} cm ·
    ${escapeHtml(getTaxaLabel())} · ${escapeHtml(getNotaFiscalLabel())}
    ${modelo.descricaoModelo ? `<div style="margin-top:4px;font-size:13px;opacity:0.75;">${escapeHtml(modelo.descricaoModelo)}</div>` : ''}
  `
}

function exibir() {
  const corpo = el('corpo')
  const modelo = getModeloAtual()

  if (!corpo) return
  if (!modelo) {
    saveActiveModel(null)
    emptyState('Cadastre um modelo na precificação para exibir o catálogo.')
    return
  }

  savePrefs()
  saveActiveModel(modelo)
  atualizarResumo(modelo)
  corpo.innerHTML = ''

  const linhas = getLinhasExibicao(modelo)

  linhas.forEach(linha => {
    const tr = document.createElement('tr')

    const tdMetragem = document.createElement('td')
    tdMetragem.textContent = linha.metragem
    tdMetragem.className = 'metragem'
    tr.appendChild(tdMetragem)

    const colunas = [
      ['vendaBase', linha.vista, 'avista'],
      ['cartao', linha.cartao, ''],
      ['lucro', linha.lucro, ''],
      ['margem', linha.margem, '']
    ]

    colunas.forEach(([field, texto, className]) => {
      const td = document.createElement('td')
      td.textContent = texto
      if (className) td.classList.add(className)
      setCellEditable(td, editavel, linha.key, field)
      tr.appendChild(td)
    })

    corpo.appendChild(tr)
  })
}

function toggleEdit() {
  const estavEditando = editavel
  editavel = !editavel

  if (estavEditando) {
    // Estava destrancado e agora está trancando: recalcula derivados
    recalcularDerivedOverrides()
  }

  const toggle = el('toggle')
  if (toggle) {
    toggle.textContent = editavel ? 'Tabela destrancada' : 'Tabela trancada'
  }
  exibir()
}

function drawPdfBlueBlock(doc, x, y, width, height, lines, fontSize = 10) {
  const textLines = Array.isArray(lines) ? lines : [lines]
  doc.setFillColor(76, 100, 168)
  doc.setDrawColor(76, 100, 168)
  doc.roundedRect(x, y, width, height, 1.6, 1.6, 'FD')
  doc.setTextColor(255, 255, 255)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(fontSize)

  if (textLines.length === 1) {
    doc.text(String(textLines[0]), x + width / 2, y + height / 2 + 1.1, { align: 'center' })
    return
  }

  const lineHeight = textLines.length === 2 ? 3.1 : 2.9
  const totalHeight = (textLines.length - 1) * lineHeight
  const startY = y + (height / 2) - (totalHeight / 2) + 0.9
  textLines.forEach((line, index) => {
    doc.text(String(line), x + width / 2, startY + (index * lineHeight), { align: 'center' })
  })
}

function drawPdfColumnHeader(doc, x, y, width, topLabel, bottomLines) {
  const topHeight = 5.9
  const gap = 0.9
  const bottomHeight = 7.3
  drawPdfBlueBlock(doc, x, y, width, topHeight, topLabel, 9.7)
  drawPdfBlueBlock(doc, x, y + topHeight + gap, width, bottomHeight, bottomLines, 7.6)
  return topHeight + gap + bottomHeight
}

function desenharCabecalhoPdf(doc, y) {
  const cols = [10, 73, 136]
  const width = 60
  const totalHeight = drawPdfColumnHeader(doc, cols[1], y, width, 'À vista', ['Com nota', 'fiscal'])

  drawPdfBlueBlock(doc, cols[0], y, 60, totalHeight, 'Metragem', 11.2)
  drawPdfColumnHeader(doc, cols[2], y, width, 'Cartão', ['Com nota', 'fiscal'])

  doc.setTextColor(0, 0, 0)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  return y + totalHeight + 2.2
}

async function buildCatalogoPdfPayload() {
  const modelo = getModeloAtual()
  if (!modelo) {
    throw new Error('Selecione um modelo válido para exportar o catálogo.')
  }

  if (!window.jspdf || !window.jspdf.jsPDF) {
    throw new Error('Biblioteca de PDF não carregada. Recarregue a página e tente novamente.')
  }

  const { jsPDF } = window.jspdf
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const rows = getLinhasExibicao(modelo)
  const dataTexto = new Date().toLocaleString('pt-BR')
  const imgDataUrl = await getImageBase64(modelo)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(16)
  doc.text('Catálogo de valores', 12, 16)

  if (imgDataUrl) {
    try { doc.addImage(imgDataUrl, 'JPEG', 162, 8, 36, 36) } catch (_) {}
  }

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(11)
  doc.text(`Modelo: ${modelo.name}`, 12, 24)
  doc.text(`Base: ${modelo.baseMeters.toFixed(2).replace('.', ',')} m`, 12, 30)
  doc.text(`Degrau a cada: ${String(modelo.spacingCm).replace('.', ',')} cm`, 12, 36)
  const firstRow = rows[0]?.metragem || '-'
  const lastRow = rows[rows.length - 1]?.metragem || '-'
  doc.text(`Condição cartão: ${getTaxaLabel()}`, 110, 24)
  doc.text(`Faixa oficial: ${firstRow} até ${lastRow}`, 110, 30)
  doc.text(`Gerado em: ${dataTexto}`, 110, 36)

  let y = 50
  if (modelo.descricaoModelo) {
    doc.setFont('helvetica', 'italic')
    doc.setFontSize(9)
    doc.text(`Descrição: ${modelo.descricaoModelo}`, 12, 43)
    y = 56
  }
  y = desenharCabecalhoPdf(doc, y)

  rows.forEach(row => {
    if (y > 276) {
      doc.addPage()
      y = 16
      y = desenharCabecalhoPdf(doc, y)
    }

    const values = [row.metragem, row.vista, row.cartao]
    const cols = [10, 73, 136]
    const width = 60

    doc.setFontSize(10)
    values.forEach((value, index) => {
      doc.rect(cols[index], y, width, 8)
      doc.text(String(value), cols[index] + width / 2, y + 5.4, { align: 'center' })
    })

    y += 8
  })

  const fileName = `catalogo-${safeFileName(modelo.name)}.pdf`
  const title = `Catálogo • ${modelo.name}`
  const pdfBlob = doc.output('blob')
  return { doc, pdfBlob, fileName, title }
}

async function exportPDF() {
  try {
    const { pdfBlob, fileName, title } = await buildCatalogoPdfPayload()
    openPdfPreview(pdfBlob, fileName, title)
  } catch (error) {
    console.error(error)
    alert(error.message || 'Não foi possível gerar o PDF do catálogo.')
  }
}

async function sendPDF() {
  try {
    const { pdfBlob, fileName, title } = await buildCatalogoPdfPayload()
    const file = typeof File === 'function'
      ? new File([pdfBlob], fileName || 'documento.pdf', { type: 'application/pdf' })
      : null

    if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({
        title: title || fileName || 'PDF',
        text: 'PDF gerado pela Estofaria Digital',
        files: [file]
      })
      return { ok: true, mode: 'native-share' }
    }

    const url = URL.createObjectURL(pdfBlob)
    const link = document.createElement('a')
    link.href = url
    link.download = fileName || 'documento.pdf'
    link.rel = 'noopener noreferrer'
    link.style.display = 'none'
    document.body.appendChild(link)
    link.click()
    link.remove()
    setTimeout(() => {
      try { URL.revokeObjectURL(url) } catch (_) {}
    }, 60000)
    alert('O envio nativo não está disponível neste aparelho. O PDF foi baixado para envio manual.')
    return { ok: true, mode: 'download-fallback' }
  } catch (error) {
    console.error(error)
    alert(error.message || 'Não foi possível preparar o PDF para envio.')
    return { ok: false, error }
  }
}

function bindFiltro(select) {
  if (!select) return
  const handler = () => refreshCatalogo()
  select.addEventListener('change', handler)
  select.addEventListener('input', handler)
}

window.exibir = exibir
window.toggleEdit = toggleEdit
window.exportPDF = exportPDF
window.sendPDF = sendPDF
window.savePrefs = savePrefs
window.catalogoOnSelectChange = function(){
  refreshCatalogo()
}

window.addEventListener('load', async () => {
  applySavedPrefs()
  loadOverrides()

  bindFiltro(el('modelo'))
  bindFiltro(el('taxa'))
  bindFiltro(el('notaFiscal'))

  await carregarModelos()
  lastCatalogSnapshot = getCatalogSnapshot()
  refreshCatalogo()

  if (liveCatalogTimer) clearInterval(liveCatalogTimer)
  liveCatalogTimer = setInterval(() => { syncCatalogoLive(false) }, 10000)
})

window.addEventListener('storage', event => {
  if (!event || !event.key) return
  if ([STORAGE_SHARED_MODELS, STORAGE_CATALOGO_MODELS, STORAGE_ACTIVE_MODEL, STORAGE_OVERRIDES, STORAGE_PREFS].includes(event.key)) {
    syncCatalogoLive(true)
  }
})

window.addEventListener('message', function (e) {
  if (!e.data || e.data.type !== 'estofaria-ptr-refresh') return
  Promise.resolve()
    .then(function () { return refreshCatalogo() })
    .catch(function () {})
    .finally(function () {
      try { window.parent.postMessage({ type: 'estofaria-ptr-done' }, '*') } catch (_) {}
    })
})
