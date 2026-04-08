const express = require('express')
const { requireAuth } = require('../middleware/auth')
const { readStore, writeStore, upsertAudit, nowIso } = require('../lib/store')

const router = express.Router()

function ensureCollections(store){
  if(!Array.isArray(store.materials)) store.materials = []
  if(!Array.isArray(store.models)) store.models = []
  if(!Array.isArray(store.personalizationItems)) store.personalizationItems = []
  if(!Array.isArray(store.agendaConfigs)) store.agendaConfigs = []
  if(!Array.isArray(store.agendaOrders)) store.agendaOrders = []
  if(!Array.isArray(store.quotes)) store.quotes = []
  if(!store.counters || typeof store.counters !== 'object') store.counters = {}
  return store
}

function nextId(store, key){
  ensureCollections(store)
  const current = Number(store.counters[key] || 0) + 1
  store.counters[key] = current
  return current
}

function text(value, fallback = ''){
  return String(value ?? fallback).trim()
}

function num(value, fallback = 0){
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function toDateOnly(value){
  const raw = text(value)
  if(!raw) return ''
  if(/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw
  const d = new Date(raw)
  if(Number.isNaN(d.getTime())) return ''
  return d.toISOString().slice(0, 10)
}

function getCompanyContext(req, store){
  const explicit = text(
    req.query.company_id || req.body?.company_id || req.params.companyId || req.user?.company_id || req.user?.company?.id || ''
  )
  if(explicit){
    const company = (store.companies || []).find(item => String(item.id) === explicit)
    if(company) return company
  }
  if(req.user?.company_id){
    return (store.companies || []).find(item => String(item.id) === String(req.user.company_id)) || null
  }
  return (store.companies || [])[0] || null
}

function seedCompanyData(store, companyId){
  ensureCollections(store)
  const cid = String(companyId)
  const hasAny = store.materials.some(item => String(item.company_id) === cid)
    || store.models.some(item => String(item.company_id) === cid)
    || store.agendaOrders.some(item => String(item.company_id) === cid)
    || store.quotes.some(item => String(item.company_id) === cid)

  if(!store.agendaConfigs.some(item => String(item.company_id) === cid)){
    store.agendaConfigs.push({
      id: nextId(store, 'agendaConfigs'),
      company_id: companyId,
      prazo_dias: 7,
      vagas_semana: 5,
      tipo_dias: 'corrido',
      created_at: nowIso(),
      updated_at: nowIso()
    })
  }

  if(hasAny) return

  const tecidoId = nextId(store, 'materials')
  const espumaId = nextId(store, 'materials')
  store.materials.push(
    {
      id: tecidoId,
      company_id: companyId,
      name: 'Tecido Suede',
      unit: 'metro',
      price_cents: 4590,
      created_at: nowIso(),
      updated_at: nowIso()
    },
    {
      id: espumaId,
      company_id: companyId,
      name: 'Espuma D28',
      unit: 'unidade',
      price_cents: 1890,
      created_at: nowIso(),
      updated_at: nowIso()
    }
  )

  const modelId = nextId(store, 'models')
  store.models.push({
    id: modelId,
    company_id: companyId,
    name: 'Sofá 2 lugares',
    base_meters: 2.2,
    spacing_cm: 10,
    total_cost_cents: 28000,
    target_profit_cents: 17000,
    sale_price_cents: 45000,
    materials: [
      { material_id: tecidoId, material_name: 'Tecido Suede', unit: 'metro', quantity: 4, unit_price_cents: 4590, total_cents: 18360 },
      { material_id: espumaId, material_name: 'Espuma D28', unit: 'unidade', quantity: 5, unit_price_cents: 1890, total_cents: 9450 }
    ],
    created_at: nowIso(),
    updated_at: nowIso()
  })

  store.personalizationItems.push(
    {
      id: nextId(store, 'personalizationItems'),
      company_id: companyId,
      model_id: modelId,
      name: 'Botão encapado',
      unit: 'unidade',
      values: { padrao: 1200 },
      created_at: nowIso(),
      updated_at: nowIso()
    },
    {
      id: nextId(store, 'personalizationItems'),
      company_id: companyId,
      model_id: modelId,
      name: 'Pé de madeira',
      unit: 'jogo',
      values: { padrao: 3500 },
      created_at: nowIso(),
      updated_at: nowIso()
    }
  )

  const orderId = nextId(store, 'agendaOrders')
  store.agendaOrders.push({
    id: orderId,
    company_id: companyId,
    cliente: 'Cliente Demo',
    descricao: 'Reforma de sofá retrátil',
    prod_date: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    ent_date: new Date(Date.now() + 9 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    tecido: 'Suede cinza',
    qtd: 1,
    tecido_comprado: false,
    status: 'pendente',
    created_at: nowIso(),
    updated_at: nowIso()
  })

  store.quotes.push({
    id: nextId(store, 'quotes'),
    company_id: companyId,
    cliente: 'Cliente Demo',
    status: 'pedido',
    total_cents: 45000,
    payload: {
      cliente: 'Cliente Demo',
      modelos: [
        {
          model_id: modelId,
          modelo: 'Sofá 2 lugares',
          preco: 450,
          preco_cents: 45000,
          metragem: '2.20',
          itens: [],
          subtotal: 450,
          subtotal_cents: 45000
        }
      ],
      total: 450,
      total_cents: 45000,
      totais: { vista: 450, cartao: 495, nfvista: 495, nfcartao: 540 }
    },
    created_at: nowIso(),
    updated_at: nowIso()
  })
}

function audit(store, req, companyId, action, detail){
  upsertAudit(store, {
    company_id: companyId,
    action,
    message: detail,
    actor_name: req.user?.name || req.user?.email || 'Usuário',
    actor_email: req.user?.email || '',
    actor_role: req.user?.role || 'user',
    source: 'operations-api'
  })
}

function modelToFrontend(model){
  const sale = num(model.sale_price_cents || model.price_cents, 0)
  const base = num(model.base_meters, 0)
  const pricePerMeter = base > 0 ? Math.round(sale / base) : sale
  const image = text(model.image_data_url || model.imageDataUrl || model.foto_data_url || model.fotoDataUrl)
  return {
    ...model,
    nome: model.name,
    baseMeters: base,
    spacingCm: num(model.spacing_cm, 10),
    priceCents: sale,
    price_cents: sale,
    pricePerMeterCents: pricePerMeter,
    image_data_url: image,
    imageDataUrl: image,
    foto_data_url: image,
    fotoDataUrl: image,
    materials: Array.isArray(model.materials) ? model.materials : []
  }
}

function easterSunday(year){
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)
  const day = ((h + l - 7 * m + 114) % 31) + 1
  return new Date(Date.UTC(year, month - 1, day))
}

function addDaysUtc(date, days){
  const d = new Date(date)
  d.setUTCDate(d.getUTCDate() + days)
  return d
}

function toIsoUtc(date){
  return new Date(date).toISOString().slice(0, 10)
}

function getBrazilNationalHolidays(year){
  const easter = easterSunday(year)
  const fixed = [
    { date: `${year}-01-01`, name: 'Confraternização Universal' },
    { date: `${year}-04-21`, name: 'Tiradentes' },
    { date: `${year}-05-01`, name: 'Dia do Trabalho' },
    { date: `${year}-09-07`, name: 'Independência do Brasil' },
    { date: `${year}-10-12`, name: 'Nossa Senhora Aparecida' },
    { date: `${year}-11-02`, name: 'Finados' },
    { date: `${year}-11-15`, name: 'Proclamação da República' },
    { date: `${year}-11-20`, name: 'Dia Nacional de Zumbi e da Consciência Negra' },
    { date: `${year}-12-25`, name: 'Natal' }
  ]
  const movable = [
    { date: toIsoUtc(addDaysUtc(easter, -2)), name: 'Paixão de Cristo' }
  ]
  return fixed.concat(movable).map(item => ({ ...item, scope: 'national' })).sort((a, b) => a.date.localeCompare(b.date))
}

function personalizationItemToFrontend(item){
  const values = item && typeof item.values === 'object' && item.values ? { ...item.values } : {}
  const valueCents = Number(
    item?.price_cents
    ?? item?.value_cents
    ?? values.padrao
    ?? values['1.00']
    ?? 0
  ) || 0
  return {
    id: item.id,
    name: item.name,
    unit: item.unit || 'unidade',
    values,
    value_cents: valueCents,
    price_cents: valueCents,
    consumos: item?.consumos && typeof item.consumos === 'object' ? { ...item.consumos } : {}
  }
}

router.use(requireAuth)

router.get('/materials', (req, res) => {
  const store = ensureCollections(readStore())
  const company = getCompanyContext(req, store)
  if(!company) return res.status(404).json({ error:'company_not_found', message:'Empresa não encontrada.' })
  seedCompanyData(store, company.id)
  writeStore(store)
  const rows = store.materials
    .filter(item => String(item.company_id) === String(company.id))
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'pt-BR'))
  return res.json(rows)
})

