const API = (window.API_BASE || '') + '/api'

let catalogoMateriais = []
let materiaisModelo = []
let modelos = []
let modeloEditandoId = null
let currentModelImageDataUrl = ''
let currentImageLoadPromise = null
let booted = false

function ui(){
  return window.ESTOFARIA_UI
}

const STORAGE_SHARED_MODELS = 'precificacao_modelos'
const STORAGE_CATALOGO_MODELS = 'catalogo_modelos'
const STORAGE_PRECIFICACAO_DRAFT = 'precificacao_draft_v1'

function resolveModelImageDataUrl(model){
  const value = model?.image_data_url ?? model?.imageDataUrl ?? model?.photo_data_url ?? model?.photoDataUrl ?? model?.foto_data_url ?? model?.fotoDataUrl ?? model?.image ?? model?.photo ?? model?.foto ?? ''
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeSharedModel(model, index = 0){
  const baseMeters = parseNumber(model?.base_meters ?? model?.baseMeters ?? model?.base_measure ?? model?.baseMeasure ?? model?.base_medida ?? model?.baseMedida)
  const spacingCm = parseNumber(model?.spacing_cm ?? model?.spacingCm ?? model?.espacamento_cm ?? model?.espacamentoCm ?? model?.spacing ?? model?.espacamento)
  const imageDataUrl = resolveModelImageDataUrl(model)

  return {
    id: model?.id ?? model?._id ?? `modelo-${index + 1}`,
    name: String(model?.name ?? model?.nome ?? `Modelo ${index + 1}`),
    base_meters: baseMeters > 0 ? baseMeters : 0,
    spacing_cm: spacingCm > 0 ? spacingCm : 10,
    total_cost_cents: Math.max(0, Math.round(Number(model?.total_cost_cents ?? model?.totalCostCents ?? model?.custo_total_cents ?? model?.custoTotalCents ?? 0) || 0)),
    target_profit_cents: Math.max(0, Math.round(Number(model?.target_profit_cents ?? model?.targetProfitCents ?? model?.lucro_desejado_cents ?? model?.lucroDesejadoCents ?? 0) || 0)),
    sale_price_cents: Math.max(0, Math.round(Number(model?.sale_price_cents ?? model?.salePriceCents ?? model?.valor_venda_cents ?? model?.valorVendaCents ?? model?.price_cents ?? 0) || 0)),
    created_at: model?.created_at ?? model?.createdAt ?? model?.date ?? model?.saved_at ?? '',
    updated_at: model?.updated_at ?? model?.updatedAt ?? model?.last_update ?? model?.lastUpdated ?? model?.modified_at ?? model?.modifiedAt ?? model?.created_at ?? model?.createdAt ?? '',
    image_data_url: imageDataUrl,
    imageDataUrl,
    foto_data_url: imageDataUrl,
    fotoDataUrl: imageDataUrl,
    materials: Array.isArray(model?.materials) ? model.materials : [],
    itens_incluidos: Array.isArray(model?.itens_incluidos) ? model.itens_incluidos : [],
    descricao_modelo: model?.descricao_modelo ?? model?.descricaoModelo ?? '',
    valor_por_espacamento_cents: Math.max(0, Math.round(Number(model?.valor_por_espacamento_cents ?? model?.valorPorEspacamentoCents ?? 0) || 0))
  }
}

function saveSharedModels(lista){
  const normalized = (Array.isArray(lista) ? lista : [])
    .map((model, index) => normalizeSharedModel(model, index))
    .filter(model => model.name)

  try{ localStorage.setItem(STORAGE_SHARED_MODELS, JSON.stringify(normalized)) }catch{}
  try{ localStorage.setItem(STORAGE_CATALOGO_MODELS, JSON.stringify(normalized)) }catch{}
}

function ready(){
  return document.getElementById('modeloNome') && document.getElementById('listaModelos')
}

function boot(){
  if(booted || !ready()) return
  booted = true
  carregarTudo()
}

const bootTimer = setInterval(()=>{
  if(ready()){
    clearInterval(bootTimer)
    boot()
  }
}, 150)
window.addEventListener('load', boot)

function bindCurrencyInputs(){
  ['lucroDesejado'].forEach(id => {
    const input = document.getElementById(id)
    if(!input || input.dataset.maskBound === '1') return
    input.dataset.maskBound = '1'
    input.addEventListener('input', () => {
      window.formatCurrency(input)
    })
    input.addEventListener('blur', () => {
      window.formatCurrency(input)
    })
  })
}

function bindPhotoInput(){
  const input = document.getElementById('fotoModelo')
  if(!input || input.dataset.photoBound === '1') return
  input.dataset.photoBound = '1'
  input.addEventListener('change', () => {
    if(input.files?.[0]){
      preloadModelImageFromInput().then(() => persistDraftState()).catch(error => console.error(error))
      return
    }
    currentImageLoadPromise = null
    if(!modeloEditandoId) currentModelImageDataUrl = ''
    persistDraftState()
  })
}

function persistDraftState(){
  try{
    const payload = {
      modeloEditandoId,
      currentModelImageDataUrl,
      materiaisModelo: Array.isArray(materiaisModelo) ? materiaisModelo.map(item => ({ ...item })) : [],
      fields: {
        modeloNome: document.getElementById('modeloNome')?.value || '',
        baseMedida: document.getElementById('baseMedida')?.value || '',
        lucroDesejado: document.getElementById('lucroDesejado')?.value || '',
        valorEspacamento: document.getElementById('valorEspacamento')?.value || '',
        espacamento: document.getElementById('espacamento')?.value || '10 cm',
        searchModelo: document.getElementById('searchModelo')?.value || ''
      }
    }
    localStorage.setItem(STORAGE_PRECIFICACAO_DRAFT, JSON.stringify(payload))
  }catch(_){ }
}

function clearDraftState(){
  try{ localStorage.removeItem(STORAGE_PRECIFICACAO_DRAFT) }catch(_){ }
}

function restoreDraftState(){
  try{
    const raw = JSON.parse(localStorage.getItem(STORAGE_PRECIFICACAO_DRAFT) || 'null')
    if(!raw || typeof raw !== 'object') return

    modeloEditandoId = raw.modeloEditandoId ?? null
    currentModelImageDataUrl = typeof raw.currentModelImageDataUrl === 'string' ? raw.currentModelImageDataUrl : ''
    materiaisModelo = Array.isArray(raw.materiaisModelo) ? raw.materiaisModelo.map(item => ({ ...item })) : []

    const fields = raw.fields || {}
    const pairs = [
      ['modeloNome', fields.modeloNome || ''],
      ['baseMedida', fields.baseMedida || ''],
      ['lucroDesejado', fields.lucroDesejado || ''],
      ['valorEspacamento', fields.valorEspacamento || ''],
      ['searchModelo', fields.searchModelo || '']
    ]
    pairs.forEach(([id, value]) => {
      const el = document.getElementById(id)
      if(el) el.value = value
    })
    const spacing = document.getElementById('espacamento')
    if(spacing && fields.espacamento) spacing.value = fields.espacamento

    renderMateriais()
    renderModelos()
    updateResumo()
  }catch(_){ }
}

function bindDraftPersistence(){
  const ids = ['modeloNome','baseMedida','lucroDesejado','valorEspacamento','espacamento','searchModelo']
  ids.forEach(id => {
    const el = document.getElementById(id)
    if(!el || el.dataset.draftBound === '1') return
    el.dataset.draftBound = '1'
    const handler = () => persistDraftState()
    el.addEventListener('input', handler)
    el.addEventListener('change', handler)
    el.addEventListener('blur', handler)
  })
}

function initPrecificacao(){
  if(!ready()) return false
  bindCurrencyInputs()
  bindPhotoInput()
  bindDraftPersistence()
  boot()
  return true
}

async function carregarTudo(){
  await Promise.all([carregarMateriaisCatalogo(), carregarModelos()])
  restoreDraftState()
  renderItensIncluidos([])
}

function getToken(){
  try{
    return window.ESTOFARIA_HTTP && typeof window.ESTOFARIA_HTTP.getToken === 'function'
      ? window.ESTOFARIA_HTTP.getToken()
      : (localStorage.getItem('auth_token') || localStorage.getItem('token') || localStorage.getItem('estofaria_token') || '')
  }catch{
    return ''
  }
}

function authHeaders(extra = {}){
  return window.ESTOFARIA_HTTP && typeof window.ESTOFARIA_HTTP.authHeaders === 'function'
    ? window.ESTOFARIA_HTTP.authHeaders(extra)
    : { Accept: 'application/json', ...extra }
}

async function apiGet(path){
  return window.ESTOFARIA_HTTP.fetchJson(API + path, {
    headers: authHeaders(),
    cache: 'no-store'
  })
}

async function apiSend(path, method, body){
  return window.ESTOFARIA_HTTP.fetchJson(API + path, {
    method,
    headers: authHeaders({ 'Content-Type':'application/json' }),
    body: JSON.stringify(body)
  })
}

function readSharedModelsFromStorage(key){
  try{
    const raw = JSON.parse(localStorage.getItem(key) || '[]')
    const arr = Array.isArray(raw) ? raw : (Array.isArray(raw?.models) ? raw.models : [])
    return arr.map((model, index) => normalizeSharedModel(model, index)).filter(model => model.name)
  }catch{
    return []
  }
}

function loadLocalModelFallback(){
  const seen = new Set()
  return [
    ...readSharedModelsFromStorage(STORAGE_SHARED_MODELS),
    ...readSharedModelsFromStorage(STORAGE_CATALOGO_MODELS)
  ].filter(model => {
    const key = `${String(model.id)}::${String(model.name).toLowerCase()}`
    if(seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function upsertSharedModelLocally(model){
  const normalized = normalizeSharedModel(model)
  const current = (Array.isArray(modelos) && modelos.length ? modelos : loadLocalModelFallback()).map((item, index) => normalizeSharedModel(item, index))
  const idx = current.findIndex(item => String(item.id) === String(normalized.id))
  if(idx >= 0){
    current[idx] = { ...current[idx], ...normalized }
  }else{
    current.unshift(normalized)
  }
  modelos = current
  saveSharedModels(current)
}

function removeSharedModelLocally(id){
  const next = (Array.isArray(modelos) && modelos.length ? modelos : loadLocalModelFallback())
    .map((item, index) => normalizeSharedModel(item, index))
    .filter(item => String(item.id) !== String(id))
  modelos = next
  saveSharedModels(next)
}

function applyCurrencyMask(input){
  if(!input) return
  let value = String(input.value || '').replace(/\D/g,'')
  value = (Number(value || 0)/100).toFixed(2)
  value = value.replace('.',',').replace(/(\d)(?=(\d{3})+(?!\d))/g,'$1.')
  input.value = 'R$ ' + value
}

function parseCurrencyToCents(v){
  if(!v) return 0
  const clean = String(v).replace(/\s/g,'').replace('R$','').replace(/\./g,'').replace(',','.')
  const n = Number(clean)
  return Number.isFinite(n) ? Math.round(n * 100) : 0
}

function parseNumber(v){
  if(v == null) return 0
  const n = Number(String(v).replace(',', '.').replace(/[^0-9.\-]/g, ''))
  return Number.isFinite(n) ? n : 0
}

function formatBRLFromCents(cents){
  return (Number(cents || 0) / 100).toLocaleString('pt-BR', { style:'currency', currency:'BRL' })
}

function getSpacingCm(){
  const raw = document.getElementById('espacamento')?.value || '10 cm'
  if(/1\s*m/i.test(raw)) return 100
  const n = Number(raw.replace(/\D/g,''))
  return Number.isFinite(n) && n > 0 ? n : 10
}

function readFileAsDataUrl(file){
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '')
    reader.onerror = () => reject(new Error('Não consegui ler a imagem do modelo.'))
    reader.readAsDataURL(file)
  })
}

function compressImageFile(file, { maxWidth = 1600, maxHeight = 1600, quality = 0.82 } = {}){
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const img = new Image()
      img.onload = () => {
        let width = img.width || maxWidth
        let height = img.height || maxHeight
        const scale = Math.min(1, maxWidth / width, maxHeight / height)
        width = Math.max(1, Math.round(width * scale))
        height = Math.max(1, Math.round(height * scale))

        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')
        if(!ctx) return reject(new Error('Não consegui preparar a imagem do modelo.'))
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, width, height)
        ctx.drawImage(img, 0, 0, width, height)
        resolve(canvas.toDataURL('image/jpeg', quality))
      }
      img.onerror = () => reject(new Error('Não consegui processar a imagem do modelo.'))
      img.src = typeof reader.result === 'string' ? reader.result : ''
    }
    reader.onerror = () => reject(new Error('Não consegui ler a imagem do modelo.'))
    reader.readAsDataURL(file)
  })
}

