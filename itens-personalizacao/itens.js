// ── Estado ────────────────────────────────────────────────────────────────────
let modelos = []
let itens = []
let modeloSelecionado = ''   // '' = Itens gerais
let categoriaAtiva = 'todos'

// ── Chaves de storage ─────────────────────────────────────────────────────────
const ALBUMS_KEY            = 'esd_albums_v1'
const GLOBAL_ITEMS_COLS_KEY = 'esd_itens_cols_v1'
const GLOBAL_ITEMS_KEY      = 'itens_personalizacao_global_v1'
const GLOBAL_TAG_ID         = ''
const DEFAULT_API_BASE      = 'https://estofaria-api.onrender.com'
const STORAGE_MODELS_KEYS   = ['catalogo_modelos','precificacao_modelos','modelos','models']
const STORAGE_MATERIAL_KEYS = ['materiais','materials','catalogo_materiais','material_cache']
const STORAGE_MATERIAL_UNIT_KEYS = ['estofaria_material_units_v1','material_units','materiais_unidades']
const STORAGE_ACTIVE_MODEL  = 'estofaria_modelo_ativo_v1'

// ── Utilitários ───────────────────────────────────────────────────────────────
function el(id){ return document.getElementById(id) }

function escapeHtml(value){
  return String(value ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#039;')
}

function normalizeBaseUrl(base){ return String(base || '').trim().replace(/\/+$/,'') }

function parseCurrencyToCents(value){
  const digits = String(value || '').replace(/\D/g,'')
  return Number(digits || 0)
}

function formatBRLFromCents(cents){
  return (Number(cents || 0) / 100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})
}

function formatCurrency(input){
  if(!input) return
  input.value = formatBRLFromCents(parseCurrencyToCents(input.value))
}

function parseLooseNumber(value, fallback = 0){
  if(typeof value === 'number') return Number.isFinite(value) ? value : fallback
  if(value === null || value === undefined) return fallback
  let s = String(value).trim()
  if(!s) return fallback
  s = s.replace(/R\$/gi,'').replace(/\s+/g,'')
  const hasComma = s.includes(','), hasDot = s.includes('.')
  if(hasComma && hasDot){
    s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g,'').replace(',','.') : s.replace(/,/g,'')
  }else if(hasComma){ s = s.replace(',','.') }
  s = s.replace(/[^\d.\-]/g,'')
  const n = Number(s)
  return Number.isFinite(n) ? n : fallback
}

function formatQuantity(value){
  const n = parseLooseNumber(value, 0)
  return n.toLocaleString('pt-BR',{minimumFractionDigits: n % 1 === 0 ? 0 : 2, maximumFractionDigits:2})
}

function getCatLabel(cat){
  const m = {tecido:'🧵 Tecido', espuma:'🧽 Espuma', pe:'🦶 Pé', outro:'➕ Outro'}
  return m[cat] || '➕ Outro'
}

function getCatBadgeClass(cat){
  const m = {tecido:'cat-tecido', espuma:'cat-espuma', pe:'cat-pe', outro:'cat-outro'}
  return m[cat] || 'cat-outro'
}

// ── API ───────────────────────────────────────────────────────────────────────
function getApiCandidates(){
  const allowOverride = Boolean(window.ESTOFARIA_ALLOW_API_OVERRIDE)
  return [...new Set([
    normalizeBaseUrl(window.API_BASE),
    allowOverride ? normalizeBaseUrl(localStorage.getItem('estofaria_api_base')) : '',
    DEFAULT_API_BASE
  ].filter(Boolean))]
}

function buildApiUrl(base, path){ return `${normalizeBaseUrl(base)}/api${path}` }

async function fetchJsonWithTimeout(url, options = {}, timeoutMs = 8000){
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try{ return await fetch(url, {...options, signal: controller.signal}) }
  finally{ clearTimeout(timer) }
}

async function apiJson(path, options = {}, timeoutMs = 8000){
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try{
    const r = await fetch(`${normalizeBaseUrl(window.API_BASE)}/api${path}`, {
      headers:{Accept:'application/json', ...(options.headers || {})},
      cache:'no-store', ...options, signal: controller.signal
    })
    const data = await r.json().catch(() => ({}))
    if(!r.ok) throw new Error(data?.message || data?.error || `Falha em ${path}`)
    return data
  } finally{ clearTimeout(timer) }
}

async function fetchItemsFromApi(modelId){
  if(!modelId) return []
  try{
    const data = await apiJson(`/models/${encodeURIComponent(modelId)}/personalization-items?ts=${Date.now()}`)
    return normalizeStoredItems(Array.isArray(data) ? data : (Array.isArray(data?.items) ? data.items : []))
  }catch(e){ console.error('Falha ao carregar itens do servidor:', e); return [] }
}

async function createItemOnApi(modelId, item){
  return apiJson(`/models/${encodeURIComponent(modelId)}/personalization-items`,{
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({name:item.name, unit:item.unit, price_cents:Number(item.price_cents||0), consumos:item.consumos||{}, values:{padrao:Number(item.price_cents||0)}})
  })
}

async function updateItemOnApi(modelId, item){
  if(!modelId || !item?.id) return item
  return apiJson(`/models/${encodeURIComponent(modelId)}/personalization-items/${encodeURIComponent(item.id)}`,{
    method:'PUT', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({name:item.name, unit:item.unit, price_cents:Number(item.price_cents||0), consumos:item.consumos||{}, values:{padrao:Number(item.price_cents||0)}})
  })
}

async function deleteItemOnApi(modelId, itemId){
  if(!modelId || !itemId) return {ok:true}
  return apiJson(`/models/${encodeURIComponent(modelId)}/personalization-items/${encodeURIComponent(itemId)}`,{method:'DELETE'})
}

// ── Storage — Modelos ─────────────────────────────────────────────────────────
function normalizeModel(model, index = 0){
  const name = String(model?.name || model?.nome || `Modelo ${index+1}`).trim()
  const id   = String(model?.id   || model?._id  || name)
  return {id, name}
}

function readListFromStorage(key){
  try{
    const raw = JSON.parse(localStorage.getItem(key) || '[]')
    return Array.isArray(raw) ? raw : (Array.isArray(raw?.items) ? raw.items : (Array.isArray(raw?.models) ? raw.models : []))
  }catch{ return [] }
}

