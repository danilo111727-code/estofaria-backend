let modelos = []
let itens = []
let modelosSelecionados = new Set()

const ALBUMS_KEY = 'esd_albums_v1'

function gerarIdAlbum(){
  return 'alb_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7)
}

function loadAlbums(){
  try{
    const raw = JSON.parse(localStorage.getItem(ALBUMS_KEY) || '[]')
    return Array.isArray(raw) ? raw : []
  }catch{ return [] }
}

function saveAlbums(lista){
  try{ localStorage.setItem(ALBUMS_KEY, JSON.stringify(lista)) }catch{}
}

// ── Estado do modal de álbum ──────────────────────────────────────────────────
let _modalAlbumId = null     // null = criando novo álbum
let _modalTecidos = []       // [{ nome, codigo }]

function renderAlbums(){
  const container = el('albumsSection')
  if(!container) return

  const albums = loadAlbums()
  if(!albums.length){
    container.innerHTML = '<p style="margin:0;font-size:13px;opacity:0.6;">Nenhum álbum cadastrado ainda.</p>'
    return
  }

  container.innerHTML = albums.map(album => `
    <div style="border:1px solid #dce3f0;border-radius:10px;padding:12px 14px;margin-bottom:12px;background:#fff;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
        <div>
          <span style="font-weight:bold;font-size:14px;">📁 ${escapeHtml(album.nome)}</span>
          <span style="margin-left:8px;font-size:13px;color:#4a67a1;">${escapeHtml(formatBRLFromCents(Math.round(Number(album.custo || 0) * 100)))}</span>
          ${album.unidade ? `<span style="margin-left:6px;font-size:12px;color:#888;">· ${escapeHtml(album.unidade)}</span>` : ''}
          <span style="margin-left:6px;font-size:12px;color:#999;">· ${album.itens ? album.itens.length : 0} tecido(s)</span>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end;">
          <button type="button"
            style="font-size:12px;padding:4px 12px;border-radius:20px;border:none;background:#4a67a1;color:#fff;cursor:pointer;"
            onclick="adicionarAlbumNaTabela('${escapeHtml(album.id)}')">Adicionar álbum à tabela</button>
          <button type="button"
            style="font-size:12px;padding:4px 12px;border-radius:20px;border:1px solid #4a67a1;color:#4a67a1;background:transparent;cursor:pointer;"
            onclick="abrirModalAlbum('${escapeHtml(album.id)}')">Editar</button>
          <button type="button"
            style="font-size:12px;padding:4px 12px;border-radius:20px;border:1px solid #e74c3c;color:#e74c3c;background:transparent;cursor:pointer;"
            onclick="excluirAlbum('${escapeHtml(album.id)}')">Excluir</button>
        </div>
      </div>
      ${album.itens && album.itens.length ? `
        <div style="display:flex;flex-wrap:wrap;gap:5px;margin-top:6px;">
          ${album.itens.map(t => `
            <span style="background:#eef2ff;border-radius:20px;padding:3px 10px;font-size:12px;color:#333;">
              ${escapeHtml(t.nome)}${t.codigo ? ` <span style="color:#888;">(${escapeHtml(t.codigo)})</span>` : ''}
            </span>
          `).join('')}
        </div>
      ` : ''}
    </div>
  `).join('')
}

function adicionarAlbumNaTabela(albumId){
  const album = loadAlbums().find(a => a.id === albumId)
  if(!album){ alert('Álbum não encontrado.'); return }

  if(itens.some(i => i.name.toLowerCase() === album.nome.toLowerCase())){
    alert(`"${album.nome}" já está na tabela de consumo.`)
    return
  }

  itens.push({
    name: album.nome,
    unit: album.unidade || 'álbum',
    price_cents: Math.round(Number(album.custo || 0) * 100),
    consumos: {}
  })
  saveGlobalCols(itens.map(({id, name, unit, price_cents}) => ({id, name, unit, price_cents})))
  renderTabela()
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
    if(el('modalAlbumCusto')) el('modalAlbumCusto').value = album.custo > 0 ? formatBRLFromCents(Math.round(album.custo * 100)) : ''
    carregarUnidadesModalAlbum(album.unidade || '')
    _modalTecidos = (album.itens || []).map(t => ({ nome: t.nome || '', codigo: t.codigo || '' }))
  } else {
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
  _modalAlbumId = null
  _modalTecidos = []
}

