// =============================================================
//  MATERIAIS – integrado com /api/materials
//  Layout original preservado: apenas lógica reescrita
// =============================================================

const API = (window.API_BASE || '') + '/api'
const STORAGE_MATERIAL_UNITS = 'estofaria_material_units_v3'

const UNIDADES_PADRAO = [
  'metro', 'metro quadrado', 'centímetro', 'quilograma', 'grama',
  'unidade', 'par', 'litro', 'mililitro',
  'rolo', 'peça', 'caixa', 'placa', 'fardo'
]

const MATERIAIS_PADRAO = [
  { name: 'Grampo 80/10',           unit: 'caixa'         },
  { name: 'Grampo 45/50',           unit: 'caixa'         },
  { name: 'Parafuso 45/50',         unit: 'caixa'         },
  { name: 'Parafuso 60/80',         unit: 'caixa'         },
  { name: 'Parafuso em Geral',      unit: 'caixa'         },
  { name: 'Molas Ensacadas',        unit: 'unidade'       },
  { name: 'Molas Ensacadas',        unit: 'metro quadrado'},
  { name: 'Cola de Contato',         unit: 'litro'},
  { name: 'TNT Médio',              unit: 'metro'         },
  { name: 'TNT Grosso',             unit: 'metro'         },
  { name: 'TNT Fino',               unit: 'metro'         },
  { name: 'Mecanismo Retrátil',     unit: 'unidade'       },
  { name: 'Rodízio',                unit: 'unidade'       },
  { name: 'Percinta',               unit: 'metro'         },
  { name: 'Tecido Clássico',        unit: 'metro'         },
  { name: 'Tecido Premium',         unit: 'metro'         },
  { name: 'Tecido Alto Padrão',     unit: 'metro'         },
  { name: 'Madeira',                unit: 'peça'          },
  { name: 'Folha de MDF 18mm',      unit: 'placa'         },
  { name: 'Compensado 15mm',        unit: 'placa'         },
  { name: 'Manta Acrílica',         unit: 'metro'         },
  { name: 'Fibra',                  unit: 'quilograma'    },
  { name: 'Encaixes',               unit: 'par'           },
  { name: 'Saco de Embalagem',      unit: 'unidade'       },
  { name: 'Malha de Embalagem',     unit: 'metro'         },
  { name: 'Espuma D-28 Selada 1cm',  unit: 'metro'},
  { name: 'Espuma D-28 Selada 2cm',  unit: 'metro'},
  { name: 'Espuma D-28 Selada 3cm',  unit: 'metro'},
  { name: 'Espuma D-28 Selada 4cm',  unit: 'metro'},
  { name: 'Espuma D-28 Selada 5cm',  unit: 'metro'},
  { name: 'Espuma D-28 Selada 6cm',  unit: 'metro'},
  { name: 'Espuma D-28 Selada 7cm',  unit: 'metro'},
  { name: 'Espuma D-28 Selada 8cm',  unit: 'metro'},
  { name: 'Espuma D-28 Selada 9cm',  unit: 'metro'},
  { name: 'Espuma D-28 Selada 10cm', unit: 'metro'},
  { name: 'Espuma D-33 Selada 1cm',  unit: 'metro'},
  { name: 'Espuma D-33 Selada 2cm',  unit: 'metro'},
  { name: 'Espuma D-33 Selada 3cm',  unit: 'metro'},
  { name: 'Espuma D-33 Selada 4cm',  unit: 'metro'},
  { name: 'Espuma D-33 Selada 5cm',  unit: 'metro'},
  { name: 'Espuma D-33 Selada 6cm',  unit: 'metro'},
  { name: 'Espuma D-33 Selada 7cm',  unit: 'metro'},
  { name: 'Espuma D-33 Selada 8cm',  unit: 'metro'},
  { name: 'Espuma D-33 Selada 9cm',  unit: 'metro'},
  { name: 'Espuma D-33 Selada 10cm', unit: 'metro'},
  { name: 'Espuma D-45 Selada 1cm',  unit: 'metro'},
  { name: 'Espuma D-45 Selada 2cm',  unit: 'metro'},
  { name: 'Espuma D-45 Selada 3cm',  unit: 'metro'},
  { name: 'Espuma D-45 Selada 4cm',  unit: 'metro'},
  { name: 'Espuma D-45 Selada 5cm',  unit: 'metro'},
  { name: 'Espuma D-45 Selada 6cm',  unit: 'metro'},
  { name: 'Espuma D-45 Selada 7cm',  unit: 'metro'},
  { name: 'Espuma D-45 Selada 8cm',  unit: 'metro'},
  { name: 'Espuma D-45 Selada 9cm',  unit: 'metro'},
  { name: 'Espuma D-45 Selada 10cm', unit: 'metro'},
  { name: 'Espuma Soft 1cm',         unit: 'metro'},
  { name: 'Espuma Soft 2cm',         unit: 'metro'},
  { name: 'Espuma Soft 3cm',         unit: 'metro'},
  { name: 'Espuma Soft 4cm',         unit: 'metro'},
  { name: 'Espuma Soft 5cm',         unit: 'metro'},
  { name: 'Espuma Soft 6cm',         unit: 'metro'},
  { name: 'Espuma Soft 7cm',         unit: 'metro'},
  { name: 'Espuma Soft 8cm',         unit: 'metro'},
  { name: 'Espuma Soft 9cm',         unit: 'metro'},
  { name: 'Espuma Soft 10cm',        unit: 'metro'},
]