function readModelsFromStorage(key){
  return readListFromStorage(key).map((item,i) => normalizeModel(item,i)).filter(item => item.name)
}

function mergeUniqueModels(...lists){
  const seen = new Set(), merged = []
  lists.flat(Infinity).forEach((item,i) => {
    const model = normalizeModel(item,i)
    const key = String(model.id||model.name).toLowerCase()
    if(!model.name || seen.has(key)) return
    seen.add(key); merged.push(model)
  })
  return merged
}

function getSharedActiveModel(){
  try{
    const raw = JSON.parse(localStorage.getItem(STORAGE_ACTIVE_MODEL) || '{}')
    if(raw && (raw.id || raw.name)) return normalizeModel(raw, 0)
  }catch{}
  return null
}

function saveSharedModelsCache(lista){
  try{ localStorage.setItem('catalogo_modelos', JSON.stringify(lista)) }catch{}
  try{ localStorage.setItem('precificacao_modelos', JSON.stringify(lista)) }catch{}
  try{ localStorage.setItem('modelos', JSON.stringify(lista)) }catch{}
}

async function fetchModelsFromApi(){
  const http = window.ESTOFARIA_HTTP
  for(const base of getApiCandidates()){
    try{
      const url = buildApiUrl(base, '/models?ts='+Date.now())
      let data
      if(http && typeof http.fetchJson === 'function'){
        data = await http.fetchJson(url, { cache:'no-store', timeoutMs:8000 })
      }else{
        const r = await fetchJsonWithTimeout(url, {headers:{Accept:'application/json'},cache:'no-store'})
        if(!r.ok) continue
        data = await r.json()
      }
      const arr = Array.isArray(data) ? data : (Array.isArray(data?.models) ? data.models : [])
      const normalized = arr.map((item,i) => normalizeModel(item,i)).filter(item => item.name)
      if(normalized.length){ saveSharedModelsCache(normalized); return normalized }
    }catch(e){ console.error('Falha ao carregar modelos:', e) }
  }
  return []
}

// ── Storage — Itens/Cols ──────────────────────────────────────────────────────
function normalizeStoredItems(arr){
  if(!Array.isArray(arr)) return []
  return arr.map(item => ({
    id: item?.id ?? null,
    name: String(item?.name || '').trim(),
    unit: String(item?.unit || item?.unidade || 'unidade').trim() || 'unidade',
    price_cents: Number(item?.price_cents ?? item?.value_cents ?? item?.valor_cents ?? item?.values?.padrao ?? 0) || parseCurrencyToCents(item?.valor || item?.price || 0),
    consumos: item?.consumos && typeof item.consumos === 'object' ? {...item.consumos} : {},
    category: item?.category || 'outro'
  })).filter(item => item.name)
}

function loadGlobalCols(){
  try{
    const raw = JSON.parse(localStorage.getItem(GLOBAL_ITEMS_COLS_KEY) || '[]')
    return Array.isArray(raw) ? raw.filter(c => c?.name).map(c => ({
      id: c.id || null,
      name: String(c.name).trim(),
      unit: String(c.unit || 'unidade').trim(),
      price_cents: Number(c.price_cents || 0),
      category: c.category || 'outro',
      isAlbum: c.isAlbum || false
    })) : []
  }catch{ return [] }
}

function saveGlobalCols(cols){
  localStorage.setItem(GLOBAL_ITEMS_COLS_KEY, JSON.stringify(
    (Array.isArray(cols) ? cols : []).map(c => ({
      id: c.id || null, name: c.name, unit: c.unit,
      price_cents: Number(c.price_cents || 0),
      category: c.category || 'outro',
      isAlbum: c.isAlbum || false
    }))
  ))
}

// ── Storage — Consumos ────────────────────────────────────────────────────────
function getConsumosKey(modelId){
  if(!modelId || modelId === GLOBAL_TAG_ID) return 'esd_consumos_global'
  return `esd_consumos_${modelId}`
}

function loadModelConsumos(modelId){
  try{
    const raw = JSON.parse(localStorage.getItem(getConsumosKey(modelId)) || '{}')
    return (typeof raw === 'object' && raw !== null) ? raw : {}
  }catch{ return {} }
}

function saveModelConsumos(modelId, consumosMap){
  localStorage.setItem(getConsumosKey(modelId), JSON.stringify(consumosMap || {}))
}

function buildConsumosMap(items){
  const map = {}
  items.forEach(item => {
    if(item.consumos && Object.keys(item.consumos).length > 0)
      map[item.name.toLowerCase()] = item.consumos
  })
  return map
}

// ── Storage — Itens legacy ────────────────────────────────────────────────────
function getItemsKey(modelKey){
  return modelKey === GLOBAL_ITEMS_KEY ? GLOBAL_ITEMS_KEY : `itens_${modelKey}`
}

function getLegacyTableKey(modelKey){
  return modelKey === GLOBAL_ITEMS_KEY ? `tabela_${GLOBAL_ITEMS_KEY}` : `tabela_${modelKey}`
}

function applyLegacyTable(modelKey, itemsList){
  try{
    const tabela = JSON.parse(localStorage.getItem(getLegacyTableKey(modelKey)) || '{}')
    if(!tabela || typeof tabela !== 'object') return itemsList
    Object.entries(tabela).forEach(([metragem, colunas]) => {
      if(!Array.isArray(colunas)) return
      colunas.forEach((valor, index) => {
        if(!itemsList[index]) return
        itemsList[index].consumos[metragem] = parseLooseNumber(valor, 0)
      })
    })
  }catch{}
  return itemsList
}

function loadLocalItems(modelKey){
  if(!modelKey) return []
  const raw = readListFromStorage(getItemsKey(modelKey))
  return applyLegacyTable(modelKey, normalizeStoredItems(raw))
}

function saveLocalItems(modelKey, itemsList){
  if(!modelKey) return
  const payload = (Array.isArray(itemsList) ? itemsList : []).map(item => ({
    id: item?.id ?? null, name: item.name, unit: item.unit,
    price_cents: Number(item.price_cents || 0),
    consumos: item.consumos || {},
    category: item.category || 'outro'
  }))
  localStorage.setItem(getItemsKey(modelKey), JSON.stringify(payload))
}

// ── Storage — Metragens (NOVO) ────────────────────────────────────────────────
function getMetragensKey(modelId){
  return `esd_metragens_${modelId || 'global'}`
}