router.post('/materials', (req, res) => {
  const store = ensureCollections(readStore())
  const company = getCompanyContext(req, store)
  if(!company) return res.status(404).json({ error:'company_not_found', message:'Empresa não encontrada.' })
  const name = text(req.body?.name)
  const unit = text(req.body?.unit, 'unidade').toLowerCase()
  const price_cents = Math.max(0, Math.round(num(req.body?.price_cents, 0)))
  if(!name) return res.status(400).json({ error:'invalid_request', message:'Informe o nome do material.' })
  const row = { id: nextId(store, 'materials'), company_id: company.id, name, unit, price_cents, created_at: nowIso(), updated_at: nowIso() }
  store.materials.push(row)
  audit(store, req, company.id, 'material.create', `Material criado: ${name}`)
  writeStore(store)
  return res.status(201).json(row)
})

router.put('/materials/:id', (req, res) => {
  const store = ensureCollections(readStore())
  const company = getCompanyContext(req, store)
  const row = store.materials.find(item => String(item.company_id) === String(company?.id) && String(item.id) === String(req.params.id))
  if(!row) return res.status(404).json({ error:'not_found', message:'Material não encontrado.' })
  const name = text(req.body?.name || row.name)
  const unit = text(req.body?.unit || row.unit, 'unidade').toLowerCase()
  const price_cents = Math.max(0, Math.round(num(req.body?.price_cents, row.price_cents)))
  Object.assign(row, { name, unit, price_cents, updated_at: nowIso() })
  audit(store, req, company.id, 'material.update', `Material atualizado: ${name}`)
  writeStore(store)
  return res.json(row)
})