const SEED_FLAG = 'estofaria_materiais_seeded_v3'

let units    = loadSavedUnits()
let locked   = true

function ui(){
  return window.ESTOFARIA_UI
}

function getToken(){
  try{
    return window.ESTOFARIA_HTTP && typeof window.ESTOFARIA_HTTP.getToken === 'function'
      ? window.ESTOFARIA_HTTP.getToken()
      : (localStorage.getItem('auth_token') || localStorage.getItem('token') || '')
  }catch(_){
    return ''
  }
}

function authHeaders(extra = {}){
  return window.ESTOFARIA_HTTP && typeof window.ESTOFARIA_HTTP.authHeaders === 'function'
    ? window.ESTOFARIA_HTTP.authHeaders(extra)
    : { Accept:'application/json', ...extra }
}

// ---------- unidades (compartilhadas localmente) ----

function loadSavedUnits(){
  try{
    const raw = JSON.parse(localStorage.getItem(STORAGE_MATERIAL_UNITS) || '[]')
    const arr = Array.isArray(raw) ? raw : []
    const saved = arr.map(v => String(v || '').trim().toLowerCase()).filter(Boolean)
    const merged = [...new Set([...UNIDADES_PADRAO, ...saved])]
    return merged.length ? merged : [...UNIDADES_PADRAO]
  }catch{
    return [...UNIDADES_PADRAO]
  }
}

function saveUnits(){
  const normalized = [...new Set(units.map(v => String(v || '').trim().toLowerCase()).filter(Boolean))]
  try{ localStorage.setItem(STORAGE_MATERIAL_UNITS, JSON.stringify(normalized)) }catch{}
  try{ localStorage.setItem('material_units', JSON.stringify(normalized)) }catch{}
}

function refreshUnits(){
  const sel = document.getElementById('materialUnidade')
  if(!sel) return
  sel.innerHTML = ''
  units.forEach(u=>{
    const opt = document.createElement('option')
    opt.textContent = u
    sel.appendChild(opt)
  })
  saveUnits()
  renderUnits()
}