function loadMetragens(modelId){
  try{
    const raw = JSON.parse(localStorage.getItem(getMetragensKey(modelId)) || '[]')
    return Array.isArray(raw) ? raw.filter(m => m) : []
  }catch{ return [] }
}

function saveMetragens(modelId, lista){
  localStorage.setItem(getMetragensKey(modelId), JSON.stringify(lista || []))
}

// ── Migração ──────────────────────────────────────────────────────────────────
function migrateToGlobalCols(){
  if(loadGlobalCols().length > 0) return
  const seen = new Set(), cols = []
  const tryMigrate = (items, modelId) => {
    items.forEach(item => {
      if(item.name && !seen.has(item.name.toLowerCase())){
        seen.add(item.name.toLowerCase())
        cols.push({id:item.id||null, name:item.name, unit:item.unit, price_cents:item.price_cents, category:item.category||'outro'})
      }
      if(modelId && Object.keys(item.consumos||{}).length > 0){
        const map = loadModelConsumos(modelId)
        map[item.name.toLowerCase()] = item.consumos
        saveModelConsumos(modelId, map)
      }
    })
  }
  tryMigrate(loadLocalItems(GLOBAL_ITEMS_KEY), 'global')
  STORAGE_MODELS_KEYS.forEach(key => {
    try{
      const list = JSON.parse(localStorage.getItem(key) || '[]')
      if(!Array.isArray(list)) return
      list.forEach(m => {
        const id = m?.id || m?.name
        if(!id) return
        tryMigrate(loadLocalItems(String(id)), String(id))
      })
    }catch{}
  })
  if(cols.length > 0) saveGlobalCols(cols)
}

// ── Unidades ──────────────────────────────────────────────────────────────────
function extractUnitsFromMaterials(arr){
  const set = new Set()
  ;(Array.isArray(arr) ? arr : []).forEach(item => {
    const unit = String(item?.unit || item?.unidade || '').trim().toLowerCase()
    if(unit) set.add(unit)
  })
  return [...set]
}

function readUnitsFromStorageKey(key){
  try{
    const raw = JSON.parse(localStorage.getItem(key) || '[]')
    const arr = Array.isArray(raw) ? raw : (Array.isArray(raw?.units) ? raw.units : [])
    return arr.map(u => String(u||'').trim().toLowerCase()).filter(Boolean)
  }catch{ return [] }
}

async function carregarUnidades(){
  const select = el('unidade')
  if(!select) return
  const units = new Set()
  STORAGE_MATERIAL_UNIT_KEYS.forEach(key => readUnitsFromStorageKey(key).forEach(u => units.add(u)))
  STORAGE_MATERIAL_KEYS.forEach(key => extractUnitsFromMaterials(readListFromStorage(key)).forEach(u => units.add(u)))
  for(const base of getApiCandidates()){
    try{
      const r = await fetchJsonWithTimeout(buildApiUrl(base, '/materials?ts='+Date.now()),{headers:{Accept:'application/json'},cache:'no-store'})
      if(!r.ok) continue
      const data = await r.json()
      const arr = Array.isArray(data) ? data : (Array.isArray(data?.materials) ? data.materials : [])
      extractUnitsFromMaterials(arr).forEach(u => units.add(u))
      break
    }catch(e){ console.error('Falha ao carregar unidades:', e) }
  }
  select.innerHTML = ''
  const orderedUnits = [...units].sort((a,b) => a.localeCompare(b,'pt-BR'))
  if(!orderedUnits.length){
    const opt = document.createElement('option')
    opt.value = ''; opt.textContent = 'Cadastre unidades na aba Material'; opt.selected = true
    select.appendChild(opt); select.disabled = true; return
  }
  select.disabled = false
  orderedUnits.forEach((unit,i) => {
    const opt = document.createElement('option')
    opt.value = unit; opt.textContent = unit
    if(i === 0) opt.selected = true
    select.appendChild(opt)
  })
}

function carregarUnidadesModalAlbum(valorAtual){
  const select = el('modalAlbumUnidade')
  if(!select) return
  const units = new Set()
  STORAGE_MATERIAL_UNIT_KEYS.forEach(key => readUnitsFromStorageKey(key).forEach(u => units.add(u)))
  STORAGE_MATERIAL_KEYS.forEach(key => extractUnitsFromMaterials(readListFromStorage(key)).forEach(u => units.add(u)))
  const ordered = [...units].sort((a,b) => a.localeCompare(b,'pt-BR'))
  select.innerHTML = '<option value="">— sem unidade —</option>'
  ordered.forEach(unit => {
    const opt = document.createElement('option')
    opt.value = unit; opt.textContent = unit
    select.appendChild(opt)
  })
  if(valorAtual){
    if(!units.has(valorAtual)){
      const opt = document.createElement('option')
      opt.value = valorAtual; opt.textContent = valorAtual
      select.appendChild(opt)
    }
    select.value = valorAtual
  }
}

// ── Badge e visibilidade dos cards ────────────────────────────────────────────
function getNomeModeloAtual(){
  if(modeloSelecionado === GLOBAL_TAG_ID) return '📋 Geral'
  const found = modelos.find(m => String(m.id) === modeloSelecionado)
  return found ? `📌 ${found.name}` : `📌 ${modeloSelecionado}`
}

function renderModeloBadge(){
  const nome = modeloSelecionado !== '' ? getNomeModeloAtual() : ''
  const b4 = el('modeloBadge4')
  if(b4) b4.textContent = nome
}

function renderCardsVisibility(){
  // Nada a fazer — layout simplificado com overlay
}

// ── Seleção de modelo ─────────────────────────────────────────────────────────
function getSelectedModelId(){ return modeloSelecionado }
function canPersistItemsToApi(){ return !!getSelectedModelId() }

async function carregarModelos(){
  const container = el('modelosContainer')
  if(container) container.innerHTML = '<span class="modelos-loading">Carregando modelos...</span>'

  const localLists = STORAGE_MODELS_KEYS.map(readModelsFromStorage)
  const activeModel = getSharedActiveModel()
  const apiModels = await fetchModelsFromApi()

  modelos = mergeUniqueModels(apiModels, localLists, activeModel ? [activeModel] : [])

  if(activeModel && modelos.length){
    const found = modelos.find(m => String(m.id) === String(activeModel.id))
    if(found) modeloSelecionado = String(found.id)
  }

  renderModelosSelecionaveis(modelos)
  await carregarItensSalvos()
}