function cacheModelImageDataUrlFromFile(file){
  currentImageLoadPromise = (async () => {
    let dataUrl = ''
    try{
      dataUrl = await compressImageFile(file)
    }catch(_){
      dataUrl = await readFileAsDataUrl(file)
    }
    currentModelImageDataUrl = dataUrl
    return dataUrl
  })()

  currentImageLoadPromise.finally(() => {
    currentImageLoadPromise = null
  })

  return currentImageLoadPromise
}

async function preloadModelImageFromInput(){
  const input = document.getElementById('fotoModelo')
  const file = input?.files?.[0]
  if(!file) return currentModelImageDataUrl || ''
  return await cacheModelImageDataUrlFromFile(file)
}

async function getModelImageDataUrlForSave(){
  const input = document.getElementById('fotoModelo')
  const file = input?.files?.[0]
  if(file){
    if(currentImageLoadPromise){
      try{ return await currentImageLoadPromise }catch(_){ }
    }
    if(currentModelImageDataUrl) return currentModelImageDataUrl
    return await preloadModelImageFromInput()
  }
  return currentModelImageDataUrl || ''
}

async function carregarMateriaisCatalogo(){
  try{
    catalogoMateriais = await apiGet('/materials')
  }catch(e){
    console.error(e)
    catalogoMateriais = []
  }
  renderMaterialSelect()
}

