const DEFAULT_API_BASE = 'https://estofaria-api.onrender.com'
let activeApiBase = ''

let modelos = []
let modeloAtualId = null
let itens = []
let tabelaTravada = false
let booted = false

const STORAGE_PREFS = 'itens_personalizacao_prefs_v2'
const STORAGE_CACHE_PREFIX = 'itens_personalizacao_cache_v2:'
const STORAGE_MODELS_CACHE = 'itens_personalizacao_models_cache_v1'
const STORAGE_SHARED_MODELS = 'precificacao_modelos'
const STORAGE_CATALOGO_MODELS = 'catalogo_modelos'
const STORAGE_ACTIVE_MODEL = 'estofaria_modelo_ativo_v1'
const STORAGE_CATALOGO_PREFS = 'catalogo_pref_v2'
const STORAGE_EXTRA_MODEL_KEYS = ['catalogo_modelos', 'modelos', 'models']

function el(id){
  return document.getElementById(id)
}

function pick(...values){
  for(const v of values){
    if(v !== undefined && v !== null && v !== '') return v
  }
  return undefined
}

function parseNumber(value, fallback = 0){
  if(typeof value === 'number') return Number.isFinite(value) ? value : fallback
  if(value === null || value === undefined) return fallback

  let s = String(value).trim()
  if(!s) return fallback

  s = s.replace(/R\$/gi, '').replace(/\s+/g, '')

  const hasComma = s.includes(',')
  const hasDot = s.includes('.')

  if(hasComma && hasDot){
    if(s.lastIndexOf(',') > s.lastIndexOf('.')){
      s = s.replace(/\./g, '').replace(',', '.')
    }else{
      s = s.replace(/,/g, '')
    }
  }else if(hasComma){
    s = s.replace(',', '.')
  }

  s = s.replace(/[^\d.-]/g, '')
  const n = Number(s)
  return Number.isFinite(n) ? n : fallback
}

function escapeHtml(value){
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function normalizeBaseUrl(base){
  return String(base || '').trim().replace(/\/+$/, '')
}

function resolveApiCandidates(){
  const candidates = [
    normalizeBaseUrl(activeApiBase),
    normalizeBaseUrl(window.API_BASE),
    normalizeBaseUrl(localStorage.getItem('estofaria_api_base')),
    DEFAULT_API_BASE
  ].filter(Boolean)

  return [...new Set(candidates)]
}

function buildApiUrl(base, path){
  return normalizeBaseUrl(base) + '/api' + path
}

function persistWorkingApi(base){
  const normalized = normalizeBaseUrl(base)
  if(!normalized) return
  activeApiBase = normalized
  try{
    localStorage.setItem('estofaria_api_base', normalized)
  }catch{}
}

async function apiGet(path){
  let lastError = null

  for(const base of resolveApiCandidates()){
    const url = buildApiUrl(base, path)
    try{
      const r = await fetch(url, {
        headers: { 'Accept': 'application/json' },
        cache: 'no-store'
      })
      if(!r.ok) throw new Error('Falha ao carregar ' + path)
      const data = await r.json()
      persistWorkingApi(base)
      return data
    }catch(e){
      lastError = e
      console.error(e)
    }
  }

  throw (lastError || new Error('Falha ao carregar ' + path))
}

async function apiSend(path, method, body){
  let lastError = null

  for(const base of resolveApiCandidates()){
    const url = buildApiUrl(base, path)
    try{
      const r = await fetch(url, {
        method,
        headers:{ 'Content-Type':'application/json' },
        body: JSON.stringify(body)
      })
      if(!r.ok){
        const e = await r.json().catch(()=>({}))
        throw new Error(e.error || ('Falha em ' + method + ' ' + path))
      }
      persistWorkingApi(base)
      return r.json().catch(() => ({}))
    }catch(e){
      lastError = e
      console.error(e)
    }
  }

  throw (lastError || new Error('Falha em ' + method + ' ' + path))
}

function getCacheKey(modelId){
  return `${STORAGE_CACHE_PREFIX}${String(modelId || '')}`
}

function loadPrefs(){
  try{
    const raw = JSON.parse(localStorage.getItem(STORAGE_PREFS) || '{}')
    return raw && typeof raw === 'object' ? raw : {}
  }catch{
    return {}
  }
}

function loadSharedActiveModel(){
  try{
    const raw = JSON.parse(localStorage.getItem(STORAGE_ACTIVE_MODEL) || '{}')
    return raw && typeof raw === 'object' ? raw : {}
  }catch{
    return {}
  }
}

function loadCatalogoPrefs(){
  try{
    const raw = JSON.parse(localStorage.getItem(STORAGE_CATALOGO_PREFS) || '{}')
    return raw && typeof raw === 'object' ? raw : {}
  }catch{
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
      source: 'itens-personalizacao',
      savedAt: Date.now()
    }))
  }catch{}
}