function renderModelosSelecionaveis(lista){
  const select = el('modeloSelect')
  if(!select) return

  select.innerHTML = '<option value="">— Selecione um modelo —</option>'
  lista.forEach(modelo => {
    const opt = document.createElement('option')
    opt.value = String(modelo.id)
    opt.textContent = modelo.name
    select.appendChild(opt)
  })

  select.value = modeloSelecionado || ''
}

async function selecionarModeloDoSelect(value){
  modeloSelecionado = value || GLOBAL_TAG_ID
  // Auto-inicializa range de metragens se o modelo não tem nenhuma ainda
  if(modeloSelecionado && modeloSelecionado !== GLOBAL_TAG_ID && loadMetragens(modeloSelecionado).length === 0)
    saveMetragens(modeloSelecionado, gerarRangeMetragens(METRAGEM_DEFAULT_MIN, METRAGEM_DEFAULT_MAX))
  renderModeloBadge()
  renderCardsVisibility()
  renderMetragens()
  await carregarItensSalvos()
}

// ── Metragens (NOVO) ──────────────────────────────────────────────────────────
function renderMetragens(){
  const container = el('metragensList')
  if(!container) return
  const lista = loadMetragens(modeloSelecionado)
  if(!lista.length){
    container.innerHTML = '<span class="metragens-empty">Nenhuma metragem configurada para este modelo.</span>'
    return
  }
  container.innerHTML = lista.map(m => `
    <div class="metragem-chip">
      <span>${escapeHtml(m)}m</span>
      <button type="button" class="chip-remove" onclick="removerMetragem('${escapeHtml(m)}')" title="Remover">×</button>
    </div>
  `).join('')
}

function adicionarMetragem(){
  const input = el('novaMetragem')
  const val = String(input?.value || '').trim().replace(',','.')
  const n = parseFloat(val)
  if(!Number.isFinite(n) || n <= 0){
    alert('Informe uma metragem válida, ex: 1.60')
    input?.focus()
    return
  }
  const str = n.toFixed(2)
  const lista = loadMetragens(modeloSelecionado)
  if(lista.includes(str)){
    alert('Essa metragem já foi adicionada.')
    if(input) input.value = ''
    return
  }
  lista.push(str)
  lista.sort((a,b) => parseFloat(a) - parseFloat(b))
  saveMetragens(modeloSelecionado, lista)
  if(input) input.value = ''
  renderMetragens()
  renderTabela()
}

function removerMetragem(val){
  const lista = loadMetragens(modeloSelecionado).filter(m => m !== val)
  saveMetragens(modeloSelecionado, lista)
  renderMetragens()
  renderTabela()
}

const METRAGEM_STEP = 0.1
const METRAGEM_DEFAULT_MIN = 1.0
const METRAGEM_DEFAULT_MAX = 5.0

function gerarRangeMetragens(min, max){
  const lista = []
  for(let m = min; m <= max + 0.001; m += METRAGEM_STEP)
    lista.push((Math.round(m * 10) / 10).toFixed(1))
  return lista
}

function usarMetragensDefault(){
  if(modeloSelecionado === GLOBAL_TAG_ID) return
  saveMetragens(modeloSelecionado, gerarRangeMetragens(METRAGEM_DEFAULT_MIN, METRAGEM_DEFAULT_MAX))
  renderMetragens()
  renderTabela()
}

function aumentarMetragemRange(){
  if(!modeloSelecionado || modeloSelecionado === GLOBAL_TAG_ID) return
  const lista = loadMetragens(modeloSelecionado).map(Number).filter(n => !isNaN(n)).sort((a,b)=>a-b)
  const max = lista.length ? lista[lista.length-1] : METRAGEM_DEFAULT_MAX
  const novoMax = Math.round((max + METRAGEM_STEP) * 10) / 10
  const novoStr = novoMax.toFixed(1)
  const strs = lista.map(n => n.toFixed(1))
  if(!strs.includes(novoStr)) strs.push(novoStr)
  saveMetragens(modeloSelecionado, strs)
  renderMetragens()
  renderTabela()
}

function reduzirMetragemRange(){
  if(!modeloSelecionado || modeloSelecionado === GLOBAL_TAG_ID) return
  const lista = loadMetragens(modeloSelecionado).map(Number).filter(n => !isNaN(n)).sort((a,b)=>a-b)
  if(lista.length <= 1){ alert('Mínimo de 1 metragem.'); return }
  lista.pop()
  saveMetragens(modeloSelecionado, lista.map(n => n.toFixed(1)))
  renderMetragens()
  renderTabela()
}

// ── Lista de itens (NOVO) ─────────────────────────────────────────────────────
function getCatCounts(){
  const counts = {todos: itens.length, tecido:0, espuma:0, pe:0, outro:0}
  itens.forEach(i => { const c = i.category || 'outro'; if(counts[c] !== undefined) counts[c]++ })
  return counts
}

function renderCatTabs(){
  const counts = getCatCounts()
  const labels = {todos:'Todos', tecido:'Tecidos', espuma:'Espumas', pe:'Pés', outro:'Outros'}
  document.querySelectorAll('.cat-tab').forEach(btn => {
    const cat = btn.dataset.cat
    const n = counts[cat] ?? 0
    btn.textContent = n > 0 ? `${labels[cat]} (${n})` : labels[cat]
  })
}

function filtrarCategoria(cat){
  categoriaAtiva = cat
  document.querySelectorAll('.cat-tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.cat === cat)
  })
  renderItensLista()
}

function renderItensLista(){
  const container = el('itensLista')
  if(!container) return
  renderCatTabs()
  const semAlbuns = itens.filter(i => !i.isAlbum)
  const filtrados = categoriaAtiva === 'todos'
    ? semAlbuns
    : semAlbuns.filter(i => (i.category || 'outro') === categoriaAtiva)

  if(!filtrados.length){
    container.innerHTML = `<div class="itens-lista-empty">${
      categoriaAtiva === 'todos'
        ? 'Nenhum item cadastrado ainda.'
        : `Nenhum item na categoria "${getCatLabel(categoriaAtiva)}".`
    }</div>`
    return
  }

  container.innerHTML = filtrados.map(item => {
    const realIndex = itens.indexOf(item)
    const cat = item.category || 'outro'
    return `<div class="item-card">
      <span class="item-cat-badge ${getCatBadgeClass(cat)}">${getCatLabel(cat)}</span>
      <div class="item-info">
        <div class="item-info-name">${escapeHtml(item.name)}</div>
        <div class="item-info-meta">${escapeHtml(item.unit)} · ${formatBRLFromCents(item.price_cents)}</div>
      </div>
      <button class="item-delete-btn" onclick="excluirItem(${realIndex})" title="Remover item">×</button>
    </div>`
  }).join('')
}

