'use strict'

const crypto = require('crypto')
const storeLib = require('./store')

function getPool(){
  const pool = storeLib && storeLib._pg && storeLib._pg.pool
  if(!pool){
    const err = new Error('PostgreSQL não disponível para Agenda V2.')
    err.code = 'postgres_required'
    throw err
  }
  return pool
}

function text(value, fallback=''){
  if(value === undefined || value === null) return fallback
  return String(value).trim()
}

function num(value, fallback=0){
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function isoDate(value){
  const raw = text(value)
  if(!raw) return ''
  if(/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw
  const d = new Date(raw)
  if(Number.isNaN(d.getTime())) return ''
  return d.toISOString().slice(0,10)
}

function timestamp(value){
  const d = value ? new Date(value) : new Date()
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString()
}

function cleanJson(value){
  if(!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return JSON.parse(JSON.stringify(value))
}

function publicId(value){
  const raw = text(value)
  return raw || crypto.randomUUID()
}

async function ensureSchema(){
  const pool = getPool()
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_agenda_v2_meta (
      key TEXT PRIMARY KEY,
      value JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS app_agenda_configs_v2 (
      company_id TEXT PRIMARY KEY,
      prazo_dias INTEGER NOT NULL DEFAULT 7,
      vagas_semana INTEGER NOT NULL DEFAULT 5,
      tipo_dias TEXT NOT NULL DEFAULT 'corrido',
      city_code TEXT NOT NULL DEFAULT '',
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS app_agenda_blocos_v2 (
      company_id TEXT NOT NULL,
      id TEXT NOT NULL,
      data_producao TEXT NOT NULL DEFAULT '',
      data_entrega TEXT NOT NULL DEFAULT '',
      qtd_vagas INTEGER NOT NULL DEFAULT 1,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (company_id, id)
    );

    CREATE INDEX IF NOT EXISTS idx_agenda_blocos_v2_company_data
      ON app_agenda_blocos_v2 (company_id, data_producao, data_entrega);

    CREATE TABLE IF NOT EXISTS app_agenda_orders_v2 (
      company_id TEXT NOT NULL,
      id TEXT NOT NULL,
      bloco_id TEXT,
      cliente TEXT NOT NULL DEFAULT 'Cliente',
      descricao TEXT NOT NULL DEFAULT 'Pedido',
      prod_date TEXT NOT NULL DEFAULT '',
      ent_date TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pendente',
      tecido TEXT NOT NULL DEFAULT '',
      qtd INTEGER NOT NULL DEFAULT 1,
      tecido_comprado BOOLEAN NOT NULL DEFAULT FALSE,
      source_quote_id TEXT,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (company_id, id)
    );

    CREATE INDEX IF NOT EXISTS idx_agenda_orders_v2_company_prod
      ON app_agenda_orders_v2 (company_id, prod_date, id);
    CREATE INDEX IF NOT EXISTS idx_agenda_orders_v2_company_status
      ON app_agenda_orders_v2 (company_id, status, ent_date);
    CREATE INDEX IF NOT EXISTS idx_agenda_orders_v2_company_bloco
      ON app_agenda_orders_v2 (company_id, bloco_id)
      WHERE bloco_id IS NOT NULL;

    CREATE TABLE IF NOT EXISTS app_agenda_audit_v2 (
      id BIGSERIAL PRIMARY KEY,
      company_id TEXT NOT NULL,
      action TEXT NOT NULL,
      detail TEXT NOT NULL DEFAULT '',
      actor_name TEXT NOT NULL DEFAULT '',
      actor_email TEXT NOT NULL DEFAULT '',
      actor_role TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_agenda_audit_v2_company_created
      ON app_agenda_audit_v2 (company_id, created_at DESC);
  `)
}

function configFromRow(row){
  if(!row) return { prazo_dias:7, vagas_semana:5, tipo_dias:'corrido', city_code:'' }
  return {
    ...(row.payload || {}),
    company_id: row.company_id,
    prazo_dias: Number(row.prazo_dias || 0),
    vagas_semana: Number(row.vagas_semana || 0),
    tipo_dias: row.tipo_dias || 'corrido',
    city_code: row.city_code || '',
    created_at: row.created_at,
    updated_at: row.updated_at
  }
}

function blockFromRow(row){
  if(!row) return null
  return {
    ...(row.payload || {}),
    id: row.id,
    company_id: row.company_id,
    data_producao: row.data_producao || '',
    data_entrega: row.data_entrega || '',
    qtd_vagas: Number(row.qtd_vagas || 0),
    created_at: row.created_at,
    updated_at: row.updated_at
  }
}

function orderFromRow(row){
  if(!row) return null
  return {
    ...(row.payload || {}),
    id: row.id,
    company_id: row.company_id,
    bloco_id: row.bloco_id || undefined,
    cliente: row.cliente || 'Cliente',
    descricao: row.descricao || 'Pedido',
    prod_date: row.prod_date || '',
    ent_date: row.ent_date || '',
    status: row.status || 'pendente',
    tecido: row.tecido || '',
    qtd: Number(row.qtd || 1),
    tecido_comprado: Boolean(row.tecido_comprado),
    source_quote_id: row.source_quote_id || null,
    created_at: row.created_at,
    updated_at: row.updated_at
  }
}

async function migrationAlreadyDone(client){
  const result = await client.query(
    "SELECT value FROM app_agenda_v2_meta WHERE key='legacy_import_v1' LIMIT 1"
  )
  return result.rows[0]?.value || null
}

async function migrateLegacyAgenda(store){
  const pool = getPool()
  const client = await pool.connect()
  try{
    await client.query('BEGIN')
    const existingMarker = await migrationAlreadyDone(client)
    if(existingMarker){
      await client.query('ROLLBACK')
      return { skipped:true, ...(existingMarker || {}) }
    }

    const configs = Array.isArray(store?.agendaConfigs) ? store.agendaConfigs : []
    const blocos = Array.isArray(store?.agendaBlocos) ? store.agendaBlocos : []
    const orders = Array.isArray(store?.agendaOrders) ? store.agendaOrders : []
    let migratedConfigs = 0
    let migratedBlocks = 0
    let migratedOrders = 0

    for(const raw of configs){
      const companyId = text(raw?.company_id)
      if(!companyId) continue
      const payload = cleanJson(raw)
      const createdAt = timestamp(raw?.created_at)
      const updatedAt = timestamp(raw?.updated_at || raw?.created_at)
      await client.query(`
        INSERT INTO app_agenda_configs_v2 (
          company_id,prazo_dias,vagas_semana,tipo_dias,city_code,payload,created_at,updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8)
        ON CONFLICT (company_id) DO NOTHING
      `,[
        companyId,
        Math.max(0,Math.round(num(raw?.prazo_dias,7))),
        Math.max(1,Math.round(num(raw?.vagas_semana,5))),
        ['uteis','corrido'].includes(text(raw?.tipo_dias).toLowerCase()) ? text(raw.tipo_dias).toLowerCase() : 'corrido',
        text(raw?.city_code).toUpperCase(),
        JSON.stringify(payload),createdAt,updatedAt
      ])
      migratedConfigs += 1
    }

    for(const raw of blocos){
      const companyId = text(raw?.company_id)
      const id = text(raw?.id)
      if(!companyId || !id) continue
      const payload = cleanJson(raw)
      await client.query(`
        INSERT INTO app_agenda_blocos_v2 (
          company_id,id,data_producao,data_entrega,qtd_vagas,payload,created_at,updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8)
        ON CONFLICT (company_id,id) DO NOTHING
      `,[
        companyId,id,isoDate(raw?.data_producao),isoDate(raw?.data_entrega),
        Math.max(1,Math.round(num(raw?.qtd_vagas,1))),JSON.stringify(payload),
        timestamp(raw?.created_at),timestamp(raw?.updated_at || raw?.created_at)
      ])
      migratedBlocks += 1
    }

    for(const raw of orders){
      const companyId = text(raw?.company_id)
      const id = text(raw?.id)
      if(!companyId || !id) continue
      const payload = cleanJson(raw)
      await client.query(`
        INSERT INTO app_agenda_orders_v2 (
          company_id,id,bloco_id,cliente,descricao,prod_date,ent_date,status,tecido,qtd,
          tecido_comprado,source_quote_id,payload,created_at,updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,$15)
        ON CONFLICT (company_id,id) DO NOTHING
      `,[
        companyId,id,text(raw?.bloco_id) || null,text(raw?.cliente,'Cliente') || 'Cliente',
        text(raw?.descricao,'Pedido') || 'Pedido',isoDate(raw?.prod_date),isoDate(raw?.ent_date),
        text(raw?.status,'pendente').toLowerCase() || 'pendente',text(raw?.tecido),
        Math.max(1,Math.round(num(raw?.qtd,1))),Boolean(raw?.tecido_comprado),
        text(raw?.source_quote_id) || null,JSON.stringify(payload),
        timestamp(raw?.created_at),timestamp(raw?.updated_at || raw?.created_at)
      ])
      migratedOrders += 1
    }

    const marker = {
      configs:migratedConfigs,
      blocos:migratedBlocks,
      orders:migratedOrders,
      migrated_at:new Date().toISOString()
    }
    await client.query(`
      INSERT INTO app_agenda_v2_meta (key,value,updated_at)
      VALUES ('legacy_import_v1',$1::jsonb,NOW())
      ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value,updated_at=NOW()
    `,[JSON.stringify(marker)])
    await client.query('COMMIT')
    return marker
  }catch(err){
    await client.query('ROLLBACK').catch(()=>{})
    throw err
  }finally{
    client.release()
  }
}

async function getConfig(companyId){
  const pool = getPool()
  const result = await pool.query(
    'SELECT * FROM app_agenda_configs_v2 WHERE company_id=$1 LIMIT 1',
    [text(companyId)]
  )
  return configFromRow(result.rows[0])
}

async function updateConfig(companyId, patch={}){
  const current = await getConfig(companyId)
  const next = {
    ...current,
    ...cleanJson(patch),
    prazo_dias: Math.max(0,Math.round(num(patch.prazo_dias,current.prazo_dias ?? 7))),
    vagas_semana: Math.max(1,Math.round(num(patch.vagas_semana,current.vagas_semana ?? 5))),
    tipo_dias: ['uteis','corrido'].includes(text(patch.tipo_dias,current.tipo_dias).toLowerCase())
      ? text(patch.tipo_dias,current.tipo_dias).toLowerCase() : 'corrido',
    city_code: patch.city_code !== undefined ? text(patch.city_code).toUpperCase() : text(current.city_code).toUpperCase()
  }
  const pool = getPool()
  const result = await pool.query(`
    INSERT INTO app_agenda_configs_v2 (
      company_id,prazo_dias,vagas_semana,tipo_dias,city_code,payload,created_at,updated_at
    ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,NOW(),NOW())
    ON CONFLICT (company_id) DO UPDATE SET
      prazo_dias=EXCLUDED.prazo_dias,
      vagas_semana=EXCLUDED.vagas_semana,
      tipo_dias=EXCLUDED.tipo_dias,
      city_code=EXCLUDED.city_code,
      payload=EXCLUDED.payload,
      updated_at=NOW()
    RETURNING *
  `,[text(companyId),next.prazo_dias,next.vagas_semana,next.tipo_dias,next.city_code,JSON.stringify(next)])
  return configFromRow(result.rows[0])
}

async function listOrders(companyId){
  const pool = getPool()
  const result = await pool.query(`
    SELECT * FROM app_agenda_orders_v2
    WHERE company_id=$1
    ORDER BY prod_date ASC, id ASC
  `,[text(companyId)])
  return result.rows.map(orderFromRow)
}

async function getOrder(companyId,id,client=null){
  const db = client || getPool()
  const result = await db.query(
    'SELECT * FROM app_agenda_orders_v2 WHERE company_id=$1 AND id=$2 LIMIT 1',
    [text(companyId),text(id)]
  )
  return orderFromRow(result.rows[0])
}

async function insertOrder(client,companyId,input={},options={}){
  const id = publicId(options.id || input.id)
  const createdAt = timestamp(options.createdAt || input.created_at)
  const updatedAt = timestamp(options.updatedAt || input.updated_at || createdAt)
  const row = {
    ...cleanJson(input),
    id,
    company_id:text(companyId),
    bloco_id:text(input.bloco_id) || undefined,
    cliente:text(input.cliente,'Cliente') || 'Cliente',
    descricao:text(input.descricao,'Pedido') || 'Pedido',
    prod_date:isoDate(input.prod_date),
    ent_date:isoDate(input.ent_date),
    tecido:text(input.tecido),
    qtd:Math.max(1,Math.round(num(input.qtd,1))),
    tecido_comprado:Boolean(input.tecido_comprado),
    status:text(input.status,'pendente').toLowerCase() || 'pendente',
    source_quote_id:text(input.source_quote_id) || null,
    created_at:createdAt,
    updated_at:updatedAt
  }
  const result = await client.query(`
    INSERT INTO app_agenda_orders_v2 (
      company_id,id,bloco_id,cliente,descricao,prod_date,ent_date,status,tecido,qtd,
      tecido_comprado,source_quote_id,payload,created_at,updated_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,$15)
    RETURNING *
  `,[
    row.company_id,row.id,row.bloco_id || null,row.cliente,row.descricao,row.prod_date,row.ent_date,
    row.status,row.tecido,row.qtd,row.tecido_comprado,row.source_quote_id,
    JSON.stringify(row),createdAt,updatedAt
  ])
  return orderFromRow(result.rows[0])
}

async function createOrder(companyId,input={}){
  const pool = getPool()
  const client = await pool.connect()
  try{
    await client.query('BEGIN')
    const row = await insertOrder(client,companyId,input)
    await client.query('COMMIT')
    return row
  }catch(err){
    await client.query('ROLLBACK').catch(()=>{})
    throw err
  }finally{ client.release() }
}

async function updateOrder(companyId,id,patch={}){
  const pool = getPool()
  const client = await pool.connect()
  try{
    await client.query('BEGIN')
    const existing = await getOrder(companyId,id,client)
    if(!existing){
      await client.query('ROLLBACK')
      return null
    }
    const next = { ...existing }
    if(patch.cliente !== undefined) next.cliente = text(patch.cliente,existing.cliente)
    if(patch.descricao !== undefined) next.descricao = text(patch.descricao,existing.descricao)
    if(patch.prod_date !== undefined) next.prod_date = isoDate(patch.prod_date) || existing.prod_date
    if(patch.ent_date !== undefined) next.ent_date = isoDate(patch.ent_date) || existing.ent_date
    if(patch.tecido !== undefined) next.tecido = text(patch.tecido,existing.tecido)
    if(patch.qtd !== undefined) next.qtd = Math.max(1,Math.round(num(patch.qtd,existing.qtd)))
    if(patch.tecido_comprado !== undefined) next.tecido_comprado = Boolean(patch.tecido_comprado)
    if(patch.status !== undefined) next.status = text(patch.status,existing.status).toLowerCase()
    if(patch.valor !== undefined) next.valor = num(patch.valor,num(existing.valor,0))
    if(patch.valor_total !== undefined) next.valor_total = num(patch.valor_total,num(existing.valor_total,0))
    if(patch.modelos !== undefined){
      next.modelos = Array.isArray(patch.modelos)
        ? patch.modelos.map(m=>({id:String(m?.id || ''),name:String(m?.name || '')})) : []
    }
    if(patch.bloco_id !== undefined) next.bloco_id = text(patch.bloco_id) || undefined
    if(patch.source_quote_id !== undefined) next.source_quote_id = text(patch.source_quote_id) || null

    const today = new Date().toISOString().slice(0,10)
    const refDate = next.ent_date || next.prod_date
    if(next.status === 'atrasado' && refDate && refDate >= today) next.status = 'pendente'
    next.updated_at = new Date().toISOString()

    const result = await client.query(`
      UPDATE app_agenda_orders_v2 SET
        bloco_id=$3,cliente=$4,descricao=$5,prod_date=$6,ent_date=$7,status=$8,tecido=$9,qtd=$10,
        tecido_comprado=$11,source_quote_id=$12,payload=$13::jsonb,updated_at=NOW()
      WHERE company_id=$1 AND id=$2
      RETURNING *
    `,[
      text(companyId),text(id),next.bloco_id || null,next.cliente,next.descricao,next.prod_date,next.ent_date,
      next.status,next.tecido,next.qtd,next.tecido_comprado,next.source_quote_id,JSON.stringify(next)
    ])
    await client.query('COMMIT')
    return orderFromRow(result.rows[0])
  }catch(err){
    await client.query('ROLLBACK').catch(()=>{})
    throw err
  }finally{ client.release() }
}

async function deleteOrder(companyId,id){
  const pool = getPool()
  const result = await pool.query(
    'DELETE FROM app_agenda_orders_v2 WHERE company_id=$1 AND id=$2 RETURNING id',
    [text(companyId),text(id)]
  )
  return result.rows.length > 0
}

async function listBlocks(companyId){
  const pool = getPool()
  const result = await pool.query(`
    SELECT * FROM app_agenda_blocos_v2
    WHERE company_id=$1
    ORDER BY data_producao ASC, id ASC
  `,[text(companyId)])
  return result.rows.map(blockFromRow)
}

async function getBlock(companyId,id,client=null){
  const db = client || getPool()
  const result = await db.query(
    'SELECT * FROM app_agenda_blocos_v2 WHERE company_id=$1 AND id=$2 LIMIT 1',
    [text(companyId),text(id)]
  )
  return blockFromRow(result.rows[0])
}

async function insertBlock(client,companyId,input={},options={}){
  const id = publicId(options.id || input.id)
  const createdAt = timestamp(options.createdAt || input.created_at)
  const updatedAt = timestamp(options.updatedAt || input.updated_at || createdAt)
  const row = {
    ...cleanJson(input),
    id,
    company_id:text(companyId),
    data_producao:isoDate(input.data_producao),
    data_entrega:isoDate(input.data_entrega),
    qtd_vagas:Math.max(1,Math.round(num(input.qtd_vagas,1))),
    created_at:createdAt,
    updated_at:updatedAt
  }
  const result = await client.query(`
    INSERT INTO app_agenda_blocos_v2 (
      company_id,id,data_producao,data_entrega,qtd_vagas,payload,created_at,updated_at
    ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8)
    RETURNING *
  `,[row.company_id,row.id,row.data_producao,row.data_entrega,row.qtd_vagas,JSON.stringify(row),createdAt,updatedAt])
  return blockFromRow(result.rows[0])
}

async function createBlock(companyId,input={}){
  const pool = getPool()
  const client = await pool.connect()
  try{
    await client.query('BEGIN')
    const row = await insertBlock(client,companyId,input)
    await client.query('COMMIT')
    return row
  }catch(err){
    await client.query('ROLLBACK').catch(()=>{})
    throw err
  }finally{ client.release() }
}

async function updateBlock(companyId,id,patch={}){
  const pool = getPool()
  const client = await pool.connect()
  try{
    await client.query('BEGIN')
    const existing = await getBlock(companyId,id,client)
    if(!existing){
      await client.query('ROLLBACK')
      return null
    }
    const newProd = patch.data_producao !== undefined ? (isoDate(patch.data_producao) || existing.data_producao) : existing.data_producao
    const newEnt = patch.data_entrega !== undefined ? (isoDate(patch.data_entrega) || existing.data_entrega) : existing.data_entrega
    const next = { ...existing, data_producao:newProd, data_entrega:newEnt, updated_at:new Date().toISOString() }
    if(patch.qtd_vagas !== undefined) next.qtd_vagas = Math.max(1,Math.round(num(patch.qtd_vagas,existing.qtd_vagas)))

    const blockResult = await client.query(`
      UPDATE app_agenda_blocos_v2 SET
        data_producao=$3,data_entrega=$4,qtd_vagas=$5,payload=$6::jsonb,updated_at=NOW()
      WHERE company_id=$1 AND id=$2
      RETURNING *
    `,[text(companyId),text(id),newProd,newEnt,next.qtd_vagas,JSON.stringify(next)])

    const orders = await client.query(
      'SELECT * FROM app_agenda_orders_v2 WHERE company_id=$1 AND bloco_id=$2',
      [text(companyId),text(id)]
    )
    for(const raw of orders.rows){
      const order = orderFromRow(raw)
      order.prod_date = newProd
      order.ent_date = newEnt
      order.updated_at = new Date().toISOString()
      await client.query(`
        UPDATE app_agenda_orders_v2 SET prod_date=$3,ent_date=$4,payload=$5::jsonb,updated_at=NOW()
        WHERE company_id=$1 AND id=$2
      `,[text(companyId),order.id,newProd,newEnt,JSON.stringify(order)])
    }

    await client.query('COMMIT')
    return blockFromRow(blockResult.rows[0])
  }catch(err){
    await client.query('ROLLBACK').catch(()=>{})
    throw err
  }finally{ client.release() }
}

async function deleteBlock(companyId,id){
  const pool = getPool()
  const client = await pool.connect()
  try{
    await client.query('BEGIN')
    const existing = await getBlock(companyId,id,client)
    if(!existing){
      await client.query('ROLLBACK')
      return false
    }
    await client.query('DELETE FROM app_agenda_orders_v2 WHERE company_id=$1 AND bloco_id=$2',[text(companyId),text(id)])
    await client.query('DELETE FROM app_agenda_blocos_v2 WHERE company_id=$1 AND id=$2',[text(companyId),text(id)])
    await client.query('COMMIT')
    return true
  }catch(err){
    await client.query('ROLLBACK').catch(()=>{})
    throw err
  }finally{ client.release() }
}

async function changeSlots(companyId,id,delta){
  const pool = getPool()
  const client = await pool.connect()
  try{
    await client.query('BEGIN')
    const bloco = await getBlock(companyId,id,client)
    if(!bloco){
      await client.query('ROLLBACK')
      return { notFound:true }
    }
    const occupiedRes = await client.query(`
      SELECT COUNT(*)::int AS count
      FROM app_agenda_orders_v2
      WHERE company_id=$1 AND bloco_id=$2
        AND COALESCE(status,'') NOT IN ('entregue','cancelado','indisponivel')
    `,[text(companyId),text(id)])
    const occupied = Number(occupiedRes.rows[0]?.count || 0)
    if(delta < 0 && bloco.qtd_vagas <= occupied){
      await client.query('ROLLBACK')
      return { noEmptySlots:true, bloco, occupied }
    }
    bloco.qtd_vagas = delta > 0
      ? bloco.qtd_vagas + 1
      : Math.max(occupied,bloco.qtd_vagas - 1)
    bloco.updated_at = new Date().toISOString()
    const result = await client.query(`
      UPDATE app_agenda_blocos_v2 SET qtd_vagas=$3,payload=$4::jsonb,updated_at=NOW()
      WHERE company_id=$1 AND id=$2
      RETURNING *
    `,[text(companyId),text(id),bloco.qtd_vagas,JSON.stringify(bloco)])
    await client.query('COMMIT')
    return { bloco:blockFromRow(result.rows[0]), occupied }
  }catch(err){
    await client.query('ROLLBACK').catch(()=>{})
    throw err
  }finally{ client.release() }
}

async function createBlockOrder(companyId,blockId,input={}){
  const pool = getPool()
  const client = await pool.connect()
  try{
    await client.query('BEGIN')
    const bloco = await getBlock(companyId,blockId,client)
    if(!bloco){
      await client.query('ROLLBACK')
      return { notFound:true }
    }
    const occupiedRes = await client.query(`
      SELECT COUNT(*)::int AS count
      FROM app_agenda_orders_v2
      WHERE company_id=$1 AND bloco_id=$2
        AND COALESCE(status,'') NOT IN ('entregue','cancelado','indisponivel')
    `,[text(companyId),text(blockId)])
    const occupied = Number(occupiedRes.rows[0]?.count || 0)
    if(occupied >= bloco.qtd_vagas){
      await client.query('ROLLBACK')
      return { full:true, bloco, occupied }
    }
    const orderInput = {
      ...cleanJson(input),
      bloco_id:bloco.id,
      cliente:text(input.cliente,'Cliente') || 'Cliente',
      descricao:text(input.descricao,'Pedido') || 'Pedido',
      prod_date:bloco.data_producao,
      ent_date:bloco.data_entrega,
      tecido:text(input.tecido),
      qtd:1,
      tecido_comprado:false,
      valor:num(input.valor,0),
      modelos:Array.isArray(input.modelos)
        ? input.modelos.map(m=>({id:String(m?.id || ''),name:String(m?.name || '')})) : [],
      status:'pendente'
    }
    const row = await insertOrder(client,companyId,orderInput)
    await client.query('COMMIT')
    return { row, occupied:occupied+1 }
  }catch(err){
    await client.query('ROLLBACK').catch(()=>{})
    throw err
  }finally{ client.release() }
}

async function auditEvent(companyId,action,detail,user={}){
  const pool = getPool()
  await pool.query(`
    INSERT INTO app_agenda_audit_v2 (
      company_id,action,detail,actor_name,actor_email,actor_role
    ) VALUES ($1,$2,$3,$4,$5,$6)
  `,[
    text(companyId),text(action),text(detail),
    text(user?.name || user?.email),text(user?.email),text(user?.role)
  ])
}

module.exports = {
  ensureSchema,
  migrateLegacyAgenda,
  getConfig,
  updateConfig,
  listOrders,
  getOrder,
  createOrder,
  updateOrder,
  deleteOrder,
  listBlocks,
  getBlock,
  createBlock,
  updateBlock,
  deleteBlock,
  changeSlots,
  createBlockOrder,
  auditEvent
}