router.patch('/materials/:id', (req, res) => {
    const store = ensureCollections(readStore())
    const company = getCompanyContext(req, store)
    if(!company) return res.status(404).json({ error:'company_not_found', message:'Empresa não encontrada.' })
    const id = Number(req.params.id)
    const idx = store.materials.findIndex(item => item.id === id && String(item.company_id) === String(company.id))
    if(idx === -1) return res.status(404).json({ error:'not_found', message:'Material não encontrado.' })
    const { name, unit, price_cents } = req.body
    if(name !== undefined) store.materials[idx].name = text(name)
    if(unit !== undefined) store.materials[idx].unit = text(unit)
    if(price_cents !== undefined) store.materials[idx].price_cents = num(price_cents)
    store.materials[idx].updated_at = nowIso()
    audit(store, req, company.id, 'material.updated', `Material #${id} atualizado (patch).`)
    writeStore(store)
    return res.json(store.materials[idx])
  })

  router.delete('/materials/:id', (req, res) => {
  const store = ensureCollections(readStore())
  const company = getCompanyContext(req, store)
  const before = store.materials.length
  store.materials = store.materials.filter(item => !(String(item.company_id) === String(company?.id) && String(item.id) === String(req.params.id)))
  if(store.materials.length === before) return res.status(404).json({ error:'not_found', message:'Material não encontrado.' })
  audit(store, req, company.id, 'material.delete', `Material removido: ${req.params.id}`)
  writeStore(store)
  return res.json({ ok:true })
})