// ── Álbuns ────────────────────────────────────────────────────────────────────
function gerarIdAlbum(){ return 'alb_' + Date.now() + '_' + Math.random().toString(36).slice(2,7) }
function loadAlbums(){
  try{ const raw = JSON.parse(localStorage.getItem(ALBUMS_KEY) || '[]'); return Array.isArray(raw) ? raw : [] }catch{ return [] }
}
function saveAlbums(lista){
  try{ localStorage.setItem(ALBUMS_KEY, JSON.stringify(lista)) }catch{}
}

let _modalAlbumId = null
let _modalTecidos = []

const ALBUM_CORES = ['#3f5fa3','#16a34a','#dc2626','#9333ea','#d97706','#0891b2','#be185d','#059669','#b45309','#1d4ed8']

function renderAlbums(){
  const container = el('albumsSection')
  if(!container) return
  const albums = loadAlbums()
  if(!albums.length){
    container.innerHTML = '<p class="albums-empty">Nenhum álbum ainda. Clique em "+ Novo" para criar o primeiro.</p>'
    return
  }
  const opts = albums.map(a => {
    const count = a.itens ? a.itens.length : 0
    return `<option value="${escapeHtml(a.id)}">${escapeHtml(a.nome)} · ${count} tecido${count !== 1 ? 's' : ''}</option>`
  }).join('')
  container.innerHTML = `
    <div class="album-selector-wrap">
      <select id="albumSelectorSelect" class="album-selector-select"
        onchange="if(this.value){ abrirModalAlbum(this.value); this.value='' }">
        <option value="">Selecione um álbum para abrir ou editar…</option>
        ${opts}
      </select>
    </div>
  `
}

function autoAdicionarAlbumNaTabela(album){
  if(!album) return
  if(itens.some(i => i.name.toLowerCase() === album.nome.toLowerCase())) return
  itens.push({name:album.nome, unit:album.unidade||'álbum', price_cents:Math.round(Number(album.custo||0)*100), consumos:{}, category:'tecido', isAlbum:true})
  saveGlobalCols(itens.map(({id,name,unit,price_cents,category,isAlbum}) => ({id,name,unit,price_cents,category,isAlbum})))
  renderItensLista()
  renderTabela()
}

function adicionarAlbumNaTabela(albumId){
  const album = loadAlbums().find(a => a.id === albumId)
  if(!album){ alert('Álbum não encontrado.'); return }
  if(itens.some(i => i.name.toLowerCase() === album.nome.toLowerCase())){
    alert(`"${album.nome}" já está na tabela de consumo.`); return
  }
  autoAdicionarAlbumNaTabela(album)
  alert(`"${album.nome}" adicionado à tabela de consumo.`)
}

function abrirModalAlbum(albumId = null){
  _modalAlbumId = albumId || null
  _modalTecidos = []
  const albums = loadAlbums()
  const album = albumId ? albums.find(a => a.id === albumId) : null
  const titulo = el('modalAlbumTitulo')
  if(titulo) titulo.textContent = album ? 'Editar álbum' : 'Novo álbum'
  if(album){
    if(el('modalAlbumNome')) el('modalAlbumNome').value = album.nome || ''
    if(el('modalAlbumCusto')) el('modalAlbumCusto').value = album.custo > 0 ? formatBRLFromCents(Math.round(album.custo*100)) : ''
    carregarUnidadesModalAlbum(album.unidade || '')
    _modalTecidos = (album.itens||[]).map(t => ({nome:t.nome||'', codigo:t.codigo||''}))
  }else{
    if(el('modalAlbumNome')) el('modalAlbumNome').value = ''
    if(el('modalAlbumCusto')) el('modalAlbumCusto').value = ''
    carregarUnidadesModalAlbum('')
    _modalTecidos = []
  }
  renderTecidosModal()
  el('modalAlbumOverlay').style.display = 'flex'
}

function fecharModalAlbum(){
  el('modalAlbumOverlay').style.display = 'none'
  _modalAlbumId = null; _modalTecidos = []
}

function renderTecidosModal(){
  const container = el('modalTecidosList')
  if(!container) return
  if(!_modalTecidos.length){
    container.innerHTML = '<p style="margin:0 0 8px;font-size:13px;opacity:.55;">Nenhum tecido adicionado.</p>'
    return
  }
  container.innerHTML = _modalTecidos.map((t,i) => `
    <div style="display:flex;align-items:center;gap:6px;margin-bottom:7px;">
      <input placeholder="Nome do tecido" value="${escapeHtml(t.nome)}"
        oninput="_modalTecidos[${i}].nome=this.value"
        style="flex:1;padding:7px 10px;border:1px solid #ccc;border-radius:8px;font-size:13px;">
      <input placeholder="Código *" value="${escapeHtml(t.codigo)}"
        oninput="_modalTecidos[${i}].codigo=this.value"
        style="width:100px;padding:7px 10px;border:1px solid #ccc;border-radius:8px;font-size:13px;">
      <button type="button" onclick="removerTecidoModal(${i})"
        style="border:none;background:none;color:#e74c3c;cursor:pointer;font-size:18px;line-height:1;padding:2px 4px;">×</button>
    </div>
  `).join('')
}

function adicionarTecidoModal(){
  _modalTecidos.push({nome:'', codigo:''})
  renderTecidosModal()
  const inputs = el('modalTecidosList')?.querySelectorAll('input')
  if(inputs && inputs.length) inputs[inputs.length-2]?.focus()
}

function removerTecidoModal(index){
  _modalTecidos.splice(index,1)
  renderTecidosModal()
}