function renderMaterialSelect(){
  const select = document.getElementById('materialSelect')
  if(!select) return
  select.innerHTML = ''
  if(!catalogoMateriais.length){
    const opt = document.createElement('option')
    opt.value = ''
    opt.textContent = 'Cadastre materiais primeiro'
    select.appendChild(opt)
    return
  }
  catalogoMateriais.forEach(m=>{
    const opt = document.createElement('option')
    opt.value = String(m.id)
    opt.textContent = `${m.name} (${m.unit}) — ${formatBRLFromCents(m.price_cents)}`
    select.appendChild(opt)
  })
}

function addMaterial(){
  const select = document.getElementById('materialSelect')
  const qtd = parseNumber(document.getElementById('materialQtd')?.value)
  const id = Number(select?.value)
  const mat = catalogoMateriais.find(m=>m.id === id)

  if(!mat){
    ui().warning('Selecione um material válido.')
    return
  }
  if(!(qtd > 0)){
    ui().warning('Informe a quantidade do material.')
    return
  }

  const totalCents = Math.round(qtd * Number(mat.price_cents || 0))
  materiaisModelo.push({
    material_id: mat.id,
    material_name: mat.name,
    unit: mat.unit,
    quantity: qtd,
    unit_price_cents: Number(mat.price_cents || 0),
    total_cents: totalCents
  })

  document.getElementById('materialQtd').value = ''
  renderMateriais()
  persistDraftState()
}

function deleteMaterial(i){
  materiaisModelo.splice(i,1)
  renderMateriais()
  persistDraftState()
}