router.get('/models', (req, res) => {
  const store = ensureCollections(readStore())
  const company = getCompanyContext(req, store)
  if(!company) return res.status(404).json({ error:'company_not_found', message:'Empresa não encontrada.' })
  seedCompanyData(store, company.id)
  writeStore(store)
  const rows = store.models.filter(item => String(item.company_id) === String(company.id)).map(modelToFrontend)
  return res.json(rows)
})

router.post('/models', (req, res) => {
  const store = ensureCollections(readStore())
  const company = getCompanyContext(req, store)
  if(!company) return res.status(404).json({ error:'company_not_found', message:'Empresa não encontrada.' })
  const name = text(req.body?.name)
  if(!name) return res.status(400).json({ error:'invalid_request', message:'Informe o nome do modelo.' })
  const image = text(req.body?.image_data_url || req.body?.imageDataUrl || req.body?.foto_data_url || req.body?.fotoDataUrl)
  const row = {
    id: nextId(store, 'models'),
    company_id: company.id,
    name,
    base_meters: Math.max(0, num(req.body?.base_meters, 0)),
    spacing_cm: Math.max(1, num(req.body?.spacing_cm, 10)),
    total_cost_cents: Math.max(0, Math.round(num(req.body?.total_cost_cents, 0))),
    target_profit_cents: Math.max(0, Math.round(num(req.body?.target_profit_cents, 0))),
    sale_price_cents: Math.max(0, Math.round(num(req.body?.sale_price_cents, 0))),
    image_data_url: image,
    materials: Array.isArray(req.body?.materials) ? req.body.materials : [],
    created_at: nowIso(),
    updated_at: nowIso()
  }
  store.models.push(row)
  audit(store, req, company.id, 'model.create', `Modelo criado: ${name}`)
  writeStore(store)
  return res.status(201).json(modelToFrontend(row))
})

router.put('/models/:id', (req, res) => {
  const store = ensureCollections(readStore())
  const company = getCompanyContext(req, store)
  const row = store.models.find(item => String(item.company_id) === String(company?.id) && String(item.id) === String(req.params.id))
  if(!row) return res.status(404).json({ error:'not_found', message:'Modelo não encontrado.' })
  const image = text(req.body?.image_data_url || req.body?.imageDataUrl || req.body?.foto_data_url || req.body?.fotoDataUrl || row.image_data_url)
  Object.assign(row, {
    name: text(req.body?.name || row.name),
    base_meters: Math.max(0, num(req.body?.base_meters, row.base_meters)),
    spacing_cm: Math.max(1, num(req.body?.spacing_cm, row.spacing_cm)),
    total_cost_cents: Math.max(0, Math.round(num(req.body?.total_cost_cents, row.total_cost_cents))),
    target_profit_cents: Math.max(0, Math.round(num(req.body?.target_profit_cents, row.target_profit_cents))),
    sale_price_cents: Math.max(0, Math.round(num(req.body?.sale_price_cents, row.sale_price_cents))),
    image_data_url: image,
    materials: Array.isArray(req.body?.materials) ? req.body.materials : (Array.isArray(row.materials) ? row.materials : []),
    updated_at: nowIso()
  })
  audit(store, req, company.id, 'model.update', `Modelo atualizado: ${row.name}`)
  writeStore(store)
  return res.json(modelToFrontend(row))
})

router.delete('/models/:id', (req, res) => {
  const store = ensureCollections(readStore())
  const company = getCompanyContext(req, store)
  const before = store.models.length
  store.models = store.models.filter(item => !(String(item.company_id) === String(company?.id) && String(item.id) === String(req.params.id)))
  store.personalizationItems = store.personalizationItems.filter(item => !(String(item.company_id) === String(company?.id) && String(item.model_id) === String(req.params.id)))
  if(store.models.length === before) return res.status(404).json({ error:'not_found', message:'Modelo não encontrado.' })
  audit(store, req, company.id, 'model.delete', `Modelo removido: ${req.params.id}`)
  writeStore(store)
  return res.json({ ok:true })
})

