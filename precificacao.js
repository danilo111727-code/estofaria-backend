const API = (window.API_BASE || '') + '/api'

let catalogoMateriais = []
let materiaisModelo = []
let modelos = []
let modeloEditandoId = null
let booted = false

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

async function carregarTudo(){
  await Promise.all([carregarMateriaisCatalogo(), carregarModelos()])
}

async function apiGet(path){
  const r = await fetch(API + path)
  if(!r.ok) throw new Error('Falha ao carregar ' + path)
  return r.json()
}

async function apiSend(path, method, body){
  const r = await fetch(API + path, {
    method,
    headers:{ 'Content-Type':'application/json' },
    body: JSON.stringify(body)
  })
  if(!r.ok){
    const e = await r.json().catch(()=>({}))
    throw new Error(e.error || ('Falha em ' + method + ' ' + path))
  }
  return r.json()
}

function formatCurrency(input){
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
    alert('Selecione um material válido.')
    return
  }

  if(!(qtd > 0)){
    alert('Informe a quantidade do material.')
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
}

function deleteMaterial(i){
  materiaisModelo.splice(i,1)
  renderMateriais()
}

function renderMateriais(){
  const table = document.getElementById('materiaisTabela')
  if(!table) return
  table.innerHTML = ''

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
    alert('Informe o nome do modelo.')
    return
  }

  if(!(base > 0)){
    alert('Informe a medida base do modelo.')
    return
  }

  const body = {
    name: nome,
    base_meters: base,
    spacing_cm: spacingCm,
    total_cost_cents: totalCost,
    target_profit_cents: targetProfit,
    sale_price_cents: salePrice,
    materials: materiaisModelo
  }

  try{
    if(modeloEditandoId){
      await apiSend('/models/' + modeloEditandoId, 'PUT', body)
      alert('Modelo atualizado com sucesso.')
    }else{
      await apiSend('/models', 'POST', body)
      alert('Modelo salvo com sucesso.')
    }

    limparFormulario()
    await carregarModelos()
  }catch(e){
    console.error(e)
    alert(e.message || 'Erro ao salvar modelo.')
  }
}

async function carregarModelos(){
  try{
    modelos = await apiGet('/models')
  }catch(e){
    console.error(e)
    modelos = []
  }
  renderModelos()
}

function renderModelos(){
  const table = document.getElementById('listaModelos')
  if(!table) return

  const term = (document.getElementById('searchModelo')?.value || '').trim().toLowerCase()
  table.innerHTML = ''

  modelos
    .filter(m => !term || String(m.name || '').toLowerCase().includes(term))
    .forEach(m=>{
      const tr = document.createElement('tr')
      tr.innerHTML = `
        <td>${escapeHtml(m.name)}</td>
        <td>${formatQty(m.base_meters)} m</td>
        <td>${formatBRLFromCents(m.sale_price_cents)}</td>
        <td>${formatDate(m.updated_at || m.created_at)}</td>
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
  document.getElementById('modeloNome').value = modelo.name || ''
  document.getElementById('baseMedida').value = formatQty(modelo.base_meters)
  document.getElementById('lucroDesejado').value = formatBRLFromCents(modelo.target_profit_cents || 0)
  aplicarSpacing(modelo.spacing_cm)
  materiaisModelo = Array.isArray(modelo.materials) ? modelo.materials.map(m=>({ ...m })) : []
  renderMateriais()
}

async function excluirModelo(id){
  if(!confirm('Excluir este modelo?')) return

  try{
    await apiSend('/models/' + id, 'DELETE', {})
    if(modeloEditandoId === id) limparFormulario()
    await carregarModelos()
  }catch(e){
    console.error(e)
    alert(e.message || 'Erro ao excluir modelo.')
  }
}

function limparFormulario(){
  modeloEditandoId = null
  materiaisModelo = []

  const ids = ['modeloNome','baseMedida','lucroDesejado','materialQtd','searchModelo']
  ids.forEach(id=>{
    const el = document.getElementById(id)
    if(el && id !== 'searchModelo') el.value = ''
  })

  aplicarSpacing(10)
  renderMateriais()
  renderModelos()
}

function filtrarModelos(){
  renderModelos()
}

function gerarPDF(){
  alert('PDF da precificação fica para a próxima etapa. Nesta fase eu priorizei a persistência real e a integração entre abas.')
}

function aplicarSpacing(spacingCm){
  const select = document.getElementById('espacamento')
  if(!select) return

  const alvo = spacingCm === 100 ? '1 m' : `${spacingCm} cm`
  const achou = Array.from(select.options).find(opt => opt.textContent.trim() === alvo)
  if(achou) select.value = achou.value
}

function formatDate(v){
  const d = new Date(v)
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

window.addMaterial = addMaterial
window.deleteMaterial = deleteMaterial
window.salvarModelo = salvarModelo
window.editarModelo = editarModelo
window.excluirModelo = excluirModelo
window.filtrarModelos = filtrarModelos
window.gerarPDF = gerarPDF
window.formatCurrency = function(input){
  formatCurrency(input)
  updateResumo()
}