function renderTecidosModal(){
  const container = el('modalTecidosList')
  if(!container) return

  if(!_modalTecidos.length){
    container.innerHTML = '<p style="margin:0 0 8px;font-size:13px;opacity:0.55;">Nenhum tecido adicionado.</p>'
    return
  }

  container.innerHTML = _modalTecidos.map((t, i) => `
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
  _modalTecidos.push({ nome: '', codigo: '' })
  renderTecidosModal()
  // Foca o último campo de nome
  const inputs = el('modalTecidosList')?.querySelectorAll('input')
  if(inputs && inputs.length) inputs[inputs.length - 2]?.focus()
}

function removerTecidoModal(index){
  _modalTecidos.splice(index, 1)
  renderTecidosModal()
}

function salvarAlbumDoModal(){
  const nome = String(el('modalAlbumNome')?.value || '').trim()
  const custoRaw = String(el('modalAlbumCusto')?.value || '').trim()
  const unidade = String(el('modalAlbumUnidade')?.value || '').trim()

  if(!nome){
    alert('Informe o nome do álbum.')
    el('modalAlbumNome')?.focus()
    return
  }

  const custoCents = parseCurrencyToCents(custoRaw)
  const custo = custoCents / 100

  // Tecidos são informativos — salva o que tiver, sem validação obrigatória
  const tecidosSalvos = _modalTecidos
    .filter(t => t.nome.trim() || t.codigo.trim())
    .map(t => ({ nome: t.nome.trim(), codigo: t.codigo.trim() }))

  const albums = loadAlbums()
  let nomeAntigo = null

  if(_modalAlbumId){
    const idx = albums.findIndex(a => a.id === _modalAlbumId)
    if(idx >= 0){
      nomeAntigo = albums[idx].nome
      albums[idx] = {
        ...albums[idx],
        nome,
        custo,
        unidade,
        itens: tecidosSalvos,
        updatedAt: new Date().toISOString()
      }
    }
  } else {
    albums.push({
      id: gerarIdAlbum(),
      nome,
      custo,
      unidade,
      itens: tecidosSalvos,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    })
  }

  saveAlbums(albums)

  // Sincroniza tabelas de consumo de todos os modelos
  if(nomeAntigo !== null){
    sincronizarAlbumNasTabelas(nomeAntigo, nome, custo, unidade)
  }

  fecharModalAlbum()
  renderAlbums()
}

function sincronizarAlbumNasTabelas(nomeAntigo, nomeNovo, novoCusto, novaUnidade){
  const novoPriceCents = Math.round(Number(novoCusto || 0) * 100)
  const nomeBusca = nomeAntigo.toLowerCase()

  // Atualiza colunas globais
  const cols = loadGlobalCols()
  let colAtualizada = false
  const novasCols = cols.map(col => {
    if(col.name.toLowerCase() === nomeBusca){
      colAtualizada = true
      return { ...col, name: nomeNovo, price_cents: novoPriceCents, unit: novaUnidade || col.unit }
    }
    return col
  })
  if(colAtualizada) saveGlobalCols(novasCols)

  // Renomeia a chave nos consumos de todos os modelos
  const consumosKeysToCheck = ['esd_consumos_global']
  STORAGE_MODELS_KEYS.forEach(storageKey => {
    try{
      const list = JSON.parse(localStorage.getItem(storageKey) || '[]')
      if(Array.isArray(list)){
        list.forEach(m => {
          const id = m?.id || m?.name
          if(id) consumosKeysToCheck.push(`esd_consumos_${id}`)
        })
      }
    }catch{}
  })

  let linhasAtualizadas = 0
  ;[...new Set(consumosKeysToCheck)].forEach(ck => {
    try{
      const map = JSON.parse(localStorage.getItem(ck) || '{}')
      if(map[nomeBusca] !== undefined){
        map[nomeNovo.toLowerCase()] = map[nomeBusca]
        if(nomeNovo.toLowerCase() !== nomeBusca) delete map[nomeBusca]
        localStorage.setItem(ck, JSON.stringify(map))
        linhasAtualizadas++
      }
    }catch{}
  })

  // Atualiza array em memória
  itens.forEach(item => {
    if(item.name.toLowerCase() === nomeBusca){
      item.name = nomeNovo
      item.price_cents = novoPriceCents
      item.unit = novaUnidade || item.unit
    }
  })

  if(colAtualizada || linhasAtualizadas > 0){
    renderTabela()
    if(linhasAtualizadas > 0) alert(`Álbum atualizado em ${linhasAtualizadas} tabela(s) de consumo.`)
  }
}

function excluirAlbum(id){
  if(!confirm('Excluir este álbum?')) return
  saveAlbums(loadAlbums().filter(a => a.id !== id))
  renderAlbums()
}


const STORAGE_MODELS_KEYS = [
  'catalogo_modelos',
  'precificacao_modelos',
  'modelos',
  'models'
]
const STORAGE_MATERIAL_KEYS = [
  'materiais',
  'materials',
  'catalogo_materiais',
  'material_cache'
]
const STORAGE_MATERIAL_UNIT_KEYS = [
  'estofaria_material_units_v1',
  'material_units',
  'materiais_unidades'
]
const STORAGE_ACTIVE_MODEL = 'estofaria_modelo_ativo_v1'
const GLOBAL_ITEMS_KEY = 'itens_personalizacao_global_v1'
const DEFAULT_API_BASE = 'https://estofaria-api.onrender.com'

function el(id){
  return document.getElementById(id)
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

function getApiCandidates(){
  const allowOverride = Boolean(window.ESTOFARIA_ALLOW_API_OVERRIDE)
  const candidates = [
    normalizeBaseUrl(window.API_BASE),
    allowOverride ? normalizeBaseUrl(localStorage.getItem('estofaria_api_base')) : '',
    DEFAULT_API_BASE
  ].filter(Boolean)
  return [...new Set(candidates)]
}

function buildApiUrl(base, path){
  return `${normalizeBaseUrl(base)}/api${path}`
}

function parseCurrencyToCents(value){
  const digits = String(value || '').replace(/\D/g, '')
  return Number(digits || 0)
}

function formatBRLFromCents(cents){
  return (Number(cents || 0) / 100).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  })
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

function formatQuantity(value){
  const n = parseLooseNumber(value, 0)
  return n.toLocaleString('pt-BR', {
    minimumFractionDigits: n % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2
  })
}

function normalizeModel(model, index = 0){
  const name = String(model?.name || model?.nome || `Modelo ${index + 1}`).trim()
  const id = String(model?.id || model?._id || name)
  return { id, name }
}

function readListFromStorage(key){
  try{
    const raw = JSON.parse(localStorage.getItem(key) || '[]')
    return Array.isArray(raw) ? raw : (Array.isArray(raw?.items) ? raw.items : (Array.isArray(raw?.models) ? raw.models : []))
  }catch{
    return []
  }
}

function readModelsFromStorage(key){
  return readListFromStorage(key)
    .map((item, index) => normalizeModel(item, index))
    .filter(item => item.name)
}

function mergeUniqueModels(...lists){
  const seen = new Set()
  const merged = []
  lists.flat(Infinity).forEach((item, index) => {
    const model = normalizeModel(item, index)
    const key = String(model.id || model.name).toLowerCase()
    if(!model.name || seen.has(key)) return
    seen.add(key)
    merged.push(model)
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

async function fetchJsonWithTimeout(url, options = {}, timeoutMs = 8000){
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try{
    const response = await fetch(url, { ...options, signal: controller.signal })
    return response
  } finally {
    clearTimeout(timer)
  }
}

async function fetchModelsFromApi(){
  for(const base of getApiCandidates()){
    try{
      const response = await fetchJsonWithTimeout(buildApiUrl(base, '/models?ts=' + Date.now()), {
        headers: { Accept: 'application/json' },
        cache: 'no-store'
      })
      if(!response.ok) continue
      const data = await response.json()
      const arr = Array.isArray(data) ? data : (Array.isArray(data?.models) ? data.models : [])
      const normalized = arr.map((item, index) => normalizeModel(item, index)).filter(item => item.name)
      if(normalized.length){
        saveSharedModelsCache(normalized)
        return normalized
      }
    }catch(e){
      console.error('Falha ao carregar modelos:', e)
    }
  }
  return []
}

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
    return arr.map(unit => String(unit || '').trim().toLowerCase()).filter(Boolean)
  }catch{
    return []
  }
}

async function carregarUnidades(){
  const select = el('unidade')
  if(!select) return

  const units = new Set()

  STORAGE_MATERIAL_UNIT_KEYS.forEach(key => {
    readUnitsFromStorageKey(key).forEach(unit => units.add(unit))
  })

  STORAGE_MATERIAL_KEYS.forEach(key => {
    extractUnitsFromMaterials(readListFromStorage(key)).forEach(unit => units.add(unit))
  })

  for(const base of getApiCandidates()){
    try{
      const response = await fetchJsonWithTimeout(buildApiUrl(base, '/materials?ts=' + Date.now()), {
        headers: { Accept: 'application/json' },
        cache: 'no-store'
      })
      if(!response.ok) continue
      const data = await response.json()
      const arr = Array.isArray(data) ? data : (Array.isArray(data?.materials) ? data.materials : [])
      extractUnitsFromMaterials(arr).forEach(unit => units.add(unit))
      break
    }catch(e){
      console.error('Falha ao carregar unidades:', e)
    }
  }

  select.innerHTML = ''
  const orderedUnits = [...units].sort((a, b) => a.localeCompare(b, 'pt-BR'))

  if(!orderedUnits.length){
    const opt = document.createElement('option')
    opt.value = ''
    opt.textContent = 'Cadastre unidades na aba Material'
    opt.selected = true
    select.appendChild(opt)
    select.disabled = true
    return
  }

  select.disabled = false
  orderedUnits.forEach((unit, index) => {
    const opt = document.createElement('option')
    opt.value = unit
    opt.textContent = unit
    if(index === 0) opt.selected = true
    select.appendChild(opt)
  })
}

function carregarUnidadesModalAlbum(valorAtual){
  const select = el('modalAlbumUnidade')
  if(!select) return

  const units = new Set()
  STORAGE_MATERIAL_UNIT_KEYS.forEach(key => {
    readUnitsFromStorageKey(key).forEach(u => units.add(u))
  })
  STORAGE_MATERIAL_KEYS.forEach(key => {
    extractUnitsFromMaterials(readListFromStorage(key)).forEach(u => units.add(u))
  })

  const ordered = [...units].sort((a, b) => a.localeCompare(b, 'pt-BR'))
  select.innerHTML = '<option value="">— sem unidade —</option>'

  ordered.forEach(unit => {
    const opt = document.createElement('option')
    opt.value = unit
    opt.textContent = unit
    select.appendChild(opt)
  })

  if(valorAtual){
    // Se o valor salvo não existir na lista, adiciona como opção extra
    if(!units.has(valorAtual)){
      const opt = document.createElement('option')
      opt.value = valorAtual
      opt.textContent = valorAtual
      select.appendChild(opt)
    }
    select.value = valorAtual
  }
}

function getModeloAtualKey(){
  const ids = Array.from(modelosSelecionados)
  return ids.length ? ids[0] : ''
}

function getCurrentItemsScopeKey(){
  return getModeloAtualKey() || GLOBAL_ITEMS_KEY
}

function getSelectedModelId(){
  return getModeloAtualKey()
}

function getModelosSelecionados(){
  return Array.from(modelosSelecionados)
}

function canPersistItemsToApi(){
  return !!getSelectedModelId()
}

async function apiJson(path, options = {}, timeoutMs = 8000){
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try{
    const response = await fetch(`${normalizeBaseUrl(window.API_BASE)}/api${path}`, {
      headers: { Accept:'application/json', ...(options.headers || {}) },
      cache: 'no-store',
      ...options,
      signal: controller.signal
    })
    const data = await response.json().catch(() => ({}))
    if(!response.ok){
      throw new Error(data?.message || data?.error || `Falha em ${path}`)
    }
    return data
  } finally {
    clearTimeout(timer)
  }
}

async function fetchItemsFromApi(modelId){
  if(!modelId) return []
  try{
    const data = await apiJson(`/models/${encodeURIComponent(modelId)}/personalization-items?ts=${Date.now()}`)
    return normalizeStoredItems(Array.isArray(data) ? data : (Array.isArray(data?.items) ? data.items : []))
  }catch(e){
    console.error('Falha ao carregar itens do servidor:', e)
    return []
  }
}

async function createItemOnApi(modelId, item){
  return apiJson(`/models/${encodeURIComponent(modelId)}/personalization-items`, {
    method:'POST',
    headers:{ 'Content-Type':'application/json' },
    body: JSON.stringify({
      name: item.name,
      unit: item.unit,
      price_cents: Number(item.price_cents || 0),
      consumos: item.consumos || {},
      values: { padrao: Number(item.price_cents || 0) }
    })
  })
}

async function updateItemOnApi(modelId, item){
  if(!modelId || !item?.id) return item
  return apiJson(`/models/${encodeURIComponent(modelId)}/personalization-items/${encodeURIComponent(item.id)}`, {
    method:'PUT',
    headers:{ 'Content-Type':'application/json' },
    body: JSON.stringify({
      name: item.name,
      unit: item.unit,
      price_cents: Number(item.price_cents || 0),
      consumos: item.consumos || {},
      values: { padrao: Number(item.price_cents || 0) }
    })
  })
}

async function deleteItemOnApi(modelId, itemId){
  if(!modelId || !itemId) return { ok:true }
  return apiJson(`/models/${encodeURIComponent(modelId)}/personalization-items/${encodeURIComponent(itemId)}`, {
    method:'DELETE'
  })
}

function getItemsKey(modelKey){
  return modelKey === GLOBAL_ITEMS_KEY ? GLOBAL_ITEMS_KEY : `itens_${modelKey}`
}

function getLegacyTableKey(modelKey){
  return modelKey === GLOBAL_ITEMS_KEY ? `tabela_${GLOBAL_ITEMS_KEY}` : `tabela_${modelKey}`
}

function normalizeStoredItems(arr){
  if(!Array.isArray(arr)) return []
  return arr.map(item => ({
    id: item?.id ?? null,
    name: String(item?.name || '').trim(),
    unit: String(item?.unit || item?.unidade || 'unidade').trim() || 'unidade',
    price_cents: Number(item?.price_cents ?? item?.value_cents ?? item?.valor_cents ?? item?.values?.padrao ?? 0) || parseCurrencyToCents(item?.valor || item?.price || 0),
    consumos: item?.consumos && typeof item.consumos === 'object' ? { ...item.consumos } : {}
  })).filter(item => item.name)
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
    id: item?.id ?? null,
    name: item.name,
    unit: item.unit,
    price_cents: Number(item.price_cents || 0),
    consumos: item.consumos || {}
  }))
  localStorage.setItem(getItemsKey(modelKey), JSON.stringify(payload))

  const tabela = {}
  payload.forEach((item, colIndex) => {
    Object.entries(item.consumos || {}).forEach(([metragem, valor]) => {
      if(!tabela[metragem]) tabela[metragem] = []
      tabela[metragem][colIndex] = Number(valor || 0)
    })
  })
  localStorage.setItem(getLegacyTableKey(modelKey), JSON.stringify(tabela))
}

// ── Armazenamento global de colunas + consumos por modelo ─────────────────────

const GLOBAL_ITEMS_COLS_KEY = 'esd_itens_cols_v1'

function getConsumosKey(modelId){
  if(!modelId || modelId === GLOBAL_TAG_ID) return 'esd_consumos_global'
  return `esd_consumos_${modelId}`
}

function loadGlobalCols(){
  try{
    const raw = JSON.parse(localStorage.getItem(GLOBAL_ITEMS_COLS_KEY) || '[]')
    return Array.isArray(raw) ? raw.filter(c => c?.name).map(c => ({
      id: c.id || null,
      name: String(c.name).trim(),
      unit: String(c.unit || 'unidade').trim(),
      price_cents: Number(c.price_cents || 0)
    })) : []
  }catch{ return [] }
}

function saveGlobalCols(cols){
  localStorage.setItem(GLOBAL_ITEMS_COLS_KEY, JSON.stringify(
    (Array.isArray(cols) ? cols : []).map(c => ({
      id: c.id || null,
      name: c.name,
      unit: c.unit,
      price_cents: Number(c.price_cents || 0)
    }))
  ))
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
    if(item.consumos && Object.keys(item.consumos).length > 0){
      map[item.name.toLowerCase()] = item.consumos
    }
  })
  return map
}

// Migração única: move dados antigos (por modelo) para novo formato global
function migrateToGlobalCols(){
  if(loadGlobalCols().length > 0) return
  const seen = new Set()
  const cols = []

  const tryMigrate = (items, modelId) => {
    items.forEach(item => {
      if(item.name && !seen.has(item.name.toLowerCase())){
        seen.add(item.name.toLowerCase())
        cols.push({ id: item.id || null, name: item.name, unit: item.unit, price_cents: item.price_cents })
      }
      if(modelId && Object.keys(item.consumos || {}).length > 0){
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

const GLOBAL_TAG_ID = ''

function atualizarContador(contador){
  if(!contador) return
  const n = modelosSelecionados.size
  if(n === 0){
    contador.innerText = ''
  }else if(modelosSelecionados.has(GLOBAL_TAG_ID) && n === 1){
    contador.innerText = 'Itens gerais selecionado'
  }else{
    const modelosReais = Array.from(modelosSelecionados).filter(id => id !== GLOBAL_TAG_ID).length
    contador.innerText = modelosReais ? `${modelosReais} modelo(s) selecionado(s)` : ''
  }
}

function renderModelosSelecionaveis(lista){
  const container = el('modelosContainer')
  const contador = el('contadorModelos')
  if(!container) return

  container.innerHTML = ''

  const geralTag = document.createElement('div')
  geralTag.className = 'modelo-tag' + (modelosSelecionados.has(GLOBAL_TAG_ID) ? ' active' : '')
  geralTag.innerText = 'Itens gerais'
  geralTag.dataset.id = GLOBAL_TAG_ID

  geralTag.onclick = () => {
    if(modelosSelecionados.has(GLOBAL_TAG_ID)){
      modelosSelecionados.delete(GLOBAL_TAG_ID)
      geralTag.classList.remove('active')
    }else{
      modelosSelecionados.add(GLOBAL_TAG_ID)
      geralTag.classList.add('active')
    }
    atualizarContador(contador)
    carregarItensSalvos()
  }

  container.appendChild(geralTag)

  lista.forEach(modelo => {
    const id = String(modelo.id)
    const tag = document.createElement('div')
    tag.className = 'modelo-tag' + (modelosSelecionados.has(id) ? ' active' : '')
    tag.innerText = modelo.name
    tag.dataset.id = id

    tag.onclick = () => {
      if(modelosSelecionados.has(id)){
        modelosSelecionados.delete(id)
        tag.classList.remove('active')
      }else{
        modelosSelecionados.add(id)
        tag.classList.add('active')
      }
      atualizarContador(contador)
      carregarItensSalvos()
    }

    container.appendChild(tag)
  })

  atualizarContador(contador)
}

async function carregarModelos(){
  const container = el('modelosContainer')
  if(container) container.innerHTML = '<span style="font-size:13px;opacity:0.6;">Carregando modelos...</span>'

  const localLists = STORAGE_MODELS_KEYS.map(readModelsFromStorage)
  const activeModel = getSharedActiveModel()
  const apiModels = await fetchModelsFromApi()

  modelos = mergeUniqueModels(apiModels, localLists, activeModel ? [activeModel] : [])

  if(activeModel && modelos.length){
    const found = modelos.find(m => String(m.id) === String(activeModel.id))
    if(found) modelosSelecionados.add(String(found.id))
  }

  renderModelosSelecionaveis(modelos)
  await carregarItensSalvos()
}

function limparFormulario(){
  if(el('nomeItem')) el('nomeItem').value = ''
  if(el('valorItem')) el('valorItem').value = ''
  const unidadeSelect = el('unidade')
  if(unidadeSelect && unidadeSelect.options.length){
    unidadeSelect.selectedIndex = 0
  }
}

function getConsumo(item, metragem){
  return parseLooseNumber(item?.consumos?.[metragem], 0)
}

function renderTabela(){
  const header = el('headerRow')
  const body = el('bodyRows')
  if(!header || !body) return

  header.innerHTML = '<th class="metragem-col">Metragem</th>'
  body.innerHTML = ''

  if(!itens.length){
    const tr = document.createElement('tr')
    tr.innerHTML = '<td class="empty-state" colspan="2">Nenhum item cadastrado. Cadastre um item para montar a tabela de consumo.</td>'
    body.appendChild(tr)
    renderAlbums()
    return
  }

  itens.forEach((item, index) => {
    const th = document.createElement('th')
    th.className = 'item-head'
    th.innerHTML = `
      <div class="item-head-inner">
        <div class="item-menu-wrap">
          <button type="button" class="menu-dots" onclick="openItemMenu(event, ${index})">⋮</button>
        </div>
        <div class="item-name">${escapeHtml(item.name)}</div>
        <div class="item-unit">${escapeHtml(item.unit)}</div>
        <div class="item-price">${escapeHtml(formatBRLFromCents(item.price_cents || 0))}</div>
      </div>
    `
    header.appendChild(th)
  })

  for(let i = 1; i <= 50; i++){
    const metragem = (i * 0.10).toFixed(2)
    const tr = document.createElement('tr')

    const tdMetragem = document.createElement('td')
    tdMetragem.className = 'metragem-cell'
    tdMetragem.textContent = metragem
    tr.appendChild(tdMetragem)

    itens.forEach((item, index) => {
      const td = document.createElement('td')
      td.className = 'qty-cell'
      td.innerHTML = `<input class="qty-input" inputmode="decimal" value="${escapeHtml(formatQuantity(getConsumo(item, metragem)))}" onblur="atualizarConsumo(${index}, '${metragem}', this.value)">`
      tr.appendChild(td)
    })

    body.appendChild(tr)
  }

  renderAlbums()
}

async function adicionarItem(){
  const scopeKey = getCurrentItemsScopeKey()
  const modelId = getSelectedModelId()

  const nome = String(el('nomeItem')?.value || '').trim()
  const unit = String(el('unidade')?.value || '').trim()
  const price_cents = parseCurrencyToCents(el('valorItem')?.value || '')

  if(!nome){
    alert('Digite o nome do item.')
    el('nomeItem')?.focus()
    return
  }

  if(!unit){
    alert('Cadastre uma unidade na aba Material para poder selecionar aqui.')
    el('unidade')?.focus()
    return
  }

  if(itens.some(item => item.name.toLowerCase() === nome.toLowerCase())){
    alert('Esse item já existe.')
    return
  }

  try{
    let item = {
      name: nome,
      unit,
      price_cents,
      consumos: {}
    }

    if(canPersistItemsToApi()){
      item = normalizeStoredItems([await createItemOnApi(modelId, item)])[0] || item
    }

    itens.push(item)
    saveGlobalCols(itens.map(({id, name, unit, price_cents}) => ({id, name, unit, price_cents})))
    limparFormulario()
    renderTabela()
  }catch(e){
    console.error(e)
    alert('Não foi possível adicionar o item agora: ' + e.message)
  }
}

let activeMenuIndex = null

function ensureFloatingMenu(){
  let menu = el('floatingItemMenu')
  if(menu) return menu

  menu = document.createElement('div')
  menu.id = 'floatingItemMenu'
  menu.className = 'floating-item-menu'
  menu.innerHTML = `
    <button type="button" onclick="handleEditFromMenu()">Editar</button>
    <button type="button" class="danger" onclick="handleDeleteFromMenu()">Excluir</button>
  `
  menu.addEventListener('click', event => event.stopPropagation())
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
  const menuWidth = 132
  const menuHeight = 90
  const top = rect.bottom + 6 + menuHeight > window.innerHeight ? Math.max(8, rect.top - menuHeight - 6) : rect.bottom + 6
  const left = rect.right - menuWidth < 8 ? 8 : rect.right - menuWidth

  menu.style.top = `${top}px`
  menu.style.left = `${left}px`
}

function handleEditFromMenu(){
  if(activeMenuIndex === null) return
  const index = activeMenuIndex
  closeFloatingMenu()
  editarItem(index)
}

function handleDeleteFromMenu(){
  if(activeMenuIndex === null) return
  const index = activeMenuIndex
  closeFloatingMenu()
  excluirItem(index)
}

async function editarItem(index){
  closeFloatingMenu()
  const item = itens[index]
  if(!item) return

  const novoNome = prompt('Novo nome do item:', item.name)
  if(novoNome === null) return

  const novaUnidade = prompt('Nova unidade do item:', item.unit)
  if(novaUnidade === null) return

  const novoValor = prompt('Novo valor do item:', formatBRLFromCents(item.price_cents || 0))
  if(novoValor === null) return

  item.name = String(novoNome || '').trim() || item.name
  item.unit = String(novaUnidade || '').trim() || item.unit
  item.price_cents = parseCurrencyToCents(novoValor)

  try{
    if(canPersistItemsToApi()){
      const updated = await updateItemOnApi(getSelectedModelId(), item)
      itens[index] = normalizeStoredItems([updated])[0] || item
    }
    saveGlobalCols(itens.map(({id, name, unit, price_cents}) => ({id, name, unit, price_cents})))
    renderTabela()
  }catch(e){
    console.error(e)
    alert('Não foi possível salvar a edição agora: ' + e.message)
  }
}

async function excluirItem(index){
  closeFloatingMenu()
  if(!confirm('Excluir item?')) return
  const item = itens[index]
  try{
    if(canPersistItemsToApi() && item?.id){
      await deleteItemOnApi(getSelectedModelId(), item.id)
    }
    itens.splice(index, 1)
    saveGlobalCols(itens.map(({id, name, unit, price_cents}) => ({id, name, unit, price_cents})))
    renderTabela()
  }catch(e){
    console.error(e)
    alert('Não foi possível excluir o item agora: ' + e.message)
  }
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
    try{
      await updateItemOnApi(getSelectedModelId(), item)
    }catch(e){
      console.error(e)
    }
  }
}

async function carregarItensSalvos(){
  migrateToGlobalCols()
  const modelId = getSelectedModelId()
  const consumosKey = modelId || 'global'

  let cols = loadGlobalCols()
  const consumosMap = loadModelConsumos(consumosKey)

  // Tenta carregar da API para atualizar IDs e metadados
  if(canPersistItemsToApi() && modelId){
    try{
      const apiItems = await fetchItemsFromApi(modelId)
      if(apiItems.length){
        const normalized = normalizeStoredItems(apiItems)
        // Mescla: API define os IDs; consumos locais têm prioridade para valores
        normalized.forEach(apiItem => {
          const idx = cols.findIndex(c => c.name.toLowerCase() === apiItem.name.toLowerCase())
          if(idx >= 0){
            cols[idx] = { id: apiItem.id, name: apiItem.name, unit: apiItem.unit, price_cents: apiItem.price_cents }
            if(Object.keys(apiItem.consumos || {}).length > 0 && !consumosMap[apiItem.name.toLowerCase()]){
              consumosMap[apiItem.name.toLowerCase()] = apiItem.consumos
            }
          } else {
            cols.push({ id: apiItem.id, name: apiItem.name, unit: apiItem.unit, price_cents: apiItem.price_cents })
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

  renderTabela()
}

async function salvarTabelaParaModelo(modelId, isPrimary = false){
  const consumosKey = (!modelId || modelId === GLOBAL_TAG_ID) ? 'global' : modelId

  // Salva consumos deste modelo
  saveModelConsumos(consumosKey, buildConsumosMap(itens))
  // Salva colunas globais (metadados)
  saveGlobalCols(itens.map(({id, name, unit, price_cents}) => ({id, name, unit, price_cents})))

  if(!modelId || modelId === GLOBAL_TAG_ID) return itens

  // Persiste na API se for o modelo principal
  if(isPrimary){
    const saved = []
    for(const item of itens){
      if(item?.id) saved.push(await updateItemOnApi(modelId, item))
      else saved.push(await createItemOnApi(modelId, item))
    }
    const normalizedItems = normalizeStoredItems(saved)
    // Atualiza IDs nas colunas globais
    normalizedItems.forEach(apiItem => {
      const cols = loadGlobalCols()
      const idx = cols.findIndex(c => c.name.toLowerCase() === apiItem.name.toLowerCase())
      if(idx >= 0){ cols[idx].id = apiItem.id; saveGlobalCols(cols) }
    })
    return normalizedItems
  }

  return itens
}

async function salvarTabela(){
  const ids = getModelosSelecionados()

  if(!ids.length){
    saveLocalItems(GLOBAL_ITEMS_KEY, itens)
    renderTabela()
    alert('Tabela salva (itens gerais)!')
    return
  }

  const modelosReais = ids.filter(id => id !== GLOBAL_TAG_ID)
  const temGeral = ids.includes(GLOBAL_TAG_ID)

  let msg = ''
  if(temGeral && modelosReais.length){
    msg = `Aplicar tabela para Itens gerais + ${modelosReais.length} modelo(s)?`
  }else if(temGeral){
    msg = 'Salvar em Itens gerais?'
  }else{
    msg = `Aplicar tabela para ${modelosReais.length} modelo(s)?`
  }

  if(!confirm(msg)) return

  try{
    const primaryId = getModeloAtualKey()
    let firstResult = null
    for(const id of ids){
      const isPrimary = (id === primaryId)
      const result = await salvarTabelaParaModelo(id, isPrimary)
      if(firstResult === null && result) firstResult = result
    }
    if(firstResult) itens = firstResult
    renderTabela()
    alert('Tabela aplicada com sucesso!')
  }catch(e){
    console.error(e)
    alert('Não foi possível salvar a tabela agora: ' + e.message)
  }
}

window.formatCurrency = formatCurrency
window.carregarItensSalvos = carregarItensSalvos
window.renderTabela = renderTabela
window.adicionarItem = adicionarItem
window.editarItem = editarItem
window.excluirItem = excluirItem
window.atualizarConsumo = atualizarConsumo
window.salvarTabela = salvarTabela
window.openItemMenu = openItemMenu
window.handleEditFromMenu = handleEditFromMenu
window.handleDeleteFromMenu = handleDeleteFromMenu
window.abrirModalAlbum = abrirModalAlbum
window.fecharModalAlbum = fecharModalAlbum
window.salvarAlbumDoModal = salvarAlbumDoModal
window.adicionarTecidoModal = adicionarTecidoModal
window.removerTecidoModal = removerTecidoModal
window.excluirAlbum = excluirAlbum
window.renderAlbums = renderAlbums
window.adicionarAlbumNaTabela = adicionarAlbumNaTabela

window.addEventListener('click', closeFloatingMenu)
window.addEventListener('resize', closeFloatingMenu)
window.addEventListener('scroll', closeFloatingMenu, true)

let __itensInitDone = false
async function initItensPersonalizacao(){
  if(__itensInitDone) return
  __itensInitDone = true
  await carregarUnidades()
  await carregarModelos()
}

window.addEventListener('DOMContentLoaded', initItensPersonalizacao)
window.addEventListener('load', initItensPersonalizacao)