router.get('/models/:id/personalization-items', (req, res) => {
  const store = ensureCollections(readStore())
  const company = getCompanyContext(req, store)
  if(!company) return res.json([])
  seedCompanyData(store, company.id)
  writeStore(store)
  const rows = store.personalizationItems
    .filter(item => String(item.company_id) === String(company.id) && String(item.model_id) === String(req.params.id))
    .map(personalizationItemToFrontend)
  return res.json(rows)
})

router.post('/models/:id/personalization-items', (req, res) => {
  const store = ensureCollections(readStore())
  const company = getCompanyContext(req, store)
  if(!company) return res.status(404).json({ error:'company_not_found', message:'Empresa não encontrada.' })
  const model = store.models.find(item => String(item.company_id) === String(company.id) && String(item.id) === String(req.params.id))
  if(!model) return res.status(404).json({ error:'not_found', message:'Modelo não encontrado.' })

  const name = text(req.body?.name)
  const unit = text(req.body?.unit, 'unidade')
  const price_cents = Math.max(0, Math.round(num(req.body?.price_cents ?? req.body?.value_cents, 0)))
  const consumos = req.body?.consumos && typeof req.body.consumos === 'object' ? { ...req.body.consumos } : {}
  const values = req.body?.values && typeof req.body.values === 'object'
    ? { ...req.body.values }
    : { padrao: price_cents }

  if(!name) return res.status(400).json({ error:'invalid_request', message:'Informe o nome do item.' })

  const row = {
    id: nextId(store, 'personalizationItems'),
    company_id: company.id,
    model_id: model.id,
    name,
    unit,
    price_cents,
    value_cents: price_cents,
    values,
    consumos,
    created_at: nowIso(),
    updated_at: nowIso()
  }

  store.personalizationItems.push(row)
  audit(store, req, company.id, 'personalization_item.create', `Item criado: ${name}`)
  writeStore(store)
  return res.status(201).json(personalizationItemToFrontend(row))
})

router.put('/models/:id/personalization-items/:itemId', (req, res) => {
  const store = ensureCollections(readStore())
  const company = getCompanyContext(req, store)
  if(!company) return res.status(404).json({ error:'company_not_found', message:'Empresa não encontrada.' })

  const row = store.personalizationItems.find(item => (
    String(item.company_id) === String(company.id)
    && String(item.model_id) === String(req.params.id)
    && String(item.id) === String(req.params.itemId)
  ))
  if(!row) return res.status(404).json({ error:'not_found', message:'Item não encontrado.' })

  const price_cents = Math.max(0, Math.round(num(req.body?.price_cents ?? req.body?.value_cents, row.price_cents || row.value_cents || 0)))
  row.name = text(req.body?.name || row.name)
  row.unit = text(req.body?.unit || row.unit, 'unidade')
  row.price_cents = price_cents
  row.value_cents = price_cents
  row.values = req.body?.values && typeof req.body.values === 'object'
    ? { ...req.body.values }
    : { ...(row.values || {}), padrao: price_cents }
  row.consumos = req.body?.consumos && typeof req.body.consumos === 'object' ? { ...req.body.consumos } : (row.consumos || {})
  row.updated_at = nowIso()

  audit(store, req, company.id, 'personalization_item.update', `Item atualizado: ${row.name}`)
  writeStore(store)
  return res.json(personalizationItemToFrontend(row))
})

router.delete('/models/:id/personalization-items/:itemId', (req, res) => {
  const store = ensureCollections(readStore())
  const company = getCompanyContext(req, store)
  if(!company) return res.status(404).json({ error:'company_not_found', message:'Empresa não encontrada.' })
  const before = store.personalizationItems.length
  store.personalizationItems = store.personalizationItems.filter(item => !(
    String(item.company_id) === String(company.id)
    && String(item.model_id) === String(req.params.id)
    && String(item.id) === String(req.params.itemId)
  ))
  if(store.personalizationItems.length === before) return res.status(404).json({ error:'not_found', message:'Item não encontrado.' })
  audit(store, req, company.id, 'personalization_item.delete', `Item removido: ${req.params.itemId}`)
  writeStore(store)
  return res.json({ ok:true })
})

