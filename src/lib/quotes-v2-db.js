'use strict'

const crypto = require('crypto')
const storeLib = require('./store')

const IMAGE_KEYS = new Set([
  'image_data_url','imageDataUrl','foto_data_url','fotoDataUrl',
  'photo_data_url','photoDataUrl','image','foto','photo'
])

function getPool(){
  const pool = storeLib && storeLib._pg && storeLib._pg.pool
  if(!pool){
    const err = new Error('PostgreSQL não disponível para Quotes V2.')
    err.code = 'postgres_required'
    throw err
  }
  return pool
}

function text(value, fallback=''){
  if(value === undefined || value === null) return fallback
  return String(value)
}

function number(value, fallback=0){
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function sanitize(value){
  if(value === null || value === undefined) return value
  if(typeof value === 'string') return value.startsWith('data:image/') ? null : value
  if(Array.isArray(value)) return value.map(sanitize).filter(v => v !== undefined)
  if(typeof value !== 'object') return value
  const out = {}
  for(const [key, raw] of Object.entries(value)){
    if(IMAGE_KEYS.has(key)) continue
    const next = sanitize(raw)
    if(next !== undefined) out[key] = next
  }
  return out
}

function cents(centsValue, reaisValue){
  const direct = number(centsValue, NaN)
  if(Number.isFinite(direct)) return Math.max(0, Math.round(direct))
  return Math.max(0, Math.round(number(reaisValue, 0) * 100))
}

async function ensureSchema(){
  const pool = getPool()
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_quotes_v2 (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL,
      legacy_id TEXT,
      cliente TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'orcamento',
      total_cents BIGINT NOT NULL DEFAULT 0,
      payload_meta JSONB NOT NULL DEFAULT '{}'::jsonb,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_app_quotes_v2_company_status
      ON app_quotes_v2 (company_id, status, updated_at DESC);

    CREATE UNIQUE INDEX IF NOT EXISTS ux_app_quotes_v2_company_legacy
      ON app_quotes_v2 (company_id, legacy_id)
      WHERE legacy_id IS NOT NULL;

    CREATE TABLE IF NOT EXISTS app_quote_models_v2 (
      id TEXT PRIMARY KEY,
      quote_id TEXT NOT NULL REFERENCES app_quotes_v2(id) ON DELETE CASCADE,
      company_id TEXT NOT NULL,
      model_id TEXT,
      model_name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      meters NUMERIC(10,2) NOT NULL DEFAULT 0,
      price_cents BIGINT NOT NULL DEFAULT 0,
      subtotal_cents BIGINT NOT NULL DEFAULT 0,
      included_items JSONB NOT NULL DEFAULT '[]'::jsonb,
      observation TEXT NOT NULL DEFAULT '',
      extra JSONB NOT NULL DEFAULT '{}'::jsonb,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_app_quote_models_v2_quote
      ON app_quote_models_v2 (company_id, quote_id, sort_order);

    CREATE TABLE IF NOT EXISTS app_quote_model_items_v2 (
      id BIGSERIAL PRIMARY KEY,
      quote_model_id TEXT NOT NULL REFERENCES app_quote_models_v2(id) ON DELETE CASCADE,
      company_id TEXT NOT NULL,
      name TEXT NOT NULL,
      unit TEXT NOT NULL DEFAULT 'unidade',
      value_cents BIGINT NOT NULL DEFAULT 0,
      included_in_model BOOLEAN NOT NULL DEFAULT FALSE,
      extra JSONB NOT NULL DEFAULT '{}'::jsonb,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_app_quote_model_items_v2_model
      ON app_quote_model_items_v2 (company_id, quote_model_id, sort_order);
  `)
}

function normalizePayload(input={}){
  const payload = sanitize(input.payload && typeof input.payload === 'object' ? input.payload : {}) || {}
  const rawModels = Array.isArray(payload.modelos) ? payload.modelos : []
  const payloadMeta = { ...payload }
  delete payloadMeta.modelos

  const models = rawModels.map((raw, index) => {
    const clean = sanitize(raw) || {}
    const items = Array.isArray(clean.itens) ? clean.itens : []
    const extra = { ...clean }
    ;['model_id','id','modelo','name','nome','descricao','description','itens_incluidos','included_items','preco','preco_cents','metragem','itens','observacao','obs','subtotal','subtotal_cents'].forEach(k => delete extra[k])
    return {
      rawModelId: text(clean.model_id ?? clean.id ?? '').trim() || null,
      modelName: text(clean.modelo ?? clean.name ?? clean.nome ?? `Modelo ${index+1}`).trim(),
      description: text(clean.descricao ?? clean.description ?? '').trim(),
      meters: Math.max(0, number(clean.metragem, 0)),
      priceCents: cents(clean.preco_cents, clean.preco),
      subtotalCents: cents(clean.subtotal_cents, clean.subtotal),
      includedItems: Array.isArray(clean.itens_incluidos) ? clean.itens_incluidos : (Array.isArray(clean.included_items) ? clean.included_items : []),
      observation: text(clean.observacao ?? clean.obs ?? '').trim(),
      extra,
      items: items.map((item, itemIndex) => {
        const safe = sanitize(item) || {}
        const itemExtra = { ...safe }
        ;['nome','name','unit','unidade','valor','valor_cents','incluido_no_modelo'].forEach(k => delete itemExtra[k])
        return {
          name: text(safe.nome ?? safe.name ?? `Item ${itemIndex+1}`).trim(),
          unit: text(safe.unit ?? safe.unidade ?? 'unidade').trim() || 'unidade',
          valueCents: cents(safe.valor_cents, safe.valor),
          includedInModel: Boolean(safe.incluido_no_modelo),
          extra: itemExtra
        }
      })
    }
  })

  return { payloadMeta, models }
}

async function resolveModelId(client, companyId, rawModelId, modelName){
  if(rawModelId){
    const direct = await client.query(`
      SELECT id FROM app_models_v2
      WHERE company_id=$1 AND (id=$2 OR legacy_id=$2)
      ORDER BY CASE WHEN id=$2 THEN 0 ELSE 1 END
      LIMIT 1
    `,[companyId, rawModelId])
    if(direct.rows[0]?.id) return direct.rows[0].id
  }
  if(modelName){
    const byName = await client.query(`
      SELECT id FROM app_models_v2
      WHERE company_id=$1 AND LOWER(name)=LOWER($2)
      ORDER BY active DESC, updated_at DESC
      LIMIT 1
    `,[companyId, modelName])
    if(byName.rows[0]?.id) return byName.rows[0].id
  }
  return rawModelId || null
}

async function replaceModels(client, companyId, quoteId, models){
  await client.query('DELETE FROM app_quote_models_v2 WHERE company_id=$1 AND quote_id=$2',[companyId, quoteId])
  for(let i=0;i<models.length;i++){
    const model = models[i]
    const id = crypto.randomUUID()
    const modelId = await resolveModelId(client, companyId, model.rawModelId, model.modelName)
    await client.query(`
      INSERT INTO app_quote_models_v2 (
        id,quote_id,company_id,model_id,model_name,description,meters,
        price_cents,subtotal_cents,included_items,observation,extra,sort_order
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12::jsonb,$13)
    `,[
      id, quoteId, companyId, modelId, model.modelName, model.description, model.meters,
      model.priceCents, model.subtotalCents, JSON.stringify(model.includedItems || []),
      model.observation, JSON.stringify(model.extra || {}), i
    ])
    for(let j=0;j<model.items.length;j++){
      const item = model.items[j]
      await client.query(`
        INSERT INTO app_quote_model_items_v2 (
          quote_model_id,company_id,name,unit,value_cents,included_in_model,extra,sort_order
        ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)
      `,[id,companyId,item.name,item.unit,item.valueCents,item.includedInModel,JSON.stringify(item.extra || {}),j])
    }
  }
}

async function hydrateRows(rows){
  if(!rows.length) return []
  const pool = getPool()
  const quoteIds = rows.map(r => r.id)
  const modelsRes = await pool.query(`
    SELECT * FROM app_quote_models_v2
    WHERE quote_id = ANY($1::text[])
    ORDER BY quote_id, sort_order
  `,[quoteIds])
  const modelIds = modelsRes.rows.map(r => r.id)
  const itemsRes = modelIds.length ? await pool.query(`
    SELECT * FROM app_quote_model_items_v2
    WHERE quote_model_id = ANY($1::text[])
    ORDER BY quote_model_id, sort_order
  `,[modelIds]) : { rows:[] }

  const itemsByModel = new Map()
  for(const item of itemsRes.rows){
    if(!itemsByModel.has(item.quote_model_id)) itemsByModel.set(item.quote_model_id,[])
    itemsByModel.get(item.quote_model_id).push({
      ...(item.extra || {}),
      nome:item.name,
      unit:item.unit,
      valor:Number(item.value_cents || 0)/100,
      valor_cents:Number(item.value_cents || 0),
      incluido_no_modelo:Boolean(item.included_in_model)
    })
  }

  const modelsByQuote = new Map()
  for(const model of modelsRes.rows){
    if(!modelsByQuote.has(model.quote_id)) modelsByQuote.set(model.quote_id,[])
    modelsByQuote.get(model.quote_id).push({
      ...(model.extra || {}),
      model_id:model.model_id,
      modelo:model.model_name,
      descricao:model.description || '',
      description:model.description || '',
      itens_incluidos:Array.isArray(model.included_items) ? model.included_items : [],
      preco:Number(model.price_cents || 0)/100,
      preco_cents:Number(model.price_cents || 0),
      metragem:Number(model.meters || 0).toFixed(2),
      itens:itemsByModel.get(model.id) || [],
      observacao:model.observation || '',
      obs:model.observation || '',
      subtotal:Number(model.subtotal_cents || 0)/100,
      subtotal_cents:Number(model.subtotal_cents || 0)
    })
  }

  return rows.map(row => {
    const payload = { ...(row.payload_meta || {}), modelos:modelsByQuote.get(row.id) || [] }
    if(payload.cliente === undefined) payload.cliente = row.cliente
    if(payload.total_cents === undefined) payload.total_cents = Number(row.total_cents || 0)
    if(payload.total === undefined) payload.total = Number(row.total_cents || 0)/100
    return {
      id:row.id,
      legacy_id:row.legacy_id,
      cliente:row.cliente,
      status:row.status,
      total_cents:Number(row.total_cents || 0),
      payload,
      created_at:row.created_at,
      updated_at:row.updated_at
    }
  })
}

async function listQuotes(companyId,{status='',limit=200,offset=0}={}){
  const pool = getPool()
  const params=[companyId]
  const filters=['company_id=$1','active=TRUE']
  if(text(status).trim()){
    params.push(text(status).trim().toLowerCase())
    filters.push(`status=$${params.length}`)
  }
  const safeLimit=Math.min(500,Math.max(1,Math.round(number(limit,200))))
  const safeOffset=Math.max(0,Math.round(number(offset,0)))
  params.push(safeLimit,safeOffset)
  const rows=await pool.query(`
    SELECT * FROM app_quotes_v2
    WHERE ${filters.join(' AND ')}
    ORDER BY updated_at DESC, created_at DESC
    LIMIT $${params.length-1} OFFSET $${params.length}
  `,params)
  return hydrateRows(rows.rows)
}

async function getQuote(companyId,id){
  const pool=getPool()
  const res=await pool.query('SELECT * FROM app_quotes_v2 WHERE company_id=$1 AND id=$2 AND active=TRUE LIMIT 1',[companyId,id])
  const rows=await hydrateRows(res.rows)
  return rows[0] || null
}

async function createQuote(companyId,input={},options={}){
  const cliente=text(input.cliente ?? input.payload?.cliente ?? 'Cliente').trim() || 'Cliente'
  const status=text(input.status ?? 'orcamento').trim().toLowerCase() || 'orcamento'
  const totalCents=Math.max(0,Math.round(number(input.total_cents ?? input.payload?.total_cents,0)))
  const {payloadMeta,models}=normalizePayload(input)
  const id=options.id || crypto.randomUUID()
  const legacyId=options.legacyId ? text(options.legacyId) : null
  const createdAt=options.createdAt || input.created_at || new Date().toISOString()
  const updatedAt=options.updatedAt || input.updated_at || createdAt
  const pool=getPool()
  const client=await pool.connect()
  try{
    await client.query('BEGIN')
    await client.query(`
      INSERT INTO app_quotes_v2 (id,company_id,legacy_id,cliente,status,total_cents,payload_meta,active,created_at,updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,TRUE,$8,$9)
    `,[id,companyId,legacyId,cliente,status,totalCents,JSON.stringify(payloadMeta),createdAt,updatedAt])
    await replaceModels(client,companyId,id,models)
    await client.query('COMMIT')
  }catch(err){
    await client.query('ROLLBACK').catch(()=>{})
    throw err
  }finally{ client.release() }
  return getQuote(companyId,id)
}

async function updateQuote(companyId,id,patch={}){
  const existing=await getQuote(companyId,id)
  if(!existing) return null
  const cliente=patch.cliente !== undefined ? (text(patch.cliente).trim() || existing.cliente) : existing.cliente
  const status=patch.status !== undefined ? (text(patch.status).trim().toLowerCase() || existing.status) : existing.status
  const totalCents=patch.total_cents !== undefined ? Math.max(0,Math.round(number(patch.total_cents,existing.total_cents))) : existing.total_cents
  const payload = patch.payload !== undefined ? patch.payload : existing.payload
  const normalized=normalizePayload({payload})
  const pool=getPool()
  const client=await pool.connect()
  try{
    await client.query('BEGIN')
    await client.query(`
      UPDATE app_quotes_v2 SET cliente=$3,status=$4,total_cents=$5,payload_meta=$6::jsonb,updated_at=NOW()
      WHERE company_id=$1 AND id=$2 AND active=TRUE
    `,[companyId,id,cliente,status,totalCents,JSON.stringify(normalized.payloadMeta)])
    if(patch.payload !== undefined) await replaceModels(client,companyId,id,normalized.models)
    await client.query('COMMIT')
  }catch(err){
    await client.query('ROLLBACK').catch(()=>{})
    throw err
  }finally{ client.release() }
  return getQuote(companyId,id)
}

async function deleteQuote(companyId,id){
  const pool=getPool()
  const res=await pool.query('DELETE FROM app_quotes_v2 WHERE company_id=$1 AND id=$2 RETURNING id',[companyId,id])
  return res.rows.length>0
}

async function migrateLegacyQuotes(store){
  const quotes=Array.isArray(store?.quotes) ? store.quotes : []
  const pool=getPool()
  let migrated=0
  let skipped=0
  for(const legacy of quotes){
    const companyId=text(legacy?.company_id).trim()
    const legacyId=text(legacy?.id).trim()
    if(!companyId || !legacyId){ skipped++; continue }
    const exists=await pool.query('SELECT id FROM app_quotes_v2 WHERE company_id=$1 AND legacy_id=$2 LIMIT 1',[companyId,legacyId])
    if(exists.rows.length){ skipped++; continue }
    await createQuote(companyId,legacy,{
      legacyId,
      createdAt:legacy.created_at || new Date().toISOString(),
      updatedAt:legacy.updated_at || legacy.created_at || new Date().toISOString()
    })
    migrated++
  }
  if(migrated) console.log(`[quotes-v2] ${migrated} orçamento(s) legado(s) migrado(s) sem imagens inline.`)
  return {migrated,skipped}
}

module.exports={
  ensureSchema,
  listQuotes,
  getQuote,
  createQuote,
  updateQuote,
  deleteQuote,
  migrateLegacyQuotes,
  sanitize
}