function savePrefs(options = {}){
  localStorage.setItem(STORAGE_PREFS, JSON.stringify({
    modeloId: String(modeloAtualId || '')
  }))
  const model = modelos.find(item => String(item.id) === String(modeloAtualId)) || null
  if(model){
    saveSharedActiveModel(model)
  }else if(options.clearSharedActive === true){
    saveSharedActiveModel(null)
  }
}

function saveLocalCache(modelId, lista){
  if(!modelId) return
  localStorage.setItem(getCacheKey(modelId), JSON.stringify({
    items: normalizeItems(lista),
    savedAt: Date.now()
  }))
}

function loadLocalCache(modelId){
  if(!modelId) return []
  try{
    const raw = JSON.parse(localStorage.getItem(getCacheKey(modelId)) || '{}')
    const arr = Array.isArray(raw?.items) ? raw.items : []
    return normalizeItems(arr)
  }catch{
    return []
  }
}

function normalizeModel(model, index = 0){
  const baseMeters = Math.max(0, parseNumber(pick(
    model?.base_meters,
    model?.baseMeters,
    model?.base_metragem,
    model?.metragem_base,
    model?.base
  ), 0))

  let salePriceCents = Math.max(0, Math.round(parseNumber(pick(
    model?.sale_price_cents,
    model?.salePriceCents,
    model?.preco_venda_cents,
    model?.venda_cents,
    model?.price_cents,
    model?.valor_cents
  ), 0)))

  if(!salePriceCents){
    salePriceCents = parseCurrencyToCents(pick(
      model?.sale_price,
      model?.salePrice,
      model?.preco_venda,
      model?.venda,
      model?.price,
      model?.valor
    ))
  }

  let pricePerMeterCents = Math.max(0, Math.round(parseNumber(pick(
    model?.price_per_meter_cents,
    model?.valor_metro_cents,
    model?.sale_price_per_meter_cents
  ), 0)))

  if(!pricePerMeterCents){
    pricePerMeterCents = parseCurrencyToCents(pick(
      model?.price_per_meter,
      model?.valor_metro,
      model?.sale_price_per_meter
    ))
  }

  if(!pricePerMeterCents && salePriceCents && baseMeters > 0){
    pricePerMeterCents = Math.round(salePriceCents / baseMeters)
  }

  return {
    id: String(pick(model?.id, model?._id, `modelo-${index + 1}`)),
    name: String(pick(model?.name, model?.nome, `Modelo ${index + 1}`)),
    base_meters: baseMeters,
    sale_price_cents: salePriceCents,
    price_per_meter_cents: pricePerMeterCents
  }
}

function saveModelosCache(lista){
  const normalized = (Array.isArray(lista) ? lista : [])
    .map((model, index) => normalizeModel(model, index))
    .filter(model => model.name)

  try{
    localStorage.setItem(STORAGE_MODELS_CACHE, JSON.stringify(normalized))
  }catch{}

  try{
    localStorage.setItem(STORAGE_SHARED_MODELS, JSON.stringify(normalized))
  }catch{}

  try{
    localStorage.setItem(STORAGE_CATALOGO_MODELS, JSON.stringify(normalized))
  }catch{}
}

function readModelListFromStorage(key){
  try{
    const raw = JSON.parse(localStorage.getItem(key) || '[]')
    const arr = Array.isArray(raw) ? raw : (Array.isArray(raw?.models) ? raw.models : [])
    return arr.map((model, index) => normalizeModel(model, index)).filter(model => model.name)
  }catch{
    return []
  }
}

function mergeUniqueModels(...lists){
  const seen = new Set()
  const merged = []

  lists.flat(Infinity).forEach((model, index) => {
    const normalized = normalizeModel(model, index)
    const id = String(normalized.id || '')
    const name = String(normalized.name || '').trim()
    const key = `${id}::${name.toLowerCase()}`
    if(!name || seen.has(key)) return
    seen.add(key)
    merged.push(normalized)
  })

  return merged
}

function setModeloStatus(message){
  const select = el('modeloSelect')
  if(!select) return
  select.innerHTML = `<option value="">${escapeHtml(message)}</option>`
}