router.get('/agenda/config', (req, res) => {
  const store = ensureCollections(readStore())
  const company = getCompanyContext(req, store)
  if(!company) return res.status(404).json({ error:'company_not_found', message:'Empresa não encontrada.' })
  seedCompanyData(store, company.id)
  writeStore(store)
  const row = store.agendaConfigs.find(item => String(item.company_id) === String(company.id))
  return res.json(row || { prazo_dias: 7, vagas_semana: 5, tipo_dias: 'corrido' })
})

router.patch('/agenda/config', (req, res) => {
  const store = ensureCollections(readStore())
  const company = getCompanyContext(req, store)
  if(!company) return res.status(404).json({ error:'company_not_found', message:'Empresa não encontrada.' })
  let row = store.agendaConfigs.find(item => String(item.company_id) === String(company.id))
  if(!row){
    row = { id: nextId(store, 'agendaConfigs'), company_id: company.id, created_at: nowIso(), updated_at: nowIso() }
    store.agendaConfigs.push(row)
  }
  Object.assign(row, {
    prazo_dias: Math.max(0, Math.round(num(req.body?.prazo_dias, row.prazo_dias || 7))),
    vagas_semana: Math.max(1, Math.round(num(req.body?.vagas_semana, row.vagas_semana || 5))),
    tipo_dias: ['uteis','corrido'].includes(text(req.body?.tipo_dias, row.tipo_dias || 'corrido')) ? text(req.body?.tipo_dias, row.tipo_dias || 'corrido') : 'corrido',
    updated_at: nowIso()
  })
  audit(store, req, company.id, 'agenda.config.update', 'Configuração da agenda atualizada')
  writeStore(store)
  return res.json(row)
})

router.get('/agenda/orders', (req, res) => {
  const store = ensureCollections(readStore())
  const company = getCompanyContext(req, store)
  if(!company) return res.status(404).json({ error:'company_not_found', message:'Empresa não encontrada.' })
  seedCompanyData(store, company.id)
  writeStore(store)
  const rows = store.agendaOrders
    .filter(item => String(item.company_id) === String(company.id))
    .sort((a, b) => String(a.prod_date || '').localeCompare(String(b.prod_date || '')) || Number(a.id) - Number(b.id))
  return res.json(rows)
})

router.post('/agenda/orders', (req, res) => {
  const store = ensureCollections(readStore())
  const company = getCompanyContext(req, store)
  if(!company) return res.status(404).json({ error:'company_not_found', message:'Empresa não encontrada.' })
  const cliente = text(req.body?.cliente, 'Cliente')
  const descricao = text(req.body?.descricao, 'Pedido')
  const row = {
    id: nextId(store, 'agendaOrders'),
    company_id: company.id,
    cliente,
    descricao,
    prod_date: toDateOnly(req.body?.prod_date),
    ent_date: toDateOnly(req.body?.ent_date),
    tecido: text(req.body?.tecido),
    qtd: Math.max(1, Math.round(num(req.body?.qtd, 1))),
    tecido_comprado: Boolean(req.body?.tecido_comprado),
    status: text(req.body?.status, 'pendente').toLowerCase(),
    source_quote_id: req.body?.source_quote_id || null,
    created_at: nowIso(),
    updated_at: nowIso()
  }
  store.agendaOrders.push(row)
  audit(store, req, company.id, 'agenda.order.create', `Pedido na agenda criado para ${cliente}`)
  writeStore(store)
  return res.status(201).json(row)
})

