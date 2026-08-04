// =============================================================
//  MATERIAIS – bloco com fullscreen modal (padrão Agenda)
// =============================================================

const API = (window.API_BASE || '') + '/api'
const STORAGE_MATERIAL_UNITS = 'estofaria_material_units_v3'
const STORAGE_LAST_UPDATE    = 'estofaria_materiais_last_update'

let currentSort = 'az'

const UNIDADES_PADRAO = [
  'metro','metro quadrado','centímetro','quilograma','grama',
  'unidade','par','litro','mililitro','rolo','peça','caixa','placa','fardo'
]

const MATERIAIS_PADRAO = [
  { name:'Grampo 80/10',           unit:'caixa'          },
  { name:'Grampo 45/50',           unit:'caixa'          },
  { name:'Parafuso 45/50',         unit:'caixa'          },
  { name:'Parafuso 60/80',         unit:'caixa'          },
  { name:'Parafuso em Geral',      unit:'caixa'          },
  { name:'Molas Ensacadas',        unit:'unidade'        },
  { name:'Molas Ensacadas',        unit:'metro quadrado' },
  { name:'Cola de Contato',        unit:'litro'          },
  { name:'TNT Médio',              unit:'metro'          },
  { name:'TNT Grosso',             unit:'metro'          },
  { name:'TNT Fino',               unit:'metro'          },
  { name:'Mecanismo Retrátil',     unit:'unidade'        },
  { name:'Rodízio',                unit:'unidade'        },
  { name:'Percinta',               unit:'metro'          },
  { name:'Tecido Clássico',        unit:'metro'          },
  { name:'Tecido Premium',         unit:'metro'          },
  { name:'Tecido Alto Padrão',     unit:'metro'          },
  { name:'Madeira',                unit:'peça'           },
  { name:'Folha de MDF 18mm',      unit:'placa'          },
  { name:'Compensado 15mm',        unit:'placa'          },
  { name:'Manta Acrílica',         unit:'metro'          },
  { name:'Fibra',                  unit:'quilograma'     },
  { name:'Encaixes',               unit:'par'            },
  { name:'Saco de Embalagem',      unit:'unidade'        },
  { name:'Malha de Embalagem',     unit:'metro'          },
  { name:'Espuma D-28 Selada 1cm', unit:'metro'},{ name:'Espuma D-28 Selada 2cm', unit:'metro'},
  { name:'Espuma D-28 Selada 3cm', unit:'metro'},{ name:'Espuma D-28 Selada 4cm', unit:'metro'},
  { name:'Espuma D-28 Selada 5cm', unit:'metro'},{ name:'Espuma D-28 Selada 6cm', unit:'metro'},
  { name:'Espuma D-28 Selada 7cm', unit:'metro'},{ name:'Espuma D-28 Selada 8cm', unit:'metro'},
  { name:'Espuma D-28 Selada 9cm', unit:'metro'},{ name:'Espuma D-28 Selada 10cm',unit:'metro'},
  { name:'Espuma D-33 Selada 1cm', unit:'metro'},{ name:'Espuma D-33 Selada 2cm', unit:'metro'},
  { name:'Espuma D-33 Selada 3cm', unit:'metro'},{ name:'Espuma D-33 Selada 4cm', unit:'metro'},
  { name:'Espuma D-33 Selada 5cm', unit:'metro'},{ name:'Espuma D-33 Selada 6cm', unit:'metro'},
  { name:'Espuma D-33 Selada 7cm', unit:'metro'},{ name:'Espuma D-33 Selada 8cm', unit:'metro'},
  { name:'Espuma D-33 Selada 9cm', unit:'metro'},{ name:'Espuma D-33 Selada 10cm',unit:'metro'},
  { name:'Espuma D-45 Selada 1cm', unit:'metro'},{ name:'Espuma D-45 Selada 2cm', unit:'metro'},
  { name:'Espuma D-45 Selada 3cm', unit:'metro'},{ name:'Espuma D-45 Selada 4cm', unit:'metro'},
  { name:'Espuma D-45 Selada 5cm', unit:'metro'},{ name:'Espuma D-45 Selada 6cm', unit:'metro'},
  { name:'Espuma D-45 Selada 7cm', unit:'metro'},{ name:'Espuma D-45 Selada 8cm', unit:'metro'},
  { name:'Espuma D-45 Selada 9cm', unit:'metro'},{ name:'Espuma D-45 Selada 10cm',unit:'metro'},
  { name:'Espuma Soft 1cm',  unit:'metro'},{ name:'Espuma Soft 2cm',  unit:'metro'},
  { name:'Espuma Soft 3cm',  unit:'metro'},{ name:'Espuma Soft 4cm',  unit:'metro'},
  { name:'Espuma Soft 5cm',  unit:'metro'},{ name:'Espuma Soft 6cm',  unit:'metro'},
  { name:'Espuma Soft 7cm',  unit:'metro'},{ name:'Espuma Soft 8cm',  unit:'metro'},
  { name:'Espuma Soft 9cm',  unit:'metro'},{ name:'Espuma Soft 10cm', unit:'metro'},
]