function getModeloAtivoCompartilhado(){
  const shared = loadSharedActiveModel()
  if(shared && (shared.id || shared.name)){
    return normalizeModel({ id: shared.id, name: shared.name })
  }

  const prefs = loadCatalogoPrefs()
  const localLists = mergeUniqueModels(
    readModelListFromStorage(STORAGE_MODELS_CACHE),
    readModelListFromStorage(STORAGE_SHARED_MODELS),
    readModelListFromStorage(STORAGE_CATALOGO_MODELS),
    STORAGE_EXTRA_MODEL_KEYS.map(key => readModelListFromStorage(key))
  )

  const preferido = String(prefs.modelo || '').trim()
  if(preferido){
    const encontrado = localLists.find(model => String(model.id) === preferido || String(model.name).trim().toLowerCase() === preferido.toLowerCase())
    if(encontrado) return encontrado
  }

  return null
}

function loadModelosFallback(){
  const own = readModelListFromStorage(STORAGE_MODELS_CACHE)
  const shared = readModelListFromStorage(STORAGE_SHARED_MODELS)
  const extras = STORAGE_EXTRA_MODEL_KEYS.map(key => readModelListFromStorage(key))
  const ativo = getModeloAtivoCompartilhado()
  return mergeUniqueModels(own, shared, extras, ativo ? [ativo] : [])
}

function normalizeItemValues(values, fallbackCents = 0){
  const result = {}

  if(values && typeof values === 'object'){
    Object.entries(values).forEach(([key, value]) => {
      if(key === 'padrao'){
        result.padrao = Math.max(0, Math.round(parseNumber(value, 0)))
        return
      }

      if(/^\d+(\.\d+)?$/.test(String(key))){
        result[Number(key).toFixed(2)] = Math.max(0, Math.round(parseNumber(value, 0)))
      }
    })
  }

  if(result.padrao === undefined && fallbackCents > 0){
    result.padrao = fallbackCents
  }

  return result
}

function normalizeItems(arr){
  if(!Array.isArray(arr)) return []

  return arr
    .map((item, index) => {
      const name = String(pick(item?.name, item?.nome, `Item ${index + 1}`)).trim()
      const unit = String(pick(item?.unit, item?.unidade, 'unidade')).trim() || 'unidade'
      const fallbackCents = Math.max(0, Math.round(parseNumber(pick(item?.default_cents, item?.value_cents, item?.valor_cents), 0)))
      return {
        name,
        unit,
        values: normalizeItemValues(item?.values || {}, fallbackCents)
      }
    })
    .filter(item => item.name)
}

function gerarMetragens(){
  const lista = []
  for(let i = 10; i <= 500; i += 10){
    lista.push((i / 100).toFixed(2))
  }
  return lista
}

function parseCurrencyToCents(v){
  if(!v) return 0
  const digits = String(v).replace(/\D/g, '')
  return Number(digits || 0)
}

function formatBRLFromCents(cents){
  return (Number(cents || 0) / 100).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  })
}

function formatCurrency(input){
  const cents = parseCurrencyToCents(input?.value || '')
  input.value = formatBRLFromCents(cents)
}

function formatCellCurrency(cell){
  const cents = parseCurrencyToCents(cell?.innerText || '0')
  cell.innerText = formatBRLFromCents(cents)
}

function getNearestValue(values, metragem){
  const keys = Object.keys(values || {}).filter(key => /^\d+(\.\d+)?$/.test(String(key)))
  if(!keys.length) return 0

  const target = Number(metragem || 0)
  let bestKey = keys[0]
  let bestDiff = Math.abs(Number(keys[0]) - target)

  keys.forEach(key => {
    const diff = Math.abs(Number(key) - target)
    if(diff < bestDiff){
      bestDiff = diff
      bestKey = key
    }
  })

  return Math.max(0, Math.round(parseNumber(values[bestKey], 0)))
}

function resolveItemValueCents(item, metragem){
  const values = item?.values || {}
  const key = Number(metragem || 0).toFixed(2)

  if(values[key] !== undefined && values[key] !== null){
    return Math.max(0, Math.round(parseNumber(values[key], 0)))
  }

  if(values.padrao !== undefined && values.padrao !== null){
    return Math.max(0, Math.round(parseNumber(values.padrao, 0)))
  }

  return getNearestValue(values, metragem)
}

function getTabelaValores(){
  const rows = document.querySelectorAll('#bodyRows tr')
  const valores = {}

  itens.forEach(item => {
    valores[item.name] = {}
    const padrao = Math.max(0, Math.round(parseNumber(item?.values?.padrao, 0)))
    if(padrao > 0){
      valores[item.name].padrao = padrao
    }
  })

  rows.forEach(row => {
    const cells = row.querySelectorAll('td')
    if(!cells.length) return
    const metragem = Number(parseNumber(cells[0].innerText || '0', 0)).toFixed(2)

    itens.forEach((item, index) => {
      const cell = cells[index + 1]
      if(!cell) return
      const cents = parseCurrencyToCents(cell.innerText || '0')
      valores[item.name][metragem] = cents
    })
  })

  return valores
}