router.patch('/agenda/orders/:id', (req, res) => {
  const store = ensureCollections(readStore())
  const company = getCompanyContext(req, store)
  const row = store.agendaOrders.find(item => String(item.company_id) === String(company?.id) && String(item.id) === String(req.params.id))
  if(!row) return res.status(404).json({ error:'not_found', message:'Pedido não encontrado.' })
  if(req.body?.cliente !== undefined) row.cliente = text(req.body.cliente, row.cliente)
  if(req.body?.descricao !== undefined) row.descricao = text(req.body.descricao, row.descricao)
  if(req.body?.prod_date !== undefined) row.prod_date = toDateOnly(req.body.prod_date) || row.prod_date
  if(req.body?.ent_date !== undefined) row.ent_date = toDateOnly(req.body.ent_date) || row.ent_date
  if(req.body?.tecido !== undefined) row.tecido = text(req.body.tecido, row.tecido)
  if(req.body?.qtd !== undefined) row.qtd = Math.max(1, Math.round(num(req.body.qtd, row.qtd)))
  if(req.body?.tecido_comprado !== undefined) row.tecido_comprado = Boolean(req.body.tecido_comprado)
  if(req.body?.status !== undefined) row.status = text(req.body.status, row.status).toLowerCase()
  const today = new Date().toISOString().slice(0, 10)
  const refDate = row.ent_date || row.prod_date
  if(row.status === 'atrasado' && refDate && refDate >= today) row.status = 'pendente'
  row.updated_at = nowIso()
  audit(store, req, company.id, 'agenda.order.update', `Pedido da agenda atualizado: ${row.id}`)
  writeStore(store)
  return res.json(row)
})

router.delete('/agenda/orders/:id', (req, res) => {
  const store = ensureCollections(readStore())
  const company = getCompanyContext(req, store)
  const before = store.agendaOrders.length
  store.agendaOrders = store.agendaOrders.filter(item => !(String(item.company_id) === String(company?.id) && String(item.id) === String(req.params.id)))
  if(store.agendaOrders.length === before) return res.status(404).json({ error:'not_found', message:'Pedido não encontrado.' })
  audit(store, req, company.id, 'agenda.order.delete', `Pedido removido da agenda: ${req.params.id}`)
  writeStore(store)
  return res.json({ ok:true })
})

router.get('/quotes', (req, res) => {
  const store = ensureCollections(readStore())
  const company = getCompanyContext(req, store)
  if(!company) return res.status(404).json({ error:'company_not_found', message:'Empresa não encontrada.' })
  seedCompanyData(store, company.id)
  writeStore(store)
  const status = text(req.query.status).toLowerCase()
  const rows = store.quotes
    .filter(item => String(item.company_id) === String(company.id))
    .filter(item => !status || String(item.status || '').toLowerCase() === status)
    .sort((a, b) => String(b.updated_at || b.created_at || '').localeCompare(String(a.updated_at || a.created_at || '')))
  return res.json(rows)
})

router.post('/quotes', (req, res) => {
  const store = ensureCollections(readStore())
  const company = getCompanyContext(req, store)
  if(!company) return res.status(404).json({ error:'company_not_found', message:'Empresa não encontrada.' })
  const cliente = text(req.body?.cliente, 'Cliente')
  const row = {
    id: nextId(store, 'quotes'),
    company_id: company.id,
    cliente,
    status: text(req.body?.status, 'orcamento').toLowerCase(),
    total_cents: Math.max(0, Math.round(num(req.body?.total_cents, 0))),
    payload: req.body?.payload && typeof req.body.payload === 'object' ? req.body.payload : {},
    created_at: nowIso(),
    updated_at: nowIso()
  }
  store.quotes.unshift(row)
  audit(store, req, company.id, 'quote.create', `Orçamento salvo para ${cliente}`)
  writeStore(store)
  return res.status(201).json(row)
})

router.get('/quotes/:id', (req, res) => {
  const store = ensureCollections(readStore())
  const company = getCompanyContext(req, store)
  const row = store.quotes.find(item => String(item.company_id) === String(company?.id) && String(item.id) === String(req.params.id))
  if(!row) return res.status(404).json({ error:'not_found', message:'Orçamento não encontrado.' })
  return res.json(row)
})

