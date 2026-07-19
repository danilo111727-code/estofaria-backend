const API = (window.API_BASE || '') + '/api'

let modelosDisponiveis = []
let itensPersonalizacaoCache = new Map()
let itensFixosFallback = []
let modelos = []
let ativo = null
let ultimoSalvo = null

function ui(){
  return window.ESTOFARIA_UI
}

const STORAGE_SHARED_MODELS = 'precificacao_modelos'
const STORAGE_CATALOGO_MODELS = 'catalogo_modelos'
const STORAGE_ITENS_MODELS_CACHE = 'itens_personalizacao_models_cache_v1'
const STORAGE_ITENS_CACHE_PREFIX = 'itens_personalizacao_cache_v2:'
const STORAGE_ACTIVE_MODEL = 'estofaria_modelo_ativo_v1'
const STORAGE_GLOBAL_PERSONALIZATION_ITEMS = 'itens_personalizacao_global_v1'
const STORAGE_LOCAL_PERSONALIZATION_PREFIX = 'itens_'
const METRAGEM_INICIAL = 1
const METRAGEM_FINAL = 5
const ESPACAMENTO_PADRAO_CM = 10

function pick(obj, keys){
  for(const key of keys){
    if(obj && obj[key] !== undefined && obj[key] !== null && obj[key] !== ''){
      return obj[key]
    }
  }
  return undefined
}

function parseLooseNumber(v){
  if(typeof v === 'number') return Number.isFinite(v) ? v : 0
  const s = String(v || '').trim()
  if(!s) return 0
  const cleaned = s.replace(/[^\d,.-]/g, '').replace(',', '.')
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : 0
}

function parseCurrencyToCents(v){
  if(v === undefined || v === null || v === '') return 0

  if(typeof v === 'number'){
    return Math.round(v * 100)
  }

  let s = String(v).trim()
  if(!s) return 0

  if(/^\d+$/.test(s)){
    return Math.round(Number(s) * 100)
  }

  s = s.replace(/[^\d,.-]/g, '')
  if(s.includes(',') && s.includes('.')){
    s = s.replace(/\./g, '').replace(',', '.')
  }else if(s.includes(',') && !s.includes('.')){
    s = s.replace(',', '.')
  }

  const n = Number(s)
  return Number.isFinite(n) ? Math.round(n * 100) : 0
}

function extractApiValueToCents(v){
  if(v === undefined || v === null || v === '') return 0

  if(typeof v === 'number'){
    if(Number.isInteger(v)) return v
    return Math.round(v * 100)
  }

  const s = String(v).trim()
  if(!s) return 0

  if(/^\d+$/.test(s)){
    if(s.length >= 4) return Number(s)
    return Math.round(Number(s) * 100)
  }

  return parseCurrencyToCents(s)
}

function centsToReais(cents){
  return Number(cents || 0) / 100
}

function moeda(v){
  return Number(v || 0).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  })
}