function updateEmptyState(message){
  const body = el('bodyRows')
  if(body){
    body.innerHTML = `
      <tr>
        <td colspan="${Math.max(1, itens.length + 1)}" style="text-align:center; padding:16px;">
          ${escapeHtml(message)}
        </td>
      </tr>
    `
  }
}

function exibirTabela(){
  const body = el('bodyRows')
  if(!body) return

  if(!modeloAtualId){
    updateEmptyState('Selecione um modelo para montar a tabela.')
    return
  }

  body.innerHTML = ''

  gerarMetragens().forEach(m => {
    const tr = document.createElement('tr')
    const td = document.createElement('td')
    td.innerText = m
    tr.appendChild(td)

    itens.forEach(item => {
      const cell = document.createElement('td')
      const cents = resolveItemValueCents(item, m)
      cell.contentEditable = !tabelaTravada
      cell.innerText = formatBRLFromCents(cents)
      if(tabelaTravada) cell.classList.add('locked')
      cell.addEventListener('focus', () => {
        if(cell.innerText === 'R$ 0,00' || cell.innerText === 'R$ 0,00'){
          cell.innerText = ''
        }
      })
      cell.addEventListener('input', () => formatCellCurrency(cell))
      cell.addEventListener('blur', () => {
        if(!String(cell.innerText || '').trim()) cell.innerText = formatBRLFromCents(0)
        formatCellCurrency(cell)
      })
      tr.appendChild(cell)
    })

    body.appendChild(tr)
  })
}

function renderHeader(){
  const header = el('headerRow')
  if(!header) return

  header.innerHTML = '<th>Metragem</th>'

  itens.forEach((item, index) => {
    const th = document.createElement('th')
    th.innerHTML = `
      <div class="col-title">
        <span class="col-title-text">
          <strong>${escapeHtml(item.name)}</strong>
          <small>${escapeHtml(item.unit || 'unidade')}</small>
        </span>
        ${tabelaTravada ? '' : `<button type="button" class="delete-col-btn" onclick="deletarColuna(${index})">×</button>`}
      </div>
    `
    header.appendChild(th)
  })
}

function renderTudo(){
  renderHeader()
  exibirTabela()
}

function limparFormularioItem(){
  const nome = el('nomeItem')
  const valor = el('valorItem')
  const unidade = el('unidade')

  if(nome) nome.value = ''
  if(valor) valor.value = ''
  if(unidade) unidade.value = 'unidade'
}

function adicionarItem(){
  const input = el('nomeItem')
  const valorInput = el('valorItem')
  const unidadeSelect = el('unidade')

  const nome = String(input?.value || '').trim()
  const valorCents = parseCurrencyToCents(valorInput?.value || '')
  const unidade = String(unidadeSelect?.value || 'unidade').trim() || 'unidade'

  if(!nome){
    alert('Informe o nome do item.')
    input?.focus()
    return
  }

  if(itens.some(item => String(item.name).toLowerCase() === nome.toLowerCase())){
    alert('Esse item já existe para este modelo.')
    return
  }

  const novoItem = {
    name: nome,
    unit: unidade,
    values: valorCents > 0 ? { padrao: valorCents } : {}
  }

  itens.push(novoItem)
  limparFormularioItem()
  renderTudo()
}

function editarColuna(index){
  const atual = itens[index]
  if(!atual) return

  const novoNome = prompt('Novo nome do item:', atual.name)
  if(!novoNome) return

  atual.name = novoNome.trim() || atual.name
  renderTudo()
}

function deletarColuna(index){
  if(index < 0 || index >= itens.length) return
  if(!confirm('Excluir este item?')) return
  itens.splice(index, 1)
  renderTudo()
}

function preencherModelos(){
  const select = el('modeloSelect')
  if(!select) return

  const prefs = loadPrefs()
  const shared = loadSharedActiveModel()
  const catalogoPrefs = loadCatalogoPrefs()
  const preferido = String(shared.id || prefs.modeloId || catalogoPrefs.modelo || modeloAtualId || '')

  select.innerHTML = ''

  if(!modelos.length){
    const opt = document.createElement('option')
    opt.value = ''
    opt.textContent = 'Nenhum modelo encontrado'
    select.appendChild(opt)
    modeloAtualId = null
    localStorage.setItem(STORAGE_PREFS, JSON.stringify({ modeloId: '' }))
    renderTudo()
    return
  }

  modelos.forEach(modelo => {
    const opt = document.createElement('option')
    opt.value = String(modelo.id)
    opt.textContent = modelo.name
    select.appendChild(opt)
  })

  const existePreferido = modelos.some(modelo => String(modelo.id) === preferido)
  modeloAtualId = existePreferido ? preferido : String(modelos[0].id)
  select.value = String(modeloAtualId)
  savePrefs()
}