function renderUnits(){
  const container = document.getElementById('unitsContainer')
  if(!container) return
  container.innerHTML = ''
  if(!units.length){
    container.innerHTML = '<div class="helper-note">Nenhuma unidade cadastrada no momento.</div>'
    return
  }
  units.forEach((u,i)=>{
    const chip = document.createElement('div')
    chip.className = 'unit-chip'
    chip.innerHTML = `${u} <span class="delete-x">×</span>`
    chip.querySelector('.delete-x').onclick = ()=>{
      units.splice(i,1)
      refreshUnits()
      ui().info('Unidade removida da lista local.')
    }
    container.appendChild(chip)
  })
}

function addUnit(){
  const input = document.getElementById('novaUnidade')
  const val = String(input?.value || '').trim().toLowerCase()
  if(!val){
    ui().warning('Digite uma unidade antes de adicionar.')
    return
  }
  if(units.includes(val)){
    ui().info('Essa unidade já está cadastrada.')
    if(input) input.value = ''
    return
  }
  units.push(val)
  if(input) input.value = ''
  refreshUnits()
  ui().success('Unidade adicionada com sucesso.')
}

// ---------- materiais (persistem no servidor) ---------------

async function apiGet(path){
  return window.ESTOFARIA_HTTP.fetchJson(API + path, {
    headers: authHeaders(),
    cache:'no-store'
  })
}

async function apiPost(path, body){
  return window.ESTOFARIA_HTTP.fetchJson(API + path, {
    method:'POST',
    headers: authHeaders({'Content-Type':'application/json'}),
    body: JSON.stringify(body)
  })
}

async function apiPut(path, body){
  return window.ESTOFARIA_HTTP.fetchJson(API + path, {
    method:'PUT',
    headers: authHeaders({'Content-Type':'application/json'}),
    body: JSON.stringify(body)
  })
}

async function apiDelete(path){
  return window.ESTOFARIA_HTTP.fetchJson(API + path, {
    method:'DELETE',
    headers: authHeaders()
  })
}

// ---------- parseCurrency -----------------------------------

function parseCents(str){
  if(!str) return 0
  const clean = String(str).replace(/[^\d,\.]/g,'').replace(',','.')
  const n = parseFloat(clean)
  return isNaN(n) ? 0 : Math.round(n * 100)
}

function centsToDisplay(cents){
  return (Number(cents||0)/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})
}

// ---------- adicionar material ------------------------------

async function addMaterial(){
  const name  = document.getElementById('materialNome').value.trim()
  const unit  = document.getElementById('materialUnidade').value
  const rawV  = document.getElementById('materialValor').value
  const price_cents = parseCents(rawV)

  if(!name){
    await ui().alert('Informe o nome do material.', { title: 'Campo obrigatório' })
    return
  }

  return ui().runButtonAction('materialAddBtn', async () => {
    try{
      await apiPost('/materials', { name, unit, price_cents })
      document.getElementById('materialNome').value  = ''
      document.getElementById('materialValor').value = ''
      await renderMaterials()
      ui().success('Material adicionado com sucesso.')
    }catch(e){
      console.error(e)
      ui().error('Erro ao adicionar: ' + e.message)
    }
  }, { loadingText: 'Adicionando...' })
}

// ---------- renderizar materiais ----------------------------