function escapeHtml(text){
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function getToken(){
  try{
    return window.ESTOFARIA_HTTP && typeof window.ESTOFARIA_HTTP.getToken === 'function'
      ? window.ESTOFARIA_HTTP.getToken()
      : (
          localStorage.getItem('token') ||
          localStorage.getItem('auth_token') ||
          localStorage.getItem('estofaria_token') ||
          ''
        )
  }catch(e){
    return ''
  }
}

function authHeaders(extra = {}){
  return window.ESTOFARIA_HTTP && typeof window.ESTOFARIA_HTTP.authHeaders === 'function'
    ? window.ESTOFARIA_HTTP.authHeaders(extra)
    : { ...extra }
}

async function apiFetch(path, options = {}){
  return window.ESTOFARIA_HTTP.fetchJson(API + path, {
    cache: options.cache || 'no-store',
    ...options,
    headers: authHeaders(options.headers || {})
  })
}

function asArray(data){
  if(Array.isArray(data)) return data
  if(data && Array.isArray(data.items)) return data.items
  if(data && Array.isArray(data.data)) return data.data
  if(data && Array.isArray(data.models)) return data.models
  if(data && Array.isArray(data.results)) return data.results
  return []
}

function resolveModelImageDataUrl(model){
  const value = pick(model, ['image_data_url', 'imageDataUrl', 'photo_data_url', 'photoDataUrl', 'foto_data_url', 'fotoDataUrl', 'image', 'photo', 'foto']) || ''
  return typeof value === 'string' ? value.trim() : ''
}

function getSpacingCm(model){
  const raw = pick(model, ['spacing_cm', 'spacingCm', 'espacamento_cm', 'espacamentoCm', 'spacing', 'espacamento'])
  const n = parseLooseNumber(raw)
  return n > 0 ? n : ESPACAMENTO_PADRAO_CM
}

function buildMetragens(spacingCm){
  const step = Math.max(0.01, parseLooseNumber(spacingCm) / 100 || ESPACAMENTO_PADRAO_CM / 100)
  const result = []
  let current = METRAGEM_INICIAL

  while(current < METRAGEM_FINAL + 0.0001){
    result.push(Number(current.toFixed(2)))
    current += step
  }

  const last = result[result.length - 1]
  if(last !== METRAGEM_FINAL){
    result.push(METRAGEM_FINAL)
  }

  return [...new Set(result.map(v => Number(v.toFixed(2))))].sort((a, b) => a - b)
}

function normalizeModel(raw, index){
  const id = pick(raw, ['id', '_id', 'uuid', 'model_id']) || String(index + 1)
  const name = String(
    pick(raw, ['name', 'nome', 'modelo', 'title']) || `Modelo ${index + 1}`
  ).trim()

  const baseMeters =
    parseLooseNumber(
      pick(raw, [
        'base_meters',
        'baseMeters',
        'base_metragem',
        'metragem_base',
        'base'
      ])
    ) || 0

  let priceCents = Number(
    pick(raw, [
      'sale_price_cents',
      'selling_price_cents',
      'preco_venda_cents',
      'venda_cents',
      'price_cents',
      'valor_cents'
    ])
  )
  if(!Number.isFinite(priceCents) || priceCents < 0) priceCents = 0

  if(!priceCents){
    const rawPrice = pick(raw, [
      'sale_price',
      'selling_price',
      'preco_venda',
      'venda',
      'price',
      'valor',
      'sellingPrice'
    ])
    priceCents = parseCurrencyToCents(rawPrice)
  }

  let pricePerMeterCents = Number(
    pick(raw, [
      'price_per_meter_cents',
      'valor_metro_cents',
      'sale_price_per_meter_cents'
    ])
  )
  if(!Number.isFinite(pricePerMeterCents) || pricePerMeterCents < 0){
    pricePerMeterCents = 0
  }

  if(!pricePerMeterCents){
    const rawPricePerMeter = pick(raw, [
      'price_per_meter',
      'valor_metro',
      'sale_price_per_meter'
    ])
    pricePerMeterCents = parseCurrencyToCents(rawPricePerMeter)
  }

  if(!pricePerMeterCents && priceCents && baseMeters > 0){
    pricePerMeterCents = Math.round(priceCents / baseMeters)
  }

  if(!priceCents && pricePerMeterCents && baseMeters > 0){
    priceCents = Math.round(pricePerMeterCents * baseMeters)
  }

  const imageDataUrl = resolveModelImageDataUrl(raw)

  return {
    id: String(id),
    name,
    baseMeters,
    spacingCm: getSpacingCm(raw),
    priceCents,
    pricePerMeterCents,
    valorPorEspacamentoCents: Math.max(0, Math.round(parseLooseNumber(
      raw.valor_por_espacamento_cents ?? raw.valorPorEspacamentoCents ?? 0
    ))),
    imageDataUrl,
    image_data_url: imageDataUrl,
    descricaoModelo: String(raw.descricao_modelo || raw.descricaoModelo || '').trim(),
    itensIncluidos: Array.isArray(raw.itens_incluidos) ? raw.itens_incluidos : (Array.isArray(raw.itensIncluidos) ? raw.itensIncluidos : [])
  }
}

function calcularPrecoPorDegrau(modelo, metragem) {
  if (!modelo || !metragem) return 0
  const baseM = (modelo.baseMeters > 10 ? modelo.baseMeters / 100 : modelo.baseMeters) || 0
  const espacamentoM = (modelo.spacingCm || 10) / 100
  const valorDegrau = modelo.valorPorEspacamentoCents || 0
  if (!baseM || !espacamentoM) return modelo.priceCents || 0
  const diferenca = metragem - baseM
  const ratio = Math.round((diferenca / espacamentoM) * 1e4) / 1e4
  const degraus = Math.ceil(ratio)
  return Math.max(0, (modelo.priceCents || 0) + (degraus * valorDegrau))
}

function formatMetersKey(v){
  const n = parseLooseNumber(v)
  return n > 0 ? n.toFixed(2) : String(v || '').trim()
}

function readModelListFromStorage(key){
  try{
    const raw = JSON.parse(localStorage.getItem(key) || '[]')
    const arr = Array.isArray(raw) ? raw : (Array.isArray(raw?.models) ? raw.models : [])
    return arr.map(normalizeModel).filter(model => model.name)
  }catch(e){
    return []
  }
}

function loadFallbackModels(){
  const buckets = [
    readModelListFromStorage(STORAGE_SHARED_MODELS),
    readModelListFromStorage(STORAGE_CATALOGO_MODELS),
    readModelListFromStorage(STORAGE_ITENS_MODELS_CACHE)
  ]

  const seen = new Set()
  return buckets
    .flat()
    .filter(model => {
      const key = `${String(model.id)}::${String(model.name).toLowerCase()}`
      if(!model.name || seen.has(key)) return false
      seen.add(key)
      return true
    })
}

function loadSharedActiveModel(){
  try{
    const raw = JSON.parse(localStorage.getItem(STORAGE_ACTIVE_MODEL) || '{}')
    return raw && typeof raw === 'object' ? raw : {}
  }catch(e){
    return {}
  }
}

function saveSharedActiveModel(model){
  try{
    if(!model){
      localStorage.removeItem(STORAGE_ACTIVE_MODEL)
      return
    }
    localStorage.setItem(STORAGE_ACTIVE_MODEL, JSON.stringify({
      id: String(model.id || ''),
      name: String(model.name || ''),
      source: 'vendedor',
      savedAt: Date.now()
    }))
  }catch(e){}
}

function saveSharedModelsCache(lista){
  const normalized = (Array.isArray(lista) ? lista : [])
    .map((model, index) => normalizeModel(model, index))
    .filter(model => model.name)
    .map(model => ({
      id: model.id,
      name: model.name,
      base_meters: model.baseMeters,
      spacing_cm: model.spacingCm,
      sale_price_cents: model.priceCents,
      price_per_meter_cents: model.pricePerMeterCents,
      image_data_url: model.imageDataUrl || '',
      imageDataUrl: model.imageDataUrl || ''
    }))

  try{ localStorage.setItem(STORAGE_SHARED_MODELS, JSON.stringify(normalized)) }catch(e){}
  try{ localStorage.setItem(STORAGE_CATALOGO_MODELS, JSON.stringify(normalized)) }catch(e){}
  try{ localStorage.setItem(STORAGE_ITENS_MODELS_CACHE, JSON.stringify(normalized)) }catch(e){}
}

function loadCachedPersonalizationItems(modelId){
  const key = String(modelId || '')
  if(!key) return []

  try{
    const raw = JSON.parse(localStorage.getItem(`${STORAGE_ITENS_CACHE_PREFIX}${key}`) || '{}')
    const source = Array.isArray(raw?.items) ? raw.items : raw
    return normalizePersonalizationItems(source)
  }catch(e){
    return []
  }
}

function normalizePersonalizationItems(data){
  const arr = asArray(data && data.items ? data.items : data)

  return arr
    .map((item, index) => {
      const name = String(
        pick(item, ['name', 'nome', 'label', 'title']) || `Item ${index + 1}`
      ).trim()

      if(!name) return null

      const unit = String(pick(item, ['unit', 'unidade']) || 'unidade').trim()

      const priceCents =
        Number(
          pick(item, ['price_cents', 'value_cents', 'valor_cents', 'preco_cents'])
        ) ||
        parseCurrencyToCents(
          pick(item, ['price', 'value', 'valor', 'preco'])
        )

      const consumos = item?.consumos && typeof item.consumos === 'object'
        ? item.consumos
        : {}

      const values = {}

      Object.keys(consumos).forEach(key => {
        const consumo = parseLooseNumber(consumos[key])
        if(consumo > 0 && priceCents > 0){
          values[formatMetersKey(key)] = Math.round(consumo * priceCents)
        }
      })

      if(!Object.keys(values).length){
        const valuesRaw = pick(item, ['values', 'valores']) || {}
        if(valuesRaw && typeof valuesRaw === 'object'){
          Object.keys(valuesRaw).forEach(key => {
            if(key !== 'padrao'){
              values[formatMetersKey(key)] = extractApiValueToCents(valuesRaw[key])
            }
          })
        }
      }

      const fixedValueCents = priceCents

      if(fixedValueCents > 0 && !Object.keys(values).length){
        values.padrao = fixedValueCents
      }

      return { name, unit, values }
    })
    .filter(Boolean)
}

function normalizeStoredPersonalizationItems(data){
  const arr = Array.isArray(data) ? data : []

  return arr
    .map((item, index) => {
      const name = String(
        pick(item, ['name', 'nome', 'label', 'title']) || `Item ${index + 1}`
      ).trim()

      if(!name) return null

      const unit = String(pick(item, ['unit', 'unidade']) || 'unidade').trim()
      const priceCents =
        Number(
          pick(item, ['price_cents', 'value_cents', 'valor_cents', 'preco_cents'])
        ) ||
        parseCurrencyToCents(
          pick(item, ['price', 'value', 'valor', 'preco'])
        )

      const consumos = item?.consumos && typeof item.consumos === 'object'
        ? item.consumos
        : {}
      const values = {}

      Object.keys(consumos).forEach(key => {
        const consumo = parseLooseNumber(consumos[key])
        if(consumo > 0 && priceCents > 0){
          values[formatMetersKey(key)] = Math.round(consumo * priceCents)
        }
      })

      if(priceCents > 0 && !Object.keys(values).length){
        values.padrao = priceCents
      }

      return { name, unit, values }
    })
    .filter(Boolean)
}

function readStoredPersonalizationItems(storageKey){
  if(!storageKey) return []

  try{
    const raw = JSON.parse(localStorage.getItem(storageKey) || '[]')
    const source = Array.isArray(raw) ? raw : (Array.isArray(raw?.items) ? raw.items : [])
    return normalizeStoredPersonalizationItems(source)
  }catch(e){
    return []
  }
}

function mergePersonalizationItems(...lists){
  const merged = new Map()

  lists.flat().forEach(item => {
    if(!item || !item.name) return
    const key = String(item.name).trim().toLowerCase()
    const current = merged.get(key)

    if(!current){
      merged.set(key, {
        name: item.name,
        unit: item.unit || 'unidade',
        values: { ...(item.values || {}) }
      })
      return
    }

    merged.set(key, {
      name: item.name || current.name,
      unit: item.unit || current.unit || 'unidade',
      values: {
        ...(current.values || {}),
        ...(item.values || {})
      }
    })
  })

  return Array.from(merged.values())
}

function loadSharedPersonalizationItems(modelId = null){
  const globalItems = readStoredPersonalizationItems(STORAGE_GLOBAL_PERSONALIZATION_ITEMS)

  if(!modelId){
    return mergePersonalizationItems(globalItems)
  }

  const localModelItems = readStoredPersonalizationItems(`${STORAGE_LOCAL_PERSONALIZATION_PREFIX}${modelId}`)
  return mergePersonalizationItems(globalItems, localModelItems)
}

function loadAlbunsParaVendedor(){
  try{
    const albums = JSON.parse(localStorage.getItem('esd_albums_v1') || '[]')
    if(!Array.isArray(albums)) return []
    return albums
      .filter(a => a && a.nome)
      .map(a => ({
        name: String(a.nome),
        unit: String(a.unidade || 'álbum'),
        values: { padrao: Math.round(Number(a.custo || 0) * 100) }
      }))
  }catch{ return [] }
}

function captureFallbackItemOptions(){
  const select = document.getElementById('item')
  if(!select) return

  itensFixosFallback = Array.from(select.options)
    .filter(opt => String(opt.value || '').trim() !== '')
    .map(opt => ({
      name: String(opt.textContent || '').trim(),
      unit: 'unidade',
      valueCents: Math.round(parseLooseNumber(opt.value) * 100)
    }))
}

function getSelectedRealModel(){
  const select = document.getElementById('modelo')
  const current = String(select?.value || '')

  if(!current) return null

  return (
    modelosDisponiveis.find(m => String(m.id) === current) ||
    modelosDisponiveis.find(m => String(m.name) === current) ||
    null
  )
}

function buildQuickOptionsFromModel(model){
  const select = document.getElementById('metragemRapida')
  if(!select) return

  if(!model || !model.priceCents){
    select.innerHTML = '<option value="">Selecione um modelo válido</option>'
    return
  }

  const previousValue = select.value
  const base = Number((model.baseMeters > 10 ? model.baseMeters / 100 : model.baseMeters || METRAGEM_INICIAL).toFixed(2))
  const metragens = buildMetragens(model.spacingCm || ESPACAMENTO_PADRAO_CM)

  select.innerHTML = ''

  metragens.forEach(meters => {
    const cents = calcularPrecoPorDegrau(model, meters)
    const option = document.createElement('option')
    option.value = `${centsToReais(cents)}|${meters.toFixed(2)}`
    option.textContent = `${meters.toFixed(2)} m — ${moeda(centsToReais(cents))}`
    if(meters === base) option.selected = true
    select.appendChild(option)
  })

  const exact = Array.from(select.options).find(opt => opt.value === previousValue)
  if(exact) select.value = previousValue
}

function getQuickSelectionInfo(){
  const select = document.getElementById('metragemRapida')
  const raw = String(select?.value || '')
  if(!raw.includes('|')){
    return { priceCents: 0, meters: 0 }
  }

  const [priceRaw, metersRaw] = raw.split('|')
  const priceCents = Math.round(parseLooseNumber(priceRaw) * 100)
  const meters = parseLooseNumber(metersRaw)

  return { priceCents, meters }
}

function calcManual(){
  const input = document.getElementById('metragemManual')
  const preview = document.getElementById('previewManual')
  const raw = String(input?.value || '').trim()

  if(!raw){
    if(preview) preview.innerText = ''
    return null
  }

  const n = parseLooseNumber(raw)
  if(!n){
    if(preview) preview.innerText = ''
    return null
  }

  const meters = n >= 10 ? n / 100 : n
  const model = getSelectedRealModel()

  const priceCents = model ? calcularPrecoPorDegrau(model, meters) : 0

  if(preview){
    preview.innerText = `${meters.toFixed(2)} m — ${moeda(centsToReais(priceCents))}`
  }

  return {
    meters,
    priceCents
  }
}

function getBaseSelectionForNewModel(){
  const model = getSelectedRealModel()
  const manual = calcManual()
  const quick = getQuickSelectionInfo()

  if(manual && manual.meters > 0){
    return manual
  }

  if(model && quick.meters > 0){
    return {
      meters: quick.meters,
      priceCents: calcularPrecoPorDegrau(model, quick.meters)
    }
  }

  if(quick.meters > 0){
    return {
      meters: quick.meters,
      priceCents: quick.priceCents
    }
  }

  if(model && model.baseMeters > 0){
    const baseM = model.baseMeters > 10 ? model.baseMeters / 100 : model.baseMeters
    return {
      meters: baseM,
      priceCents: model.priceCents || calcularPrecoPorDegrau(model, baseM)
    }
  }

  return { meters: 0, priceCents: 0 }
}

async function loadModelosReais(){
  const select = document.getElementById('modelo')
  if(!select) return

  const previousValue = String(select.value || '')
  let data = []
  const fallbackModels = loadFallbackModels()
  const fallbackByKey = new Map(
    fallbackModels.map(model => [
      `${String(model.id)}::${String(model.name || '').toLowerCase()}`,
      model
    ])
  )

  try{
    data = await apiFetch('/models')
    modelosDisponiveis = asArray(data)
      .map(normalizeModel)
      .filter(m => m.name)
      .map(model => {
        const key = `${String(model.id)}::${String(model.name || '').toLowerCase()}`
        const fallback = fallbackByKey.get(key)
        if(!fallback) return model

        return {
          ...fallback,
          ...model,
          baseMeters: model.baseMeters || fallback.baseMeters || 0,
          spacingCm: model.spacingCm || fallback.spacingCm || ESPACAMENTO_PADRAO_CM,
          priceCents: model.priceCents || fallback.priceCents || 0,
          pricePerMeterCents: model.pricePerMeterCents || fallback.pricePerMeterCents || 0,
          valorPorEspacamentoCents: model.valorPorEspacamentoCents || fallback.valorPorEspacamentoCents || 0,
          descricaoModelo: model.descricaoModelo || fallback.descricaoModelo || '',
          imageDataUrl: model.imageDataUrl || fallback.imageDataUrl || fallback.image_data_url || '',
          image_data_url: model.image_data_url || model.imageDataUrl || fallback.image_data_url || fallback.imageDataUrl || ''
        }
      })

    if(modelosDisponiveis.length){
      saveSharedModelsCache(modelosDisponiveis)
    }
  }catch(e){
    console.warn('Não consegui carregar /models, mantendo fallback local.', e)
    modelosDisponiveis = fallbackModels
  }

  if(!modelosDisponiveis.length){
    modelosDisponiveis = fallbackModels
  }

  if(!modelosDisponiveis.length){
    select.innerHTML = '<option value="">Nenhum modelo cadastrado</option>'
    buildQuickOptionsFromModel(null)
    return
  }

  select.innerHTML = ''

  modelosDisponiveis.forEach(model => {
    const option = document.createElement('option')
    option.value = String(model.id)
    option.textContent = model.name
    select.appendChild(option)
  })

  const shared = loadSharedActiveModel()
  const sameById = modelosDisponiveis.find(m => String(m.id) === previousValue)
  const sameByName = modelosDisponiveis.find(m => String(m.name) === previousValue)
  const sharedById = modelosDisponiveis.find(m => String(m.id) === String(shared.id || ''))
  const sharedByName = modelosDisponiveis.find(m => String(m.name) === String(shared.name || ''))

  if(sameById){
    select.value = String(sameById.id)
  }else if(sameByName){
    select.value = String(sameByName.id)
  }else if(sharedById){
    select.value = String(sharedById.id)
  }else if(sharedByName){
    select.value = String(sharedByName.id)
  }

  saveSharedActiveModel(getSelectedRealModel())
  buildQuickOptionsFromModel(getSelectedRealModel())
}

function clearPersonalizationCache(modelId){
  if(modelId){
    itensPersonalizacaoCache.delete(String(modelId))
    return
  }
  itensPersonalizacaoCache.clear()
}

async function ensurePersonalizationItems(modelId, forceRefresh = false){
  const key = String(modelId || '')
  if(!key) return []

  if(forceRefresh){
    clearPersonalizationCache(key)
  }

  if(itensPersonalizacaoCache.has(key)){
    return itensPersonalizacaoCache.get(key) || []
  }

  try{
    const data = await apiFetch(`/models/${key}/personalization-items`)
    const items = normalizePersonalizationItems(data && data.items ? data.items : data)
    if(items.length){
      itensPersonalizacaoCache.set(key, items)
      return items
    }
  }catch(e){
    console.warn(`Não consegui carregar itens personalizados do modelo ${key}.`, e)
  }

  const cachedItems = loadCachedPersonalizationItems(key)
  itensPersonalizacaoCache.set(key, cachedItems)
  return cachedItems
}

function getItemValueCentsForMeters(item, meters){
  const values = item?.values || {}

  const key = Number(meters || 0).toFixed(2)
  if(values[key] !== undefined && values[key] !== null){
    return Number(values[key]) || 0
  }

  const numericKeys = Object.keys(values).filter(k => /^\d+(\.\d+)?$/.test(k))

  if(numericKeys.length){
    let bestKey = numericKeys[0]
    let bestDiff = Math.abs(parseLooseNumber(numericKeys[0]) - Number(meters || 0))

    numericKeys.forEach(k => {
      const diff = Math.abs(parseLooseNumber(k) - Number(meters || 0))
      if(diff < bestDiff){
        bestDiff = diff
        bestKey = k
      }
    })

    return Number(values[bestKey]) || 0
  }

  if(values.padrao) return Number(values.padrao) || 0

  return 0
}

function getReferenceModelForItems(){
  if(ativo){
    return {
      modelId: ativo.model_id ? String(ativo.model_id) : null,
      meters: parseLooseNumber(ativo.metragem) || 0
    }
  }

  const selected = getSelectedRealModel()
  if(selected){
    const manual = calcManual()
    const quick = getQuickSelectionInfo()
    const meters =
      (manual && manual.meters) ||
      quick.meters ||
      selected.baseMeters ||
      0

    return {
      modelId: String(selected.id),
      meters
    }
  }

  return { modelId: null, meters: 0 }
}

function populateFallbackItems(message = 'Nenhum item de personalização cadastrado para este modelo'){
  const select = document.getElementById('item')
  if(!select) return

  select.innerHTML = ''

  const option = document.createElement('option')
  option.value = ''
  option.textContent = message
  select.appendChild(option)
}

let _allItemOptions = []

async function refreshItemSelect(forceRefresh = false){
  const select = document.getElementById('item')
  if(!select) return

  const ref = getReferenceModelForItems()
  const sharedItems = loadSharedPersonalizationItems(ref.modelId)
  let availableItems = sharedItems

  if(ref.modelId){
    const apiItems = await ensurePersonalizationItems(ref.modelId, forceRefresh)
    availableItems = mergePersonalizationItems(sharedItems, apiItems)
  }

  if(!availableItems.length && itensFixosFallback.length){
    availableItems = normalizePersonalizationItems(
      itensFixosFallback.map(item => ({
        name: item.name,
        unit: item.unit,
        value_cents: item.valueCents
      }))
    )
  }

  // Inclui álbuns do localStorage
  const albuns = loadAlbunsParaVendedor()
  availableItems = mergePersonalizationItems(availableItems, albuns)

  if(!availableItems.length){
    populateFallbackItems('Cadastre itens na aba Itens para personalização')
    _allItemOptions = []
    return
  }

  _allItemOptions = []

  const currentModel = getSelectedRealModel()
  const itensIncluidosSet = new Set(
    (currentModel?.itensIncluidos || []).map(n => String(n).toLowerCase().trim())
  )

  const includedOptions = []
  const regularOptions = []

  availableItems.forEach(item => {
    const isIncluido = itensIncluidosSet.size > 0 && itensIncluidosSet.has(String(item.name || '').toLowerCase().trim())

    if(isIncluido){
      includedOptions.push({
        value: '0',
        name: item.name,
        unit: item.unit || 'unidade',
        valueCents: '0',
        text: `${item.name} — incluído no modelo`,
        incluido: true
      })
      return
    }

    const valueCents = getItemValueCentsForMeters(item, ref.meters)
    if(valueCents <= 0) return

    regularOptions.push({
      value: String(centsToReais(valueCents)),
      name: item.name,
      unit: item.unit || 'unidade',
      valueCents: String(valueCents),
      text: `${item.name} — ${moeda(centsToReais(valueCents))}`
    })
  })

  _allItemOptions = [...includedOptions, ...regularOptions]

  _renderItemOptions(_allItemOptions, '')

  if(select.options.length === 1){
    populateFallbackItems(ref.meters > 0 ? 'Nenhum item com valor disponível para esta metragem' : 'Nenhum item com valor disponível')
  }
}

function _renderItemOptions(options, query){
  const select = document.getElementById('item')
  if(!select) return

  const q = String(query || '').toLowerCase().trim()
  const filtered = q ? options.filter(o => o.name.toLowerCase().includes(q)) : options

  select.innerHTML = '<option value="">Selecionar</option>'
  filtered.forEach(opt => {
    const option = document.createElement('option')
    option.value = opt.value
    option.dataset.name = opt.name
    option.dataset.unit = opt.unit
    option.dataset.valueCents = opt.valueCents
    if(opt.incluido) option.dataset.incluido = '1'
    option.textContent = opt.text
    select.appendChild(option)
  })
}

function filtrarItens(query){
  _renderItemOptions(_allItemOptions, query)
}

function subtotalCents(modelo){
  const base = Number(modelo?.preco_cents || 0)
  const extras = (modelo?.itens || []).reduce((sum, item) => {
    return sum + Number(item?.valor_cents || 0)
  }, 0)
  return base + extras
}

function updateModeloAtivo(){
  const el = document.getElementById('modeloAtivo')
  if(!el) return

  if(!ativo){
    el.innerText = 'Nenhum modelo ativo'
    return
  }

  const modeloObj = modelosDisponiveis.find(m => String(m.id) === String(ativo.model_id) || m.name === ativo.modelo)
  const descricao = modeloObj?.descricaoModelo || ''
  const itensIncluidos = Array.isArray(modeloObj?.itensIncluidos) ? modeloObj.itensIncluidos.filter(Boolean) : []
  const incluidoHtml = itensIncluidos.length
    ? `<div style="font-size:12px;color:#4a67a1;margin-top:4px;"><strong>Incluso:</strong> ${escapeHtml(itensIncluidos.join(' / '))}</div>`
    : ''
  el.innerHTML = `
    <span style="font-weight:600;">${ativo.modelo} — ${Number(ativo.metragem || 0).toFixed(2)} m</span>
    ${descricao ? `<div style="font-size:12px;opacity:0.72;margin-top:3px;">${escapeHtml(descricao)}</div>` : ''}
    ${incluidoHtml}
  `
}

function renderItens(){
  const div = document.getElementById('listaItens')
  if(!div) return

  div.innerHTML = ''

  if(!ativo){
    div.innerHTML = '<div class="empty-state">Selecione um modelo para começar a personalização.</div>'
    return
  }

  if(!Array.isArray(ativo.itens) || !ativo.itens.length){
    div.innerHTML = '<div class="empty-state">Nenhum item adicionado neste modelo ainda.</div>'
    return
  }

  ativo.itens.forEach((item, index) => {
    const el = document.createElement('div')
    el.className = 'item_linha'
    const badge = item.incluido_no_modelo
      ? `<span style="font-size:11px;background:#e8f0fe;color:#4a67a1;border-radius:4px;padding:1px 6px;margin-left:6px;">incluído</span>`
      : ''
    const preco = item.incluido_no_modelo
      ? ''
      : ` — ${moeda(centsToReais(item.valor_cents))}`
    el.innerHTML = `
      <span>${escapeHtml(item.nome)}${badge}${preco}</span>
      <span style="cursor:pointer" onclick="remItem(${index})">🚮</span>
    `
    div.appendChild(el)
  })
}

function render(){
  const div = document.getElementById('orcamento')
  if(!div) return

  div.innerHTML = ''

  if(!modelos.length){
    div.innerHTML = '<div class="empty-state">Nenhum modelo foi adicionado ao orçamento ainda.</div>'
    renderItens()
    calc()
    return
  }

  modelos.forEach((m, index) => {
    const card = document.createElement('div')
    card.className = 'card_modelo'

    const itensHtml = (m.itens || []).map(item => {
      const badge = item.incluido_no_modelo
        ? `<span style="font-size:11px;background:#e8f0fe;color:#4a67a1;border-radius:4px;padding:1px 6px;margin-left:4px;">incluído</span>`
        : ''
      const valorStr = item.incluido_no_modelo
        ? `<span style="font-size:12px;color:#4a67a1;">— incluído</span>`
        : `<span>${moeda(centsToReais(item.valor_cents))}</span>`
      return `
        <div style="display:flex;justify-content:space-between;gap:12px;margin:6px 0;align-items:center;">
          <span>${escapeHtml(item.nome)}${badge}</span>
          ${valorStr}
        </div>
      `
    }).join('')

    const modeloRef = modelosDisponiveis.find(md => String(md.id) === String(m.model_id) || md.name === m.modelo)
    const descricao = modeloRef?.descricaoModelo || ''
    const itensIncluidosRef = Array.isArray(modeloRef?.itensIncluidos) ? modeloRef.itensIncluidos.filter(Boolean) : []

    const ativoHtml = ativo === m
      ? `<div style="font-size:12px;color:#4a67a1;margin-bottom:6px;">Modelo ativo</div>`
      : ''
    const descHtml = descricao
      ? `<div style="font-size:12px;color:#555;margin-bottom:6px;line-height:1.4;">${escapeHtml(descricao)}</div>`
      : ''
    const incluidoResumoHtml = itensIncluidosRef.length
      ? `<div style="font-size:12px;color:#4a67a1;margin-bottom:8px;"><strong>Incluso:</strong> ${escapeHtml(itensIncluidosRef.join(' / '))}</div>`
      : ''

    card.innerHTML = `
      ${ativoHtml}
      <div style="font-weight:700;margin-bottom:4px;">
        ${escapeHtml(m.modelo)} — ${Number(m.metragem || 0).toFixed(2)} m
      </div>
      ${descHtml}
      ${incluidoResumoHtml}
      <div style="display:flex;justify-content:space-between;gap:12px;margin:6px 0;">
        <span>Modelo base</span>
        <span>${moeda(centsToReais(m.preco_cents))}</span>
      </div>
      ${itensHtml}
      <hr>
      <div style="display:flex;justify-content:space-between;gap:12px;font-weight:700;">
        <span>Subtotal</span>
        <span>${moeda(centsToReais(subtotalCents(m)))}</span>
      </div>
      <div class="obs-modelo-footer" onclick="event.stopPropagation()">
        <label style="font-size:12px;color:#888;display:block;margin-top:10px;margin-bottom:3px;">Observação deste modelo</label>
        <textarea
          data-obs-index="${index}"
          rows="2"
          placeholder="Ex: Retirar o pé direito, entregar na loja..."
          style="width:100%;box-sizing:border-box;resize:vertical;font-family:inherit;font-size:13px;padding:6px 8px;border:1px solid #d0d8e8;border-radius:6px;background:#f8faff;color:#333;"
        >${escapeHtml(m.observacao || '')}</textarea>
      </div>
    `

    card.style.cursor = 'pointer'
    card.onclick = async () => {
      ativo = modelos[index]
      updateModeloAtivo()
      renderItens()
      await refreshItemSelect()
      render()
    }

    const obsTextarea = card.querySelector(`[data-obs-index="${index}"]`)
    if(obsTextarea){
      obsTextarea.addEventListener('input', () => {
        modelos[index].observacao = obsTextarea.value
      })
    }

    div.appendChild(card)
  })

  renderItens()
  calc()
}

function calc(){
  const totalCents = modelos.reduce((sum, model) => sum + subtotalCents(model), 0)
  const total = centsToReais(totalCents)

  const vista = document.getElementById('vista')
  const cartao = document.getElementById('cartao')
  // nfvista removido
  // nfcartao removido

  if(vista) vista.innerText = moeda(total * 1.10)
  if(cartao) cartao.innerText = moeda(total * 1.20)
  // nfvista removido
  // nfcartao removido
}

function addModelo(){
  const select = document.getElementById('modelo')
  const selectedModel = getSelectedRealModel()
  const baseInfo = getBaseSelectionForNewModel()

  const modelName = selectedModel?.name || String(select?.selectedOptions?.[0]?.textContent || select?.value || 'Modelo').trim()

  if(!baseInfo.meters || !baseInfo.priceCents){
    ui().warning('Selecione uma metragem válida antes de adicionar o modelo.')
    return
  }

  const imageDataUrl = selectedModel?.imageDataUrl || selectedModel?.image_data_url || ''

  const observacaoEl = document.getElementById('observacao')
  const observacao = observacaoEl?.value.trim() || ''

  const obj = {
    model_id: selectedModel?.id || null,
    modelo: modelName,
    preco_cents: baseInfo.priceCents,
    preco: centsToReais(baseInfo.priceCents),
    metragem: Number(baseInfo.meters).toFixed(2),
    image_data_url: imageDataUrl,
    imageDataUrl,
    itens: [],
    observacao
  }

  if(observacaoEl) observacaoEl.value = ''

  modelos.push(obj)
  ativo = obj
  updateModeloAtivo()
  render()
  refreshItemSelect()
}

function addItem(){
  if(!ativo){
    ui().warning('Adicione um modelo antes de incluir itens.')
    return
  }

  const select = document.getElementById('item')
  if(!select) return

  const option = select.options[select.selectedIndex]
  if(!option || !option.value){
    ui().warning('Selecione um item para adicionar.')
    return
  }

  const nome = String(
    option.dataset.name ||
    option.textContent ||
    'Item'
  ).replace(/\s+—\s+.*$/, '').trim()

  const isIncluido = option.dataset.incluido === '1'

  const valueCents = isIncluido
    ? 0
    : (Number(option.dataset.valueCents || 0) || Math.round(parseLooseNumber(option.value) * 100))

  if(!valueCents && !isIncluido){
    ui().warning('Esse item não tem valor válido.')
    return
  }

  ativo.itens.push({
    nome,
    unit: option.dataset.unit || 'unidade',
    valor_cents: valueCents,
    valor: centsToReais(valueCents),
    incluido_no_modelo: isIncluido
  })

  renderItens()
  render()
}

function remItem(index){
  if(!ativo) return
  if(index < 0 || index >= ativo.itens.length) return

  ativo.itens.splice(index, 1)
  renderItens()
  render()
}

function buildDraftQuote(status = 'orcamento'){
  const cliente     = document.getElementById('cliente')?.value.trim()    || 'Cliente'
  const telefone    = document.getElementById('telefone')?.value.trim()   || ''
  const endereco    = document.getElementById('endereco')?.value.trim()   || ''
  const observacao  = document.getElementById('observacao')?.value.trim() || ''

  const payloadModelos = modelos.map(model => {
    const subtotal_modelo_cents = subtotalCents(model)
    const modeloRef = modelosDisponiveis.find(md => String(md.id) === String(model.model_id) || md.name === model.modelo)
    const descricao = modeloRef?.descricaoModelo || ''
    const itensIncluidosRef = Array.isArray(modeloRef?.itensIncluidos) ? modeloRef.itensIncluidos.filter(Boolean) : []

    return {
      model_id: model.model_id || null,
      modelo: model.modelo,
      descricao,
      description: descricao,
      itens_incluidos: itensIncluidosRef,
      preco: centsToReais(model.preco_cents),
      preco_cents: model.preco_cents,
      metragem: Number(model.metragem || 0).toFixed(2),
      image_data_url: model.image_data_url || model.imageDataUrl || '',
      imageDataUrl: model.imageDataUrl || model.image_data_url || '',
      itens: (model.itens || []).map(item => ({
        nome: item.nome,
        unit: item.unit || 'unidade',
        valor: centsToReais(item.valor_cents),
        valor_cents: item.valor_cents,
        incluido_no_modelo: item.incluido_no_modelo || false
      })),
      observacao: model.observacao || '',
      obs: model.observacao || '',
      subtotal: centsToReais(subtotal_modelo_cents),
      subtotal_cents: subtotal_modelo_cents
    }
  })

  const totalCents = payloadModelos.reduce((sum, model) => sum + model.subtotal_cents, 0)
  const total = centsToReais(totalCents)

  return {
    id: ultimoSalvo?.id,
    cliente,
    status,
    total_cents: totalCents,
    payload: {
      cliente,
      telefone,
      endereco,
      observacao,
      modelos: payloadModelos,
      total,
      total_cents: totalCents,
      totais: {
        vista: Number((total * 1.10).toFixed(2)),
        cartao: Number((total * 1.20).toFixed(2))
      },
      created_at_local: new Date().toLocaleString('pt-BR')
    }
  }
}

function limparFormularioAposSalvar(){
  modelos = []
  ativo = null

  const cliente      = document.getElementById('cliente')
  const telefone     = document.getElementById('telefone')
  const endereco     = document.getElementById('endereco')
  const observacao   = document.getElementById('observacao')
  const metragemManual = document.getElementById('metragemManual')
  const previewManual  = document.getElementById('previewManual')
  const listaItens   = document.getElementById('listaItens')
  const orcamento    = document.getElementById('orcamento')

  if(cliente)      cliente.value    = ''
  if(telefone)     telefone.value   = ''
  if(endereco)     endereco.value   = ''
  if(observacao)   observacao.value = ''
  if(metragemManual) metragemManual.value = ''
  if(previewManual)  previewManual.innerText = ''
  if(listaItens)   listaItens.innerHTML = ''
  if(orcamento)    orcamento.innerHTML  = ''

  const modeloSelect = document.getElementById('modelo')
  const metragemRapida = document.getElementById('metragemRapida')
  const itemSelect = document.getElementById('item')

  if(modeloSelect) modeloSelect.selectedIndex = 0
  buildQuickOptionsFromModel(getSelectedRealModel())
  if(metragemRapida) metragemRapida.selectedIndex = 0
  if(itemSelect) itemSelect.selectedIndex = 0

  updateModeloAtivo()
  calc()
  refreshItemSelect()
}

async function salvar(){
  if(!modelos.length){
    await ui().alert('Adicione pelo menos um modelo.', { title: 'Orçamento incompleto' })
    return
  }

  const draft = buildDraftQuote('orcamento')

  return ui().runButtonAction('sellerSaveQuoteBtn', async () => {
    try{
      const response = await apiFetch('/quotes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cliente: draft.cliente,
          status: 'orcamento',
          total_cents: draft.total_cents,
          payload: draft.payload
        })
      })

      ultimoSalvo = response
      limparFormularioAposSalvar()
      ui().success('Orçamento salvo no servidor.')
    }catch(e){
      console.error(e)
      ui().error('Não consegui salvar no servidor. ' + (e.message || e))
    }
  }, { loadingText: 'Salvando...' })
}