function salvarAlbumDoModal(){
  const nome = String(el('modalAlbumNome')?.value||'').trim()
  const custoRaw = String(el('modalAlbumCusto')?.value||'').trim()
  const unidade = String(el('modalAlbumUnidade')?.value||'').trim()
  if(!nome){ alert('Informe o nome do álbum.'); el('modalAlbumNome')?.focus(); return }
  const custoCents = parseCurrencyToCents(custoRaw)
  const custo = custoCents/100
  const tecidosSalvos = _modalTecidos.filter(t => t.nome.trim()||t.codigo.trim()).map(t => ({nome:t.nome.trim(), codigo:t.codigo.trim()}))
  const albums = loadAlbums()
  let nomeAntigo = null
  if(_modalAlbumId){
    const idx = albums.findIndex(a => a.id === _modalAlbumId)
    if(idx >= 0){ nomeAntigo = albums[idx].nome; albums[idx] = {...albums[idx], nome, custo, unidade, itens:tecidosSalvos, updatedAt:new Date().toISOString()} }
  }else{
    albums.push({id:gerarIdAlbum(), nome, custo, unidade, itens:tecidosSalvos, createdAt:new Date().toISOString(), updatedAt:new Date().toISOString()})
  }
  saveAlbums(albums)
  if(nomeAntigo !== null){
    sincronizarAlbumNasTabelas(nomeAntigo, nome, custo, unidade)
  } else {
    // álbum novo → entra automaticamente na tabela
    const novoAlbum = loadAlbums().find(a => a.nome === nome)
    autoAdicionarAlbumNaTabela(novoAlbum)
  }
  fecharModalAlbum()
  renderAlbums()
  renderAlbumSelectParaItem()
}

function sincronizarAlbumNasTabelas(nomeAntigo, nomeNovo, novoCusto, novaUnidade){
  const novoPriceCents = Math.round(Number(novoCusto||0)*100)
  const nomeBusca = nomeAntigo.toLowerCase()
  const cols = loadGlobalCols()
  let colAtualizada = false
  const novasCols = cols.map(col => {
    if(col.name.toLowerCase() === nomeBusca){ colAtualizada = true; return {...col, name:nomeNovo, price_cents:novoPriceCents, unit:novaUnidade||col.unit} }
    return col
  })
  if(colAtualizada) saveGlobalCols(novasCols)
  const consumosKeysToCheck = ['esd_consumos_global']
  STORAGE_MODELS_KEYS.forEach(storageKey => {
    try{
      const list = JSON.parse(localStorage.getItem(storageKey)||'[]')
      if(Array.isArray(list)) list.forEach(m => { const id = m?.id||m?.name; if(id) consumosKeysToCheck.push(`esd_consumos_${id}`) })
    }catch{}
  })
  let linhasAtualizadas = 0
  ;[...new Set(consumosKeysToCheck)].forEach(ck => {
    try{
      const map = JSON.parse(localStorage.getItem(ck)||'{}')
      if(map[nomeBusca] !== undefined){
        map[nomeNovo.toLowerCase()] = map[nomeBusca]
        if(nomeNovo.toLowerCase() !== nomeBusca) delete map[nomeBusca]
        localStorage.setItem(ck, JSON.stringify(map)); linhasAtualizadas++
      }
    }catch{}
  })
  itens.forEach(item => {
    if(item.name.toLowerCase() === nomeBusca){ item.name = nomeNovo; item.price_cents = novoPriceCents; item.unit = novaUnidade||item.unit }
  })
  if(colAtualizada || linhasAtualizadas > 0){
    renderItensLista()
    renderTabela()
    if(linhasAtualizadas > 0) alert(`Álbum atualizado em ${linhasAtualizadas} tabela(s) de consumo.`)
  }
}

function excluirAlbum(id){
  if(!confirm('Excluir este álbum?')) return
  saveAlbums(loadAlbums().filter(a => a.id !== id))
  renderAlbums()
}

// ── Tabela de consumo ─────────────────────────────────────────────────────────
function getConsumo(item, metragem){
  return parseLooseNumber(item?.consumos?.[metragem], 0)
}

function renderTabela(){
  const header = el('headerRow')
  const body   = el('bodyRows')
  if(!header || !body) return

  header.innerHTML = '<th class="metragem-col">Metragem</th>'
  body.innerHTML = ''

  if(!itens.length){
    body.innerHTML = '<tr><td class="empty-state" colspan="2">Nenhum item cadastrado. Adicione um item para montar a tabela de consumo.</td></tr>'
    return
  }

  itens.forEach((item, index) => {
    const th = document.createElement('th')
    th.className = 'item-head'
    th.innerHTML = `
      <div class="item-head-inner">
        <div class="item-menu-wrap">
          <button type="button" class="menu-dots" onclick="openItemMenu(event,${index})">⋮</button>
        </div>
        <div class="item-name">${escapeHtml(item.name)}</div>
        <div class="item-unit">${escapeHtml(item.unit)}</div>
        <div class="item-price">${formatBRLFromCents(item.price_cents||0)}</div>
      </div>`
    header.appendChild(th)
  })

  const metragens = loadMetragens(modeloSelecionado)
  if(!metragens.length){
    body.innerHTML = `<tr><td class="empty-state" colspan="${itens.length+1}">Configure as metragens do modelo no Card 4 para preencher a tabela.</td></tr>`
    return
  }

  metragens.forEach(metragem => {
    const tr = document.createElement('tr')
    const tdM = document.createElement('td')
    tdM.className = 'metragem-cell'
    tdM.textContent = metragem + 'm'
    tr.appendChild(tdM)
    itens.forEach((item, index) => {
      const td = document.createElement('td')
      td.className = 'qty-cell'
      const val = getConsumo(item, metragem)
      const hasVal = val > 0 ? ' has-value' : ''
      td.innerHTML = `<input class="qty-input${hasVal}" inputmode="decimal" value="${escapeHtml(formatQuantity(val))}" onblur="atualizarConsumo(${index},'${metragem}',this.value)" oninput="this.className='qty-input'+(parseFloat(this.value.replace(',','.'))||0)>0?' has-value':''>"` 
      tr.appendChild(td)
    })
    body.appendChild(tr)
  })
}

async function atualizarConsumo(index, metragem, value){
  const item = itens[index]
  if(!item) return
  item.consumos = item.consumos || {}
  item.consumos[metragem] = parseLooseNumber(value, 0)
  const consumosKey = getSelectedModelId() || 'global'
  const consumosMap = loadModelConsumos(consumosKey)
  consumosMap[item.name.toLowerCase()] = item.consumos
  saveModelConsumos(consumosKey, consumosMap)
  if(canPersistItemsToApi() && item?.id){
    try{ await updateItemOnApi(getSelectedModelId(), item) }catch(e){ console.error(e) }
  }
}