const SEED_FLAG = 'estofaria_materiais_seeded_v3'

let units  = loadSavedUnits()
const locked = false

function ui(){ return window.ESTOFARIA_UI }
function authHeaders(extra={}){
  return window.ESTOFARIA_HTTP && typeof window.ESTOFARIA_HTTP.authHeaders === 'function'
    ? window.ESTOFARIA_HTTP.authHeaders(extra)
    : { Accept:'application/json', ...extra }
}

// ── última atualização ───────────────────────────────────────

function saveLastUpdate(){
  try{ localStorage.setItem(STORAGE_LAST_UPDATE, new Date().toISOString()) }catch{}
}

function getLastUpdateText(){
  try{
    const raw = localStorage.getItem(STORAGE_LAST_UPDATE)
    if(!raw) return null
    const d = new Date(raw)
    const day = String(d.getDate()).padStart(2,'0')
    const mon = String(d.getMonth()+1).padStart(2,'0')
    const h   = String(d.getHours()).padStart(2,'0')
    const min = String(d.getMinutes()).padStart(2,'0')
    return `Atualizado em ${day}/${mon} às ${h}:${min}`
  }catch{ return null }
}

function updateBlockMeta(total){
  const meta = document.getElementById('materiaisBlockMeta')
  if(!meta) return
  const countText = total === 1 ? '1 material' : `${total} materiais`
  const upd = getLastUpdateText()
  meta.textContent = upd ? `${countText} · ${upd}` : countText
}

function updateModalBadge(total){
  const badge = document.getElementById('materiaisModalCount')
  if(badge) badge.textContent = total
}

// ── fullscreen ────────────────────────────────────────────────

function openMateriaisFullscreen(){ renderMaterials() }
function closeMateriaisFullscreen(){}

window.toggleCadastroMaterial = function(){
  const card = document.getElementById('cadastroMaterialCard')
  const btn  = document.getElementById('matNovoBtn')
  if(!card) return
  const opening = card.hidden
  card.hidden = !opening
  if(btn) btn.classList.toggle('active', opening)
  if(opening){
    const nomeInput = document.getElementById('materialNome')
    if(nomeInput) setTimeout(()=>nomeInput.focus(), 50)
  }
}

window.setSortMateria = function(sort){
  currentSort = sort
  document.querySelectorAll('.mat-sort-btn').forEach(b => b.classList.remove('active'))
  const btn = document.getElementById(sort === 'az' ? 'sortAZ' : 'sortPrice')
  if(btn) btn.classList.add('active')
  renderMaterials()
}

// ── unidades ─────────────────────────────────────────────────