function renderMateriais(){
  const table = document.getElementById('materiaisTabela')
  if(!table) return
  table.innerHTML = ''

  if(!materiaisModelo.length){
    table.innerHTML = '<tr><td colspan="6" class="table-empty">Nenhum material adicionado a este modelo ainda.</td></tr>'
    updateResumo()
    return
  }

  materiaisModelo.forEach((m,i)=>{
    const tr = document.createElement('tr')
    tr.innerHTML = `
      <td>${escapeHtml(m.material_name)}</td>
      <td>${escapeHtml(m.unit)}</td>
      <td>${formatQty(m.quantity)}</td>
      <td>${formatBRLFromCents(m.unit_price_cents)}</td>
      <td>${formatBRLFromCents(m.total_cents)}</td>
      <td class="delete" onclick="deleteMaterial(${i})">×</td>
    `
    table.appendChild(tr)
  })

  updateResumo()
}

function updateResumo(){
  const custo = materiaisModelo.reduce((acc,m)=> acc + Number(m.total_cents || 0), 0)
  const lucro = parseCurrencyToCents(document.getElementById('lucroDesejado')?.value || '')
  const venda = custo + lucro
  const margem = venda > 0 ? ((lucro / venda) * 100).toFixed(1) : '0.0'

  const custoEl = document.getElementById('custoTotal')
  const lucroEl = document.getElementById('lucroTotal')
  const vendaEl = document.getElementById('valorVenda')
  const margemEl = document.getElementById('margem')

  if(custoEl) custoEl.innerText = formatBRLFromCents(custo)
  if(lucroEl) lucroEl.innerText = formatBRLFromCents(lucro)
  if(vendaEl) vendaEl.innerText = formatBRLFromCents(venda)
  if(margemEl) margemEl.innerText = margem + '%'
}