async function baixarPdfAtual(){
  if(!modelos.length){
    await ui().alert('Monte um orçamento antes.', { title: 'Orçamento incompleto' })
    return
  }

  if(!window.VendedorPDF || typeof window.VendedorPDF.downloadQuotePdf !== 'function'){
    ui().error('O gerador de PDF não está disponível nesta página.')
    return
  }

  // Abre janela antes de qualquer await para garantir abertura em iOS/Android
  window._pendingPdfWindow = window.open('', '_blank')

  return ui().runButtonAction('sellerPdfBtn', async () => {
    try{
      await window.VendedorPDF.downloadQuotePdf(buildDraftQuote('orcamento'), 'orcamento')
      ui().success('PDF visualizado com sucesso.')
    }catch(e){
      if(window._pendingPdfWindow){ window._pendingPdfWindow.close(); window._pendingPdfWindow = null }
      console.error(e)
      ui().error('Não consegui visualizar o PDF.')
    }
  }, { loadingText: 'Visualizando PDF...' })
}

async function enviarPdfAtual(){
  if(!modelos.length){
    await ui().alert('Monte um orçamento antes.', { title: 'Orçamento incompleto' })
    return
  }

  if(!window.VendedorPDF || typeof window.VendedorPDF.shareQuotePdf !== 'function'){
    ui().error('O envio de PDF não está disponível nesta página.')
    return
  }

  return ui().runButtonAction('sellerShareBtn', async () => {
    try{
      await window.VendedorPDF.shareQuotePdf(buildDraftQuote('orcamento'), 'orcamento')
      ui().success('PDF pronto para envio.')
    }catch(e){
      console.error(e)
      ui().error('Não consegui enviar o PDF.')
    }
  }, { loadingText: 'Preparando envio...' })
}