function loadSavedUnits(){
  try{
    const raw = JSON.parse(localStorage.getItem(STORAGE_MATERIAL_UNITS)||'[]')
    const arr = Array.isArray(raw) ? raw : []
    const saved = arr.map(v=>String(v||'').trim().toLowerCase()).filter(Boolean)
    return [...new Set([...UNIDADES_PADRAO,...saved])]
  }catch{ return [...UNIDADES_PADRAO] }
}

function saveUnits(){
  const n=[...new Set(units.map(v=>String(v||'').trim().toLowerCase()).filter(Boolean))]
  try{ localStorage.setItem(STORAGE_MATERIAL_UNITS,JSON.stringify(n)) }catch{}
  try{ localStorage.setItem('material_units',JSON.stringify(n)) }catch{}
}

function refreshUnits(){
  const sel=document.getElementById('materialUnidade')
  if(!sel) return
  sel.innerHTML=''
  units.forEach(u=>{ const o=document.createElement('option'); o.textContent=u; sel.appendChild(o) })
  saveUnits(); renderUnits()
}

function renderUnits(){
  const c=document.getElementById('unitsContainer')
  if(!c) return
  c.innerHTML=''
  if(!units.length){ c.innerHTML='<div class="helper-note">Nenhuma unidade cadastrada.</div>'; return }
  units.forEach((u,i)=>{
    const chip=document.createElement('div')
    chip.className='unit-chip'
    chip.innerHTML=`${u} <span class="delete-x">×</span>`
    chip.querySelector('.delete-x').onclick=()=>{ units.splice(i,1); refreshUnits(); ui().info('Unidade removida.') }
    c.appendChild(chip)
  })
}

function addUnit(){
  const input=document.getElementById('novaUnidade')
  const val=String(input?.value||'').trim().toLowerCase()
  if(!val){ ui().warning('Digite uma unidade.'); return }
  if(units.includes(val)){ ui().info('Unidade já cadastrada.'); if(input) input.value=''; return }
  units.push(val)
  if(input) input.value=''
  refreshUnits(); ui().success('Unidade adicionada.')
}

// ── API ──────────────────────────────────────────────────────

async function apiGet(path){
  return window.ESTOFARIA_HTTP.fetchJson(API+path,{headers:authHeaders(),cache:'no-store'})
}
async function apiPost(path,body){
  return window.ESTOFARIA_HTTP.fetchJson(API+path,{
    method:'POST',headers:authHeaders({'Content-Type':'application/json'}),body:JSON.stringify(body)
  })
}
async function apiPut(path,body){
  return window.ESTOFARIA_HTTP.fetchJson(API+path,{
    method:'PUT',headers:authHeaders({'Content-Type':'application/json'}),body:JSON.stringify(body)
  })
}
async function apiDelete(path){
  return window.ESTOFARIA_HTTP.fetchJson(API+path,{method:'DELETE',headers:authHeaders()})
}

// ── currency ─────────────────────────────────────────────────

function parseCents(str){
  if(!str) return 0
  const clean=String(str).replace(/[^\d,\.]/g,'').replace(',','.')
  const n=parseFloat(clean)
  return isNaN(n)?0:Math.round(n*100)
}
function centsToDisplay(cents){
  return (Number(cents||0)/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})
}
function formatCurrency(input){
  let v=input.value.replace(/\D/g,'')
  v=(v/100).toFixed(2)+''; v=v.replace('.',',')
  v=v.replace(/(\d)(?=(\d{3})+(?!\d))/g,'$1.')
  input.value='R$ '+v
}

// ── adicionar ────────────────────────────────────────────────

async function addMaterial(){
  const name=document.getElementById('materialNome').value.trim()
  const unit=document.getElementById('materialUnidade').value
  const price_cents=parseCents(document.getElementById('materialValor').value)
  if(!name){ await ui().alert('Informe o nome do material.',{title:'Campo obrigatório'}); return }
  return ui().runButtonAction('materialAddBtn',async()=>{
    try{
      await apiPost('/materials',{name,unit,price_cents})
      document.getElementById('materialNome').value=''
      document.getElementById('materialValor').value=''
      saveLastUpdate()
      const card=document.getElementById('cadastroMaterialCard')
      if(card) card.hidden=true
      const btn=document.getElementById('matNovoBtn')
      if(btn) btn.classList.remove('active')
      await renderMaterials()
    }catch(e){ ui().error('Erro ao adicionar: '+e.message) }
  },{loadingText:'Adicionando...'})
}