async function salvarModelo(){
  const nome = document.getElementById('modeloNome')?.value.trim()
  const base = parseNumber(document.getElementById('baseMedida')?.value)
  const spacingCm = getSpacingCm()
  const totalCost = materiaisModelo.reduce((acc,m)=> acc + Number(m.total_cents || 0), 0)
  const targetProfit = parseCurrencyToCents(document.getElementById('lucroDesejado')?.value || '')
  const salePrice = totalCost + targetProfit

  if(!nome){
    await ui().alert('Informe o nome do modelo.', { title: 'Campo obrigatório' })
    return
  }
  if(!(base > 0)){
    await ui().alert('Informe a medida base do modelo.', { title: 'Campo obrigatório' })
    return
  }

  return ui().runButtonAction('precificacaoSaveBtn', async () => {
    const imageDataUrl = await getModelImageDataUrlForSave()
    const currentModel = modelos.find(m => m.id === modeloEditandoId)
    const nowIso = new Date().toISOString()
    const createdAt = currentModel?.created_at || currentModel?.createdAt || nowIso

    const veRaw = parseFloat(String(document.getElementById('valorEspacamento')?.value || '0').replace(',', '.')) || 0
    const valorEspacamentoCents = Math.round(veRaw * 100)

    const descricaoModelo = (document.getElementById('descricaoModelo')?.value || '').trim().slice(0, 300)

    const body = {
      name: nome,
      base_meters: base,
      spacing_cm: spacingCm,
      valor_por_espacamento_cents: valorEspacamentoCents,
      total_cost_cents: totalCost,
      target_profit_cents: targetProfit,
      sale_price_cents: salePrice,
      descricao_modelo: descricaoModelo,
      created_at: createdAt,
      updated_at: nowIso,
      image_data_url: imageDataUrl,
      imageDataUrl,
      foto_data_url: imageDataUrl,
      fotoDataUrl: imageDataUrl,
      materials: materiaisModelo,
      itens_incluidos: getItensIncluidos()
    }

    try{
      let savedModel = null
      if(modeloEditandoId){
        savedModel = await apiSend('/models/' + modeloEditandoId, 'PUT', body)
        upsertSharedModelLocally({ ...body, ...(savedModel || {}), id: (savedModel && (savedModel.id ?? savedModel._id)) ?? modeloEditandoId })
        ui().success('Modelo atualizado com sucesso.')
      }else{
        savedModel = await apiSend('/models', 'POST', body)
        upsertSharedModelLocally({ ...body, ...(savedModel || {}), id: (savedModel && (savedModel.id ?? savedModel._id)) ?? `local-${Date.now()}` })
        ui().success('Modelo salvo com sucesso.')
      }
      limparFormulario()
      clearDraftState()
      await carregarModelos()
    }catch(e){
      console.error(e)
      const fallbackId = modeloEditandoId || `local-${Date.now()}`
      upsertSharedModelLocally({
        ...body,
        id: fallbackId,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      limparFormulario()
      clearDraftState()
      renderModelos()
      ui().warning((e.message || 'Erro ao salvar no servidor.') + ' O modelo foi salvo localmente neste aparelho.')
    }
  }, { loadingText: 'Salvando...' })
}

async function carregarModelos(){
  const fallbackModels = loadLocalModelFallback()
  const fallbackByKey = new Map(
    fallbackModels.map(model => [`${String(model.id)}::${String(model.name || '').toLowerCase()}`, model])
  )

  try{
    const data = await apiGet('/models')
    const fetched = Array.isArray(data) ? data : (Array.isArray(data?.models) ? data.models : [])
    modelos = fetched.map((raw, index) => {
      const normalized = normalizeSharedModel(raw, index)
      const key = `${String(normalized.id)}::${String(normalized.name || '').toLowerCase()}`
      const fallback = fallbackByKey.get(key)
      if(!fallback) return normalized
      const imageDataUrl = normalized.image_data_url || fallback.image_data_url || ''
      return {
        ...normalized,
        image_data_url: imageDataUrl,
        imageDataUrl,
        foto_data_url: imageDataUrl,
        fotoDataUrl: imageDataUrl
      }
    })
  }catch(e){
    console.error(e)
    modelos = []
  }
  if(!Array.isArray(modelos) || !modelos.length){
    modelos = fallbackModels
  }
  if(Array.isArray(modelos) && modelos.length){
    saveSharedModels(modelos)
  }
  renderModelos()
}

function getModelUpdateLabel(model){
  const createdAt = model?.created_at || model?.createdAt || model?.date || model?.saved_at
  const updatedAt = model?.updated_at || model?.updatedAt || model?.last_update || model?.lastUpdated || createdAt
  const createdDate = createdAt ? (/^\d{4}-\d{2}-\d{2}$/.test(String(createdAt)) ? new Date(createdAt + 'T00:00:00') : new Date(createdAt)) : null
  const updatedDate = updatedAt ? (/^\d{4}-\d{2}-\d{2}$/.test(String(updatedAt)) ? new Date(updatedAt + 'T00:00:00') : new Date(updatedAt)) : null
  const hasCreated = createdDate && Number.isFinite(createdDate.getTime())
  const hasUpdated = updatedDate && Number.isFinite(updatedDate.getTime())
  const updatedChanged = hasCreated && hasUpdated
    ? Math.abs(updatedDate.getTime() - createdDate.getTime()) > 60000
    : false

  if(updatedChanged) return `Atualizado em ${updatedDate.toLocaleDateString('pt-BR')}`
  if(hasCreated) return `Criado em ${createdDate.toLocaleDateString('pt-BR')}`
  if(hasUpdated) return `Atualizado em ${updatedDate.toLocaleDateString('pt-BR')}`
  if(String(model?.id || '').startsWith('local-')) return 'Salvo localmente'
  return 'Sem data informada'
}

function renderModelos(){
  const table = document.getElementById('listaModelos')
  if(!table) return
  const term = (document.getElementById('searchModelo')?.value || '').trim().toLowerCase()
  table.innerHTML = ''

  const visibleModels = modelos.filter(m => !term || String(m.name || '').toLowerCase().includes(term))
  if(!visibleModels.length){
    table.innerHTML = `<tr><td colspan="5" class="table-empty">${term ? 'Nenhum modelo encontrado para esta busca.' : 'Nenhum modelo salvo ainda.'}</td></tr>`
    return
  }

  visibleModels.forEach(m=>{
      const tr = document.createElement('tr')
      tr.innerHTML = `
        <td>${escapeHtml(m.name)}</td>
        <td>${formatQty(m.base_meters)} m</td>
        <td>${formatBRLFromCents(m.sale_price_cents)}</td>
        <td>${escapeHtml(getModelUpdateLabel(m))}</td>
        <td>
          <button type="button" onclick="editarModelo(${m.id})">Editar</button>
          <button type="button" onclick="excluirModelo(${m.id})">×</button>
        </td>
      `
      table.appendChild(tr)
    })
}

function editarModelo(id){
  const modelo = modelos.find(m=>m.id === id)
  if(!modelo) return
  modeloEditandoId = id
  currentImageLoadPromise = null
  currentModelImageDataUrl = resolveModelImageDataUrl(modelo)
  document.getElementById('modeloNome').value = modelo.name || ''
  document.getElementById('baseMedida').value = formatQty(modelo.base_meters)
  document.getElementById('lucroDesejado').value = formatBRLFromCents(modelo.target_profit_cents || 0)
  const veEl = document.getElementById('valorEspacamento')
  if (veEl) veEl.value = (modelo.valor_por_espacamento_cents > 0) ? (modelo.valor_por_espacamento_cents / 100).toFixed(2) : ''
  const descEl = document.getElementById('descricaoModelo')
  if (descEl) descEl.value = modelo.descricao_modelo || ''
  aplicarSpacing(modelo.spacing_cm)
  const fotoInput = document.getElementById('fotoModelo')
  if(fotoInput) fotoInput.value = ''
  materiaisModelo = Array.isArray(modelo.materials) ? modelo.materials.map(m=>({ ...m })) : []
  renderMateriais()
  renderItensIncluidos(Array.isArray(modelo.itens_incluidos) ? modelo.itens_incluidos : [])
  persistDraftState()
}

async function excluirModelo(id){
  const confirmed = await ui().confirm('Excluir este modelo?', {
    title: 'Excluir modelo',
    confirmText: 'Excluir',
    type: 'danger'
  })
  if(!confirmed) return
  try{
    await apiSend('/models/' + id, 'DELETE', {})
    removeSharedModelLocally(id)
    if(modeloEditandoId === id) limparFormulario()
    await carregarModelos()
    ui().success('Modelo excluído com sucesso.')
  }catch(e){
    console.error(e)
    ui().error(e.message || 'Erro ao excluir modelo.')
  }
}

// ── Itens incluídos no modelo ──────────────────────────────────────────────────

function loadGlobalItensForPrecificacao(){
  try{
    const raw = JSON.parse(localStorage.getItem('esd_itens_cols_v1') || '[]')
    return Array.isArray(raw) ? raw.filter(c => c?.name) : []
  }catch{ return [] }
}

function renderItensIncluidos(selecionados = []){
  const container = document.getElementById('itensIncluidosLista')
  if(!container) return

  const itens = loadGlobalItensForPrecificacao()
  if(!itens.length){
    container.innerHTML = '<p style="font-size:13px;opacity:0.6;margin:0;">Nenhum item cadastrado na aba Itens para personalização.</p>'
    return
  }

  const selecionadosSet = new Set((selecionados || []).map(n => n.toLowerCase()))

  container.innerHTML = itens.map(item => {
    const checked = selecionadosSet.has(item.name.toLowerCase()) ? 'checked' : ''
    const preco = item.price_cents ? ` · R$ ${(item.price_cents / 100).toFixed(2).replace('.', ',')}` : ''
    const id = `chk_item_${item.name.replace(/\W/g, '_')}`
    return `
      <label for="${id}" style="display:flex;align-items:center;gap:10px;padding:8px 10px;border:1px solid #e0e6f0;border-radius:8px;cursor:pointer;background:#fff;font-size:14px;">
        <input type="checkbox" id="${id}" data-item-name="${item.name}" ${checked}
          style="width:18px;height:18px;accent-color:#4a67a1;cursor:pointer;flex-shrink:0;">
        <span>
          <strong>${item.name}</strong>
          <span style="color:#888;font-size:12px;">${item.unit}${preco}</span>
        </span>
      </label>`
  }).join('')
}

function getItensIncluidos(){
  const container = document.getElementById('itensIncluidosLista')
  if(!container) return []
  return Array.from(container.querySelectorAll('input[type=checkbox]:checked'))
    .map(cb => cb.dataset.itemName)
    .filter(Boolean)
}

function limparFormulario(){
  modeloEditandoId = null
  currentImageLoadPromise = null
  currentModelImageDataUrl = ''
  materiaisModelo = []
  const ids = ['modeloNome','baseMedida','lucroDesejado','materialQtd','valorEspacamento','descricaoModelo','fotoModelo','searchModelo']
  ids.forEach(id=>{
    const el = document.getElementById(id)
    if(el && id !== 'searchModelo') el.value = ''
  })
  aplicarSpacing(10)
  renderMateriais()
  renderItensIncluidos([])
  renderModelos()
  clearDraftState()
}

function filtrarModelos(){
  renderModelos()
}

async function buildPrecificacaoPdfPayload(){
  if(!window.jspdf || !window.jspdf.jsPDF){
    throw new Error('Biblioteca de PDF não carregada. Republique a pasta da precificação completa.')
  }

  const currentModel = modelos.find(m => m.id === modeloEditandoId)
  const nome = String(document.getElementById('modeloNome')?.value || '').trim() || (currentModel?.name) || 'Modelo sem nome'
  const safe = String(nome || 'modelo').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'modelo'
  const fileName = `precificacao-${safe}.pdf`
  const title = `Precificação • ${nome}`
  const base = parseNumber(document.getElementById('baseMedida')?.value || (currentModel?.base_meters))
  const spacingCm = getSpacingCm()
  const custo = materiaisModelo.reduce((acc,m)=> acc + Number(m.total_cents || 0), 0)
  const lucroInput = document.getElementById('lucroDesejado')?.value
  const lucro = lucroInput
    ? parseCurrencyToCents(lucroInput)
    : Math.max(0, Math.round(Number(currentModel?.target_profit_cents || 0) || 0))
  const venda = custo + lucro
  const margem = venda > 0 ? ((lucro / venda) * 100).toFixed(1) : '0.0'
  const imageDataUrl = currentModelImageDataUrl || (await getModelImageDataUrlForSave()) || resolveModelImageDataUrl(currentModel)
  const imageFormat = /data:image\/jpe?g/i.test(imageDataUrl) ? 'JPEG' : 'PNG'

  const { jsPDF } = window.jspdf
  const doc = new jsPDF({ orientation:'portrait', unit:'mm', format:'a4' })
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  const margin = 4.5
  const contentWidth = pageWidth - margin * 2
  const rightX = pageWidth - margin - 2
  let y = 16

  function line(text, x, yy, opts = {}){
    const size = opts.size || 10
    doc.setFont('helvetica', opts.bold ? 'bold' : 'normal')
    doc.setFontSize(size)
    doc.setTextColor(...(opts.color || [40,40,40]))
    if(opts.align){
      doc.text(String(text), x, yy, { align: opts.align })
      return
    }
    doc.text(String(text), x, yy)
  }

  function hr(){
    doc.setDrawColor(220,226,238)
    doc.line(margin, y, pageWidth - margin, y)
    y += 4.5
  }

  function ensureSpace(min = 12){
    if(y + min <= pageHeight - 10) return
    doc.addPage()
    y = 16
  }

  doc.setFillColor(74,103,161)
  doc.roundedRect(margin, 8, contentWidth, 14, 3, 3, 'F')
  line('Precificação', margin + 4, 17.5, { size: 15, bold: true, color: [255,255,255] })
  line(new Date().toLocaleString('pt-BR'), rightX, 17.5, { size: 8.5, color: [255,255,255], align: 'right' })
  y = 30

  line('Dados do modelo', margin + 1, y, { size: 12, bold: true, color: [63,95,163] })
  y += 7

  const imageBoxWidth = imageDataUrl ? 34 : 0
  const imageBoxHeight = imageDataUrl ? 28 : 0
  const imageX = pageWidth - margin - imageBoxWidth
  const infoRightX = imageDataUrl ? imageX - 3 : rightX

  if(imageDataUrl){
    doc.setDrawColor(220,226,238)
    doc.roundedRect(imageX, y - 2, imageBoxWidth, imageBoxHeight, 3, 3)
    try{
      doc.addImage(imageDataUrl, imageFormat, imageX + 1.5, y - 0.5, imageBoxWidth - 3, imageBoxHeight - 3)
    }catch(_){
      try{ doc.addImage(imageDataUrl, imageFormat === 'PNG' ? 'JPEG' : 'PNG', imageX + 1.5, y - 0.5, imageBoxWidth - 3, imageBoxHeight - 3) }catch(__){}
    }
  }

  line(`Modelo: ${nome}`, margin + 1, y, { size: 10.5, bold: true })
  y += 5.5
  line(`Medida base: ${formatQty(base)} m`, margin + 1, y, { size: 9.5 })
  y += 5.5
  line(`Espaçamento: ${spacingCm === 100 ? '1 m' : spacingCm + ' cm'}`, margin + 1, y, { size: 9.5 })
  y += imageDataUrl ? 18 : 4
  hr()

  line('Materiais', margin + 1, y, { size: 12, bold: true, color: [63,95,163] })
  y += 7

  const materialX = margin + 2
  const unitX = margin + contentWidth * 0.52
  const qtdX = margin + contentWidth * 0.64
  const valorX = margin + contentWidth * 0.79
  const totalX = pageWidth - margin - 2
  const materialWidth = Math.max(52, unitX - materialX - 4)

  doc.setFillColor(242,245,252)
  doc.roundedRect(margin, y - 5, contentWidth, 8, 2, 2, 'F')
  line('Material', materialX, y, { bold: true, size: 9 })
  line('Unid.', unitX, y, { bold: true, size: 9 })
  line('Qtd', qtdX, y, { bold: true, size: 9 })
  line('Valor', valorX, y, { bold: true, size: 9, align: 'right' })
  line('Total', totalX, y, { bold: true, size: 9, align: 'right' })
  y += 7

  if(!materiaisModelo.length){
    line('Nenhum material adicionado.', margin + 1, y, { size: 9.5 })
    y += 7
  }else{
    materiaisModelo.forEach((m, idx) => {
      ensureSpace(8)
      if(idx % 2 === 0){
        doc.setFillColor(250,250,252)
        doc.roundedRect(margin, y - 4.5, contentWidth, 7, 1.5, 1.5, 'F')
      }
      const nomeMat = doc.splitTextToSize(String(m.material_name || ''), materialWidth)[0] || '-'
      line(nomeMat, materialX, y, { size: 9 })
      line(String(m.unit || '-'), unitX, y, { size: 9 })
      line(formatQty(m.quantity || 0), qtdX, y, { size: 9 })
      line(formatBRLFromCents(m.unit_price_cents || 0), valorX, y, { size: 9, align: 'right' })
      line(formatBRLFromCents(m.total_cents || 0), totalX, y, { size: 9, align: 'right' })
      y += 7
    })
  }

  ensureSpace(34)
  hr()
  line('Resumo financeiro', margin + 1, y, { size: 12, bold: true, color: [63,95,163] })
  y += 8
  line('Custo total', margin + 1, y, { size: 10 })
  line(formatBRLFromCents(custo), totalX, y, { size: 10, bold: true, align: 'right' })
  y += 6
  line('Lucro desejado', margin + 1, y, { size: 10 })
  line(formatBRLFromCents(lucro), totalX, y, { size: 10, bold: true, align: 'right' })
  y += 6
  line('Valor de venda', margin + 1, y, { size: 10 })
  line(formatBRLFromCents(venda), totalX, y, { size: 10.5, bold: true, align: 'right' })
  y += 6
  line('Margem de contribuição', margin + 1, y, { size: 10 })
  line(`${margem}%`, totalX, y, { size: 10, bold: true, align: 'right' })

  const pdfBlob = doc.output('blob')
  return { doc, pdfBlob, fileName, title }
}

async function gerarPDF(){
  return ui().runButtonAction('precificacaoPdfBtn', async () => {
    let previewWindow = null
    try{
      const { pdfBlob, fileName, title } = await buildPrecificacaoPdfPayload()
      openPdfPreview(pdfBlob, fileName, title)
      ui().success('PDF gerado com sucesso.')
    }catch(e){
      console.error(e)
      if(previewWindow && !previewWindow.closed){
        previewWindow.document.open()
        previewWindow.document.write(`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Erro ao gerar PDF</title><style>body{margin:0;font-family:Arial,sans-serif;background:#0f172a;color:#e2e8f0;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:24px;text-align:center}.box{max-width:420px;background:#1e293b;border-radius:18px;padding:24px}button{border:0;border-radius:999px;padding:10px 16px;background:#4a67a1;color:#fff;font:inherit;cursor:pointer}</style></head><body><div class="box"><h1 style="margin-top:0;font-size:20px">Não consegui gerar o PDF</h1><p>Verifique a foto do modelo e tente novamente.</p><button onclick="window.close()">Fechar</button></div></body></html>`)
        previewWindow.document.close()
      }
      ui().error(e.message || 'Erro ao gerar PDF. Tente novamente.')
    }
  }, { loadingText: 'Gerando PDF...' })
}

async function enviarPDF(){
  return ui().runButtonAction('precificacaoSendBtn', async () => {
    try{
      const { pdfBlob, fileName, title } = await buildPrecificacaoPdfPayload()
      const file = typeof File === 'function'
        ? new File([pdfBlob], fileName || 'documento.pdf', { type:'application/pdf' })
        : null

      if(file && navigator.canShare && navigator.canShare({ files:[file] })){
        await navigator.share({
          title: title || fileName || 'PDF',
          text: 'PDF gerado pela Estofaria Digital',
          files: [file]
        })
        ui().success('PDF pronto para compartilhamento.')
        return { ok:true, mode:'native-share' }
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
        try{ URL.revokeObjectURL(url) }catch(_){ }
      }, 60000)
      ui().warning('O envio nativo não está disponível neste aparelho. O PDF foi baixado para envio manual.')
      return { ok:true, mode:'download-fallback' }
    }catch(e){
      console.error(e)
      ui().error(e.message || 'Erro ao preparar o PDF para envio.')
      return { ok:false, error:e }
    }
  }, { loadingText: 'Preparando envio...' })
}

function aplicarSpacing(spacingCm){
  const select = document.getElementById('espacamento')
  if(!select) return
  const alvo = spacingCm === 100 ? '1 m' : `${spacingCm} cm`
  const achou = Array.from(select.options).find(opt => opt.textContent.trim() === alvo)
  if(achou) select.value = achou.value
}

function formatDate(v){
  const s = String(v || '')
  const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(s + 'T00:00:00') : new Date(s)
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString('pt-BR') : '-'
}

function formatQty(v){
  const n = Number(v || 0)
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function escapeHtml(v){
  return String(v ?? '')
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#39;')
}

function getPreviewHost(){
  try{
    if(window.parent && window.parent !== window && window.parent.document && window.parent.document.body){
      return { win: window.parent, doc: window.parent.document }
    }
  }catch(_){ }
  return { win: window, doc: document }
}

function openPdfPreviewWindow(fileName, title){
  return null
}

function getPdfPreviewMetrics(targetWindow = window, targetDocument = document){
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

function openPdfPreview(pdfBlob, fileName, title, existingWindow){
  persistDraftState()
  const host = getPreviewHost()
  const hostWindow = host.win
  const hostDocument = host.doc
  const urlApi = hostWindow.URL || URL
  const oldOverlay = hostDocument.getElementById('precificacaoPdfOverlay')
  if(oldOverlay){
    try{ urlApi.revokeObjectURL(oldOverlay.dataset.pdfUrl || '') }catch(_){ }
    oldOverlay.remove()
  }

  const metrics = getPdfPreviewMetrics(hostWindow, hostDocument)
  const pdfUrl = urlApi.createObjectURL(pdfBlob)
  const overlay = hostDocument.createElement('div')
  overlay.id = 'precificacaoPdfOverlay'
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
        <button id="precificacaoPdfCloseBtn" type="button" style="border:0;border-radius:999px;padding:10px 14px;background:#4a67a1;color:#fff;font:inherit;font-weight:700;cursor:pointer;flex:0 0 auto;">Fechar</button>
      </div>
      <div style="min-height:0;display:flex;align-items:stretch;justify-content:center;overflow:hidden;">
        <div data-preview-card style="width:${metrics.cardWidth}px;height:${metrics.cardHeight}px;max-width:100%;background:#ffffff;border-radius:16px;box-shadow:0 10px 40px rgba(0,0,0,.35);overflow:hidden;display:block;">
          <iframe id="precificacaoPdfFrame" title="${safeTitle}" scrolling="auto" style="display:block;width:100%;height:100%;border:0;background:#ffffff;overflow:auto;-webkit-overflow-scrolling:touch;"></iframe>
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
    try{ urlApi.revokeObjectURL(pdfUrl) }catch(_){ }
    overlay.remove()
  }

  overlay.addEventListener('click', event => {
    if(event.target === overlay) closePreview()
  })

  const closeBtn = overlay.querySelector('#precificacaoPdfCloseBtn')
  if(closeBtn) closeBtn.addEventListener('click', closePreview)

  const frame = overlay.querySelector('#precificacaoPdfFrame')
  if(frame){
    frame.src = pdfUrl + '#toolbar=0&navpanes=0&scrollbar=1&page=1&view=FitH&zoom=page-width'
  }

  hostWindow.addEventListener('resize', syncLayout)
  if (hostWindow.visualViewport) hostWindow.visualViewport.addEventListener('resize', syncLayout)
  setTimeout(syncLayout, 60)

  return { ok:true, mode:'overlay-preview' }
}

window.addMaterial = addMaterial
window.addMaterial = addMaterial
window.deleteMaterial = deleteMaterial
window.salvarModelo = salvarModelo
window.editarModelo = editarModelo
window.excluirModelo = excluirModelo
window.filtrarModelos = filtrarModelos
window.gerarPDF = gerarPDF
window.enviarPDF = enviarPDF
window.formatCurrency = function(input){
  applyCurrencyMask(input)
  updateResumo()
}

window.initPrecificacao = initPrecificacao