async function onModelChange(){
  saveSharedActiveModel(getSelectedRealModel())
  buildQuickOptionsFromModel(getSelectedRealModel())
  calcManual()
  await refreshItemSelect(true)
}

async function init(){
  captureFallbackItemOptions()

  const metragemManual = document.getElementById('metragemManual')
  const metragemRapida = document.getElementById('metragemRapida')
  const modelo = document.getElementById('modelo')

  if(metragemManual){
    metragemManual.addEventListener('input', async () => {
      calcManual()
      if(!ativo) await refreshItemSelect()
    })
  }

  if(metragemRapida){
    metragemRapida.addEventListener('change', async () => {
      calcManual()
      if(!ativo) await refreshItemSelect()
    })
  }

  if(modelo){
    modelo.addEventListener('change', onModelChange)
  }

  updateModeloAtivo()
  calc()

  await loadModelosReais()
  calcManual()
  await refreshItemSelect(true)

  window.addEventListener('focus', async () => {
    await loadModelosReais()
    clearPersonalizationCache()
    refreshItemSelect(true)
  })

  document.addEventListener('visibilitychange', async () => {
    if(document.visibilityState === 'visible'){
      await loadModelosReais()
      clearPersonalizationCache()
      refreshItemSelect(true)
    }
  })

  window.addEventListener('storage', async (event) => {
    if(!event.key) return
    if(
      event.key === STORAGE_SHARED_MODELS ||
      event.key === STORAGE_CATALOGO_MODELS ||
      event.key === STORAGE_ITENS_MODELS_CACHE ||
      event.key === STORAGE_GLOBAL_PERSONALIZATION_ITEMS ||
      event.key.startsWith(STORAGE_ITENS_CACHE_PREFIX) ||
      event.key.startsWith(STORAGE_LOCAL_PERSONALIZATION_PREFIX)
    ){
      await loadModelosReais()
      clearPersonalizationCache()
      refreshItemSelect(true)
    }
  })
}

window.addModelo = addModelo
window.addItem = addItem
window.remItem = remItem
window.salvar = salvar
window.baixarPdfAtual = baixarPdfAtual
window.enviarPdfAtual = enviarPdfAtual
window.filtrarItens = filtrarItens

window.addEventListener('load', init)