// ── carregar meta do bloco (sem abrir fullscreen) ────────────

async function loadBlockMeta(){
  try{
    const materials = await apiGet('/materials')
    const total = Array.isArray(materials) ? materials.length : 0
    updateBlockMeta(total)
    updateModalBadge(total)
  }catch(e){
    console.warn('[materiais] loadBlockMeta erro:', e && e.message || e)
    const meta = document.getElementById('materiaisBlockMeta')
    if(meta && meta.textContent === 'Carregando...') meta.textContent = 'Toque para abrir'
  }
}

// ── renderizar cards (dentro do fullscreen) ──────────────────

const _MAT_SKEL='<div class="mat-skeleton"><div class="mat-skeleton-line" style="width:55%"></div><div class="mat-skeleton-line" style="width:38%"></div></div>'
async function renderMaterials(){
  const container=document.getElementById('materialsContainer')
  if(!container) return

  if(!container.querySelector('.mat-card'))
    container.innerHTML=_MAT_SKEL.repeat(4)

  let materials=[]
  try{ materials=await apiGet('/materials') }catch(e){
    console.error('[materiais] renderMaterials erro:', e && e.message || e)
    if(container) container.innerHTML='<div class="materials-empty" style="color:#c0392b">Erro ao carregar materiais.<br><button onclick="renderMaterials()" style="margin-top:12px;padding:8px 18px;background:#4a67a1;color:white;border:none;border-radius:8px;font-size:14px;cursor:pointer">Tentar novamente</button></div>'
    return
  }

  // sync units
  const apiUnits=[...new Set(materials.map(m=>String(m.unit||'').trim().toLowerCase()).filter(Boolean))]
  let changed=false
  apiUnits.forEach(u=>{ if(!units.includes(u)){ units.push(u); changed=true } })
  if(changed) saveUnits()
  refreshUnits()

  const term=(document.getElementById('search')||{}).value?.toLowerCase()||''
  const visible=materials.filter(m=>!term||String(m.name||'').toLowerCase().includes(term))
  visible.sort((a,b)=>{
    if(currentSort==='price') return (a.price_cents||0)-(b.price_cents||0)
    return String(a.name||'').localeCompare(String(b.name||''),'pt-BR')
  })

  updateBlockMeta(materials.length)
  updateModalBadge(materials.length)

  container.innerHTML=''
  if(!visible.length){
    container.innerHTML=`<div class="materials-empty">${term?'Nenhum material encontrado.':'Nenhum material cadastrado ainda.'}</div>`
    return
  }

  visible.forEach(m=>{
    const card=document.createElement('div')
    card.className='mat-card'+(locked?' locked':'')

    const header=document.createElement('div')
    header.className='mat-card-header'
    const hasPrice = m.price_cents > 0
    const priceDisplay = hasPrice ? centsToDisplay(m.price_cents) : '—'
    const priceClass = hasPrice ? 'mat-card-price' : 'mat-card-price no-price'
    const noPriceBadge = hasPrice ? '' : '<span class="mat-no-price-badge">Sem preço</span>'
    header.innerHTML=`
      <span class="mat-card-name">${m.name}</span>
      <span class="mat-card-unit-badge">${m.unit}</span>
      ${noPriceBadge}
      <span class="${priceClass}">${priceDisplay}</span>
      <span class="mat-card-arrow">▼</span>`
    header.addEventListener('click',()=>card.classList.toggle('open'))

    const body=document.createElement('div')
    body.className='mat-card-body'

    const unitVal=document.createElement('span')
    unitVal.className='mat-detail-value'
    unitVal.textContent=m.unit

    const priceVal=document.createElement('span')
    priceVal.className='mat-detail-value'
    priceVal.textContent=centsToDisplay(m.price_cents)

    if(!locked){
      unitVal.contentEditable='true'
      priceVal.contentEditable='true'
      let t=null
      const scheduleSave=()=>{
        clearTimeout(t)
        t=setTimeout(async()=>{
          const nameSpan=header.querySelector('.mat-card-name')
          try{
            await apiPut('/materials/'+m.id,{
              name:nameSpan?nameSpan.textContent.trim():m.name,
              unit:unitVal.textContent.trim(),
              price_cents:parseCents(priceVal.textContent)
            })
            saveLastUpdate()
            await loadBlockMeta()
          }catch(e){ console.error(e) }
        },800)
      }
      unitVal.addEventListener('input',scheduleSave)
      priceVal.addEventListener('input',scheduleSave)
      const nameSpan=header.querySelector('.mat-card-name')
      if(nameSpan){ nameSpan.contentEditable='true'; nameSpan.addEventListener('input',scheduleSave) }
    }

    body.innerHTML=`
      <div class="mat-detail-row"><span class="mat-detail-label">Unidade</span></div>
      <div class="mat-detail-row"><span class="mat-detail-label">Valor</span></div>
      <div class="mat-card-actions"></div>`
    body.querySelectorAll('.mat-detail-row')[0].appendChild(unitVal)
    body.querySelectorAll('.mat-detail-row')[1].appendChild(priceVal)

    const actions=body.querySelector('.mat-card-actions')
    const delBtn=document.createElement('button')
    delBtn.className='btn-excluir'
    delBtn.textContent='🗑 Excluir'
    delBtn.onclick=async(e)=>{
      e.stopPropagation()
      const ok=await ui().confirm('Excluir "'+m.name+'"?',{title:'Excluir material',confirmText:'Excluir',type:'danger'})
      if(!ok) return
      try{
        await apiDelete('/materials/'+m.id)
        saveLastUpdate()
        await renderMaterials()
        ui().success('Material excluído.')
      }catch(e){ ui().error('Erro ao excluir: '+e.message) }
    }
    actions.appendChild(delBtn)

    card.appendChild(header)
    card.appendChild(body)
    container.appendChild(card)
  })
}