// ── CRUD de itens ─────────────────────────────────────────────────────────────
function renderAlbumSelectParaItem(){
  const select = el('albumItem')
  if(!select) return
  const albums = loadAlbums()
  const current = select.value
  select.innerHTML = '<option value="">— Sem álbum —</option>'
  albums.forEach(a => {
    const opt = document.createElement('option')
    opt.value = a.id
    opt.textContent = a.nome
    select.appendChild(opt)
  })
  if(current) select.value = current
}

function preencherValorDoAlbum(select){
  const albumId = select?.value
  if(!albumId) return
  const album = loadAlbums().find(a => a.id === albumId)
  if(!album) return
  const custoInput = el('valorItem')
  if(custoInput && album.custo > 0)
    custoInput.value = formatBRLFromCents(Math.round(album.custo * 100))
}

async function adicionarItem(){
  const modelId = getSelectedModelId()
  const nome = String(el('nomeItem')?.value||'').trim()
  const albumId = String(el('albumItem')?.value||'')
  const price_cents = parseCurrencyToCents(el('valorItem')?.value||'')

  if(!nome){ alert('Digite o nome do item.'); el('nomeItem')?.focus(); return }

  // Item com álbum → vai para o álbum, não para a tabela
  if(albumId){
    const albums = loadAlbums()
    const idx = albums.findIndex(a => a.id === albumId)
    if(idx < 0){ alert('Álbum não encontrado.'); return }
    albums[idx].itens = albums[idx].itens || []
    if(albums[idx].itens.some(t => t.nome.toLowerCase() === nome.toLowerCase())){
      alert('Esse item já existe dentro do álbum.'); return
    }
    albums[idx].itens.push({nome, codigo:''})
    saveAlbums(albums)
    el('nomeItem').value = ''
    el('valorItem').value = ''
    el('albumItem').value = ''
    renderAlbums()
    return
  }

  // Item sem álbum → vai para a tabela
  if(itens.some(i => i.name.toLowerCase() === nome.toLowerCase())){ alert('Esse item já existe.'); return }

  let unit = 'unidade', category = 'outro'

  try{
    let item = {name:nome, unit, price_cents, consumos:{}, category}
    if(canPersistItemsToApi()){
      item = normalizeStoredItems([await createItemOnApi(modelId, item)])[0] || item
    }
    item.category = category
    itens.push(item)
    saveGlobalCols(itens.map(({id,name,unit,price_cents,category,isAlbum}) => ({id,name,unit,price_cents,category,isAlbum})))
    el('nomeItem').value = ''
    el('valorItem').value = ''
    if(el('albumItem')) el('albumItem').value = ''
    renderItensLista()
    renderTabela()
  }catch(e){
    console.error(e)
    alert('Não foi possível adicionar o item agora: ' + e.message)
  }
}

async function editarItem(index){
  closeFloatingMenu()
  const item = itens[index]
  if(!item) return
  const novoNome = prompt('Novo nome do item:', item.name)
  if(novoNome === null) return
  const novaUnidade = prompt('Nova unidade:', item.unit)
  if(novaUnidade === null) return
  const novoValor = prompt('Novo valor:', formatBRLFromCents(item.price_cents||0))
  if(novoValor === null) return
  item.name = String(novoNome||'').trim() || item.name
  item.unit = String(novaUnidade||'').trim() || item.unit
  item.price_cents = parseCurrencyToCents(novoValor)
  try{
    if(canPersistItemsToApi()){
      const updated = await updateItemOnApi(getSelectedModelId(), item)
      itens[index] = {...normalizeStoredItems([updated])[0], category:item.category}  || item
    }
    saveGlobalCols(itens.map(({id,name,unit,price_cents,category,isAlbum}) => ({id,name,unit,price_cents,category,isAlbum})))
    renderItensLista()
    renderTabela()
  }catch(e){ console.error(e); alert('Não foi possível salvar a edição: ' + e.message) }
}

async function excluirItem(index){
  closeFloatingMenu()
  if(!confirm('Excluir item?')) return
  const item = itens[index]
  try{
    if(canPersistItemsToApi() && item?.id) await deleteItemOnApi(getSelectedModelId(), item.id)
    itens.splice(index, 1)
    saveGlobalCols(itens.map(({id,name,unit,price_cents,category,isAlbum}) => ({id,name,unit,price_cents,category,isAlbum})))
    renderItensLista()
    renderTabela()
  }catch(e){ console.error(e); alert('Não foi possível excluir o item: ' + e.message) }
}

// ── Menu flutuante ────────────────────────────────────────────────────────────
let activeMenuIndex = null

function ensureFloatingMenu(){
  let menu = el('floatingItemMenu')
  if(menu) return menu
  menu = document.createElement('div')
  menu.id = 'floatingItemMenu'
  menu.className = 'floating-item-menu'
  menu.innerHTML = `
    <button type="button" onclick="handleEditFromMenu()">Editar</button>
    <button type="button" class="danger" onclick="handleDeleteFromMenu()">Excluir</button>`
  menu.addEventListener('click', e => e.stopPropagation())
  document.body.appendChild(menu)
  return menu
}

function closeFloatingMenu(){
  const menu = el('floatingItemMenu')
  if(menu) menu.classList.remove('open')
  activeMenuIndex = null
}

function openItemMenu(event, index){
  if(event) event.stopPropagation()
  const menu = ensureFloatingMenu()
  const button = event?.currentTarget || event?.target
  if(!button) return
  activeMenuIndex = index
  menu.classList.add('open')
  const rect = button.getBoundingClientRect()
  const menuWidth = 132, menuHeight = 90
  const top = rect.bottom + 6 + menuHeight > window.innerHeight ? Math.max(8, rect.top - menuHeight - 6) : rect.bottom + 6
  const left = rect.right - menuWidth < 8 ? 8 : rect.right - menuWidth
  menu.style.top = `${top}px`
  menu.style.left = `${left}px`
}

function handleEditFromMenu(){ if(activeMenuIndex === null) return; const i = activeMenuIndex; closeFloatingMenu(); editarItem(i) }
function handleDeleteFromMenu(){ if(activeMenuIndex === null) return; const i = activeMenuIndex; closeFloatingMenu(); excluirItem(i) }