async function renderMaterials(){
  const table = document.getElementById('materialsTable')
  if(!table) return

  let materials = []
  try{
    materials = await apiGet('/materials')
  }catch(e){
    console.error(e)
  }

  const apiUnits = [...new Set(materials.map(m => String(m.unit || '').trim().toLowerCase()).filter(Boolean))]
  let changedUnits = false
  apiUnits.forEach(unit => {
    if(!units.includes(unit)){
      units.push(unit)
      changedUnits = true
    }
  })
  if(changedUnits) saveUnits()
  refreshUnits()

  table.innerHTML = ''

  const term = (document.getElementById('search')||{}).value?.toLowerCase() || ''
  const visibleMaterials = materials.filter(m => !term || String(m.name || '').toLowerCase().includes(term))

  if(!visibleMaterials.length){
    table.innerHTML = `<tr><td colspan="4" class="table-empty">${term ? 'Nenhum material encontrado para esta busca.' : 'Nenhum material cadastrado ainda.'}</td></tr>`
    return
  }

  visibleMaterials.forEach(m=>{
    const tr = document.createElement('tr')
    const nameCell  = document.createElement('td')
    const unitCell  = document.createElement('td')
    const valueCell = document.createElement('td')
    const delCell   = document.createElement('td')

    nameCell.textContent  = m.name
    unitCell.textContent  = m.unit
    valueCell.textContent = centsToDisplay(m.price_cents)

    if(!locked){
      nameCell.contentEditable  = true
      unitCell.contentEditable  = true
      valueCell.contentEditable = true

      let saveTimeout = null
      const scheduleSave = ()=>{
        clearTimeout(saveTimeout)
        saveTimeout = setTimeout(async ()=>{
          const newCents = parseCents(valueCell.textContent)
          try{
            await apiPut('/materials/'+m.id,{
              name:  nameCell.textContent.trim(),
              unit:  unitCell.textContent.trim(),
              price_cents: newCents
            })
          }catch(e){ console.error(e) }
        }, 800)
      }

      nameCell.oninput  = scheduleSave
      unitCell.oninput  = scheduleSave
      valueCell.oninput = scheduleSave
    } else {
      tr.classList.add('locked')
    }

    delCell.innerHTML = '<span class="delete-x">×</span>'
    delCell.onclick = async ()=>{
      const confirmed = await ui().confirm('Excluir "'+m.name+'"?', {
        title: 'Excluir material',
        confirmText: 'Excluir',
        type: 'danger'
      })
      if(!confirmed) return
      try{
        await apiDelete('/materials/'+m.id)
        await renderMaterials()
        ui().success('Material excluído com sucesso.')
      }catch(e){
        console.error(e)
        ui().error('Erro ao excluir: '+e.message)
      }
    }

    tr.appendChild(nameCell)
    tr.appendChild(unitCell)
    tr.appendChild(valueCell)
    tr.appendChild(delCell)
    table.appendChild(tr)
  })
}

// ---------- lock / filter -----------------------------------

function toggleLock(){
  locked = !locked
  const btn = document.getElementById('lockBtn')
  if(btn) btn.textContent = locked ? '🔒 Tabela trancada' : '🔓 Tabela destrancada'
  renderMaterials()
}

function filterTable(){
  renderMaterials()
}

// ---------- currency format input ---------------------------

function formatCurrency(input){
  let value = input.value.replace(/\D/g,'')
  value = (value/100).toFixed(2)+''
  value = value.replace('.',',')
  value = value.replace(/(\d)(?=(\d{3})+(?!\d))/g,'$1.')
  input.value = 'R$ '+value
}

// ---------- seed materiais padrão ---------------------------

function showSeedingIndicator(){
  const table = document.getElementById('materialsTable')
  if(table) table.innerHTML = `<tr><td colspan="4" style="text-align:center;padding:32px;color:#64748b;font-size:14px;">⏳ Configurando materiais padrão, aguarde...</td></tr>`
}

async function seedMateriaisPadrao(){
  try{
    if(localStorage.getItem(SEED_FLAG)) return
    const existing = await apiGet('/materials')
    if(Array.isArray(existing) && existing.length > 0){
      localStorage.setItem(SEED_FLAG, '1')
      return
    }
    showSeedingIndicator()
    const BATCH = 10
    for(let i = 0; i < MATERIAIS_PADRAO.length; i += BATCH){
      const batch = MATERIAIS_PADRAO.slice(i, i + BATCH)
      await Promise.all(batch.map(mat =>
        apiPost('/materials', { name: mat.name, unit: mat.unit, price_cents: 0 }).catch(()=>{})
      ))
    }
    localStorage.setItem(SEED_FLAG, '1')
  }catch(_){}
}

// ---------- init --------------------------------------------

refreshUnits()
renderMaterials()
seedMateriaisPadrao().then(() => renderMaterials())