// ── lock / filter ────────────────────────────────────────────

function filterTable(){ renderMaterials() }

// ── seed ─────────────────────────────────────────────────────

async function seedMateriaisPadrao(){
  try{
    if(localStorage.getItem(SEED_FLAG)) return false
    const existing=await apiGet('/materials')
    if(Array.isArray(existing)&&existing.length>0){ localStorage.setItem(SEED_FLAG,'1'); return false }
    const BATCH=10
    for(let i=0;i<MATERIAIS_PADRAO.length;i+=BATCH){
      const batch=MATERIAIS_PADRAO.slice(i,i+BATCH)
      await Promise.all(batch.map(mat=>apiPost('/materials',{name:mat.name,unit:mat.unit,price_cents:0}).catch(()=>{})))
    }
    saveLastUpdate()
    localStorage.setItem(SEED_FLAG,'1')
    return true
  }catch(_){ return false }
}

// ── init ─────────────────────────────────────────────────────

refreshUnits()

function _initMateriaisData(){
  renderMaterials().then(function(){
    try{ window.parent.postMessage({ type: 'estofaria-content-ready' }, '*') }catch(_){}
  })
  seedMateriaisPadrao().then(seeded=>{ if(seeded) renderMaterials() })
}

// Se auth-guard já concluiu (shell estava no cache), inicializar agora.
// Caso contrário, aguardar o evento estofaria-auth-ready.
if(!document.documentElement.hasAttribute('data-auth-pending')){
  _initMateriaisData()
} else {
  window.addEventListener('estofaria-auth-ready', _initMateriaisData, { once: true })
  // Fallback: se o evento nunca disparar, tentar após 4 segundos
  setTimeout(_initMateriaisData, 4000)
}