// ── Carregar / Salvar tabela ──────────────────────────────────────────────────
async function carregarItensSalvos(){
  migrateToGlobalCols()
  const modelId = getSelectedModelId()
  const consumosKey = modelId || 'global'
  let cols = loadGlobalCols()
  const consumosMap = loadModelConsumos(consumosKey)

  if(canPersistItemsToApi() && modelId){
    try{
      const apiItems = await fetchItemsFromApi(modelId)
      if(apiItems.length){
        const normalized = normalizeStoredItems(apiItems)
        normalized.forEach(apiItem => {
          const idx = cols.findIndex(c => c.name.toLowerCase() === apiItem.name.toLowerCase())
          if(idx >= 0){
            cols[idx] = {id:apiItem.id, name:apiItem.name, unit:apiItem.unit, price_cents:apiItem.price_cents, category:cols[idx].category||apiItem.category||'outro'}
            if(Object.keys(apiItem.consumos||{}).length > 0 && !consumosMap[apiItem.name.toLowerCase()])
              consumosMap[apiItem.name.toLowerCase()] = apiItem.consumos
          }else{
            cols.push({id:apiItem.id, name:apiItem.name, unit:apiItem.unit, price_cents:apiItem.price_cents, category:apiItem.category||'outro'})
          }
        })
        saveGlobalCols(cols)
        saveModelConsumos(consumosKey, consumosMap)
      }
    }catch(e){ console.error('API items:', e) }
  }

  itens = cols.map(col => ({
    ...col,
    consumos: consumosMap[col.name.toLowerCase()] || {}
  }))

  renderModeloBadge()
  renderCardsVisibility()
  renderItensLista()
  renderTabela()
}

function abrirTabela(){
  if(!modeloSelecionado){
    alert('Selecione um modelo primeiro.')
    return
  }
  const overlay = el('tabelaOverlay')
  if(!overlay) return
  const nomeEl = el('tabelaModeloNome')
  if(nomeEl) nomeEl.textContent = getNomeModeloAtual()
  renderTabela()
  overlay.style.display = 'flex'
  document.body.style.overflow = 'hidden'
}

function fecharTabela(){
  const overlay = el('tabelaOverlay')
  if(overlay) overlay.style.display = 'none'
  document.body.style.overflow = ''
}

async function salvarTabela(){
  const modelId = getSelectedModelId()
  const consumosKey = modelId || 'global'

  saveModelConsumos(consumosKey, buildConsumosMap(itens))
  saveGlobalCols(itens.map(({id,name,unit,price_cents,category,isAlbum}) => ({id,name,unit,price_cents,category,isAlbum})))

  if(!modelId || modelId === GLOBAL_TAG_ID){
    saveLocalItems(GLOBAL_ITEMS_KEY, itens)
    renderItensLista()
    renderTabela()
    fecharTabela()
    alert('Tabela salva!')
    return
  }

  try{
    const saved = []
    for(const item of itens){
      if(item?.id) saved.push(await updateItemOnApi(modelId, item))
      else saved.push(await createItemOnApi(modelId, item))
    }
    const normalizedItems = normalizeStoredItems(saved)
    normalizedItems.forEach(apiItem => {
      const cols = loadGlobalCols()
      const idx = cols.findIndex(c => c.name.toLowerCase() === apiItem.name.toLowerCase())
      if(idx >= 0){ cols[idx].id = apiItem.id; saveGlobalCols(cols) }
    })
    itens = normalizedItems.map((apiItem,i) => ({...apiItem, category: itens[i]?.category || apiItem.category || 'outro', consumos: itens[i]?.consumos || {}}))
    renderItensLista()
    fecharTabela()
    alert('Tabela salva com sucesso!')
  }catch(e){
    console.error(e)
    saveLocalItems(modelId, itens)
    fecharTabela()
    alert('Salvo localmente. Será sincronizado depois: ' + e.message)
  }
}

// ── Eventos globais ───────────────────────────────────────────────────────────
window.addEventListener('click', closeFloatingMenu)
window.addEventListener('resize', closeFloatingMenu)
window.addEventListener('scroll', closeFloatingMenu, true)

// ── Init ──────────────────────────────────────────────────────────────────────
let __itensInitDone = false
async function initItensPersonalizacao(){
  if(__itensInitDone) return
  __itensInitDone = true
  renderModeloBadge()
  renderCardsVisibility()
  renderMetragens()
  renderAlbums()
  renderAlbumSelectParaItem()
  await carregarModelos()
}

window.addEventListener('DOMContentLoaded', initItensPersonalizacao)
window.addEventListener('load', initItensPersonalizacao)

// Atualiza modelos quando outra aba (precificação/catálogo) salva no localStorage
window.addEventListener('storage', e => {
  if(e.key && STORAGE_MODELS_KEYS.includes(e.key)){
    fetchModelsFromApi().then(apiModels => {
      const localLists = STORAGE_MODELS_KEYS.map(readModelsFromStorage)
      modelos = mergeUniqueModels(apiModels, localLists)
      renderModelosSelecionaveis(modelos)
    })
  }
})

// ── Exports (para HTML inline) ────────────────────────────────────────────────
window.formatCurrency       = formatCurrency
window.filtrarCategoria     = filtrarCategoria
window.selecionarModeloDoSelect  = selecionarModeloDoSelect
window.preencherValorDoAlbum     = preencherValorDoAlbum
window.removerMetragem       = removerMetragem
window.usarMetragensDefault  = usarMetragensDefault
window.aumentarMetragemRange = aumentarMetragemRange
window.reduzirMetragemRange  = reduzirMetragemRange
window.adicionarItem        = adicionarItem
window.editarItem           = editarItem
window.excluirItem          = excluirItem
window.atualizarConsumo     = atualizarConsumo
window.salvarTabela         = salvarTabela
window.openItemMenu         = openItemMenu
window.handleEditFromMenu   = handleEditFromMenu
window.handleDeleteFromMenu = handleDeleteFromMenu
window.abrirTabela          = abrirTabela
window.fecharTabela         = fecharTabela
window.abrirModalAlbum      = abrirModalAlbum
window.fecharModalAlbum     = fecharModalAlbum
window.salvarAlbumDoModal   = salvarAlbumDoModal
window.adicionarTecidoModal = adicionarTecidoModal
window.removerTecidoModal   = removerTecidoModal
window.excluirAlbum         = excluirAlbum
window.adicionarAlbumNaTabela = adicionarAlbumNaTabela