router.patch('/quotes/:id', (req, res) => {
  const store = ensureCollections(readStore())
  const company = getCompanyContext(req, store)
  const row = store.quotes.find(item => String(item.company_id) === String(company?.id) && String(item.id) === String(req.params.id))
  if(!row) return res.status(404).json({ error:'not_found', message:'Orçamento não encontrado.' })
  if(req.body?.cliente !== undefined) row.cliente = text(req.body.cliente, row.cliente)
  if(req.body?.status !== undefined) row.status = text(req.body.status, row.status).toLowerCase()
  if(req.body?.total_cents !== undefined) row.total_cents = Math.max(0, Math.round(num(req.body.total_cents, row.total_cents)))
  if(req.body?.payload !== undefined && typeof req.body.payload === 'object') row.payload = req.body.payload
  row.updated_at = nowIso()
  audit(store, req, company.id, 'quote.update', `Orçamento atualizado: ${row.id}`)
  writeStore(store)
  return res.json(row)
})

router.delete('/quotes/:id', (req, res) => {
  const store = ensureCollections(readStore())
  const company = getCompanyContext(req, store)
  const before = store.quotes.length
  store.quotes = store.quotes.filter(item => !(String(item.company_id) === String(company?.id) && String(item.id) === String(req.params.id)))
  if(store.quotes.length === before) return res.status(404).json({ error:'not_found', message:'Orçamento não encontrado.' })
  audit(store, req, company.id, 'quote.delete', `Orçamento removido: ${req.params.id}`)
  writeStore(store)
  return res.json({ ok:true })
})

router.post('/quotes/:id/convert-to-order', (req, res) => {
  const store = ensureCollections(readStore())
  const company = getCompanyContext(req, store)
  const quote = store.quotes.find(item => String(item.company_id) === String(company?.id) && String(item.id) === String(req.params.id))
  if(!quote) return res.status(404).json({ error:'not_found', message:'Orçamento não encontrado.' })
  quote.status = 'pedido'
  quote.updated_at = nowIso()
  const existingOrder = store.agendaOrders.find(item => String(item.source_quote_id) === String(quote.id) && String(item.company_id) === String(company.id))
  if(!existingOrder){
    store.agendaOrders.push({
      id: nextId(store, 'agendaOrders'),
      company_id: company.id,
      cliente: quote.cliente || 'Cliente',
      descricao: 'Pedido vindo do vendedor',
      prod_date: toDateOnly(req.body?.prod_date) || new Date().toISOString().slice(0, 10),
      ent_date: toDateOnly(req.body?.ent_date) || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      tecido: text(req.body?.tecido),
      qtd: 1,
      tecido_comprado: false,
      status: 'pendente',
      source_quote_id: quote.id,
      created_at: nowIso(),
      updated_at: nowIso()
    })
  }
  audit(store, req, company.id, 'quote.convert_to_order', `Orçamento convertido em pedido: ${quote.id}`)
  writeStore(store)
  return res.json({ ok:true, quote })
})

router.get('/dashboard/summary', (req, res) => {
  const store = ensureCollections(readStore())
  const company = getCompanyContext(req, store)
  if(!company) return res.json({ pedidos: 0, faturamento_cents: 0, ticket_medio_cents: 0 })
  seedCompanyData(store, company.id)
  writeStore(store)
  const quotes = store.quotes.filter(item => String(item.company_id) === String(company.id) && String(item.status || '').toLowerCase() === 'pedido')
  const pedidos = quotes.length
  const faturamento_cents = quotes.reduce((sum, item) => sum + Math.max(0, Math.round(num(item.total_cents, 0))), 0)
  const ticket_medio_cents = pedidos ? Math.round(faturamento_cents / pedidos) : 0
  return res.json({ pedidos, faturamento_cents, ticket_medio_cents })
})

router.get('/calendar/holidays', (req, res) => {
  const requested = String(req.query.years || req.query.year || '').trim()
  const currentYear = new Date().getFullYear()
  const years = (requested ? requested.split(',') : [String(currentYear), String(currentYear + 1)])
    .map(item => Number(String(item || '').trim()))
    .filter(year => Number.isInteger(year) && year >= 2000 && year <= 2100)
  const uniqueYears = Array.from(new Set(years.length ? years : [currentYear, currentYear + 1]))
  const holidays = uniqueYears.flatMap(getBrazilNationalHolidays)
  return res.json({ years: uniqueYears, holidays })
})

module.exports = router