async function carregarModelos(){
  let apiLista = []
  setModeloStatus('Carregando modelos...')
  activeApiBase = normalizeBaseUrl(activeApiBase || window.API_BASE || localStorage.getItem('estofaria_api_base') || DEFAULT_API_BASE)

  for(let tentativa = 1; tentativa <= 3 && !apiLista.length; tentativa += 1){
    try{
      const data = await apiGet('/models?ts=' + Date.now())
      const arr = Array.isArray(data) ? data : (Array.isArray(data?.models) ? data.models : [])
      apiLista = arr.map((modelo, index) => normalizeModel(modelo, index)).filter(modelo => modelo.name)
      if(apiLista.length){
        saveModelosCache(apiLista)
      }
    }catch(e){
      console.error(e)
      apiLista = []
    }
  }

  const fallbackLista = loadModelosFallback()
  modelos = mergeUniqueModels(apiLista, fallbackLista)
  preencherModelos()

  if(modeloAtualId){
    await carregarItensModelo()
    return
  }

  itens = []
  renderTudo()
}

async function carregarItensModelo(){
  const select = el('modeloSelect')
  if(select && select.value){
    modeloAtualId = String(select.value)
    savePrefs()
  }

  if(!modeloAtualId){
    itens = []
    renderTudo()
    return
  }

  try{
    const data = await apiGet('/models/' + modeloAtualId + '/personalization-items')
    const loaded = normalizeItems(Array.isArray(data?.items) ? data.items : data)
    itens = loaded
    saveLocalCache(modeloAtualId, itens)
  }catch(e){
    console.error(e)
    itens = loadLocalCache(modeloAtualId)
  }

  renderTudo()
}

async function onModeloChange(){
  const select = el('modeloSelect')
  modeloAtualId = String(select?.value || '') || null
  tabelaTravada = false
  savePrefs()
  await carregarItensModelo()
}

async function salvarTabela(){
  if(!modeloAtualId){
    alert('Selecione um modelo.')
    return
  }

  const valores = getTabelaValores()
  const body = {
    items: itens.map(item => ({
      name: item.name,
      unit: item.unit || 'unidade',
      values: valores[item.name] || {}
    }))
  }

  try{
    await apiSend('/models/' + modeloAtualId + '/personalization-items', 'PUT', body)
    itens = normalizeItems(body.items)
    saveLocalCache(modeloAtualId, itens)
    renderTudo()
    alert('Tabela salva com sucesso.')
  }catch(e){
    console.error(e)
    itens = normalizeItems(body.items)
    saveLocalCache(modeloAtualId, itens)
    renderTudo()
    alert((e.message || 'Erro ao salvar no servidor.') + ' Mantive uma cópia local no navegador para não perder seus dados.')
  }
}

function initItensPersonalizacao(){
  const required = ['modeloSelect', 'headerRow', 'bodyRows', 'nomeItem', 'valorItem', 'unidade']
  const ready = required.every(id => el(id))
  if(!ready) return false
  if(booted) return true

  booted = true
  carregarModelos()
  return true
}

function waitItensReady(){
  if(initItensPersonalizacao()) return

  let tries = 0
  const timer = setInterval(() => {
    tries += 1
    if(initItensPersonalizacao() || tries > 120){
      clearInterval(timer)
    }
  }, 100)
}

window.initItensPersonalizacao = waitItensReady
window.adicionarItem = adicionarItem
window.editarColuna = editarColuna
window.deletarColuna = deletarColuna
window.salvarTabela = salvarTabela
window.formatCurrency = formatCurrency
window.exibirTabela = exibirTabela
window.onModeloChange = onModeloChange

waitItensReady()
window.addEventListener('load', waitItensReady)
document.addEventListener('visibilitychange', () => {
  if(document.visibilityState === 'visible'){
    carregarModelos()
  }
})

window.addEventListener('storage', (event) => {
  if([
    STORAGE_ACTIVE_MODEL,
    STORAGE_SHARED_MODELS,
    STORAGE_CATALOGO_MODELS,
    STORAGE_MODELS_CACHE,
    STORAGE_CATALOGO_PREFS
  ].includes(event.key)){
    carregarModelos()
  }
})
