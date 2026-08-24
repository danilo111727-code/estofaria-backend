'use strict'

const crypto = require('crypto')
const storeLib = require('./store')

function getPool(){
  const pool = storeLib && storeLib._pg && storeLib._pg.pool
  if(!pool){
    const err = new Error('PostgreSQL não disponível para Financeiro V2.')
    err.code = 'postgres_required'
    throw err
  }
  return pool
}

function text(value,fallback=''){
  if(value === undefined || value === null) return fallback
  return String(value).trim()
}

function num(value,fallback=0){
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

function normalizeTipo(value){
  const tipo = text(value).toLowerCase()
  return ['pagar','receber'].includes(tipo) ? tipo : ''
}

function normalizeStatus(value,fallback='pendente'){
  const status = text(value,fallback).toLowerCase()
  return ['pendente','pago','recebido'].includes(status) ? status : fallback
}

async function ensureSchema(){
  const pool = getPool()
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_financial_v2_meta (
      key TEXT PRIMARY KEY,
      value JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS app_financial_entries_v2 (
      company_id TEXT NOT NULL,
      id TEXT NOT NULL,
      tipo TEXT NOT NULL,
      descricao TEXT NOT NULL DEFAULT '',
      cliente TEXT NOT NULL DEFAULT '',
      fornecedor TEXT NOT NULL DEFAULT '',
      valor NUMERIC(14,2) NOT NULL DEFAULT 0,
      data_vencimento TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pendente',
      forma_pagamento TEXT NOT NULL DEFAULT '',
      categoria TEXT NOT NULL DEFAULT '',
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (company_id,id),
      CONSTRAINT chk_financial_v2_tipo CHECK (tipo IN ('pagar','receber')),
      CONSTRAINT chk_financial_v2_status CHECK (status IN ('pendente','pago','recebido'))
    );

    CREATE INDEX IF NOT EXISTS idx_financial_entries_v2_company_tipo_date
      ON app_financial_entries_v2 (company_id,tipo,data_vencimento,id);
    CREATE INDEX IF NOT EXISTS idx_financial_entries_v2_company_status_date
      ON app_financial_entries_v2 (company_id,status,data_vencimento,id);

    CREATE TABLE IF NOT EXISTS app_financial_audit_v2 (
      id BIGSERIAL PRIMARY KEY,
      company_id TEXT NOT NULL,
      action TEXT NOT NULL,
      detail TEXT NOT NULL DEFAULT '',
      actor_name TEXT NOT NULL DEFAULT '',
      actor_email TEXT NOT NULL DEFAULT '',
      actor_role TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_financial_audit_v2_company_created
      ON app_financial_audit_v2 (company_id,created_at DESC);
  `)
}

function entryFromRow(row){
  if(!row) return null
  return {
    ...(row.payload || {}),
    id: row.id,
    company_id: row.company_id,
    tipo: row.tipo,
    descricao: row.descricao || '',
    cliente: row.cliente || '',
    fornecedor: row.fornecedor || '',
    valor: Number(row.valor || 0),
    dataVencimento: row.data_vencimento || '',
    status: row.status || 'pendente',
    formaPagamento: row.forma_pagamento || '',
    categoria: row.categoria || '',
    created_at: row.created_at,
    updated_at: row.updated_at
  }
}

async function migrationAlreadyDone(client){
  const result = await client.query("SELECT value FROM app_financial_v2_meta WHERE key='legacy_import_v1' LIMIT 1")
  return result.rows[0]?.value || null
}

async function migrateLegacyFinancial(store){
  const pool = getPool()
  const client = await pool.connect()
  try{
    await client.query('BEGIN')
    const marker = await migrationAlreadyDone(client)
    if(marker){
      await client.query('ROLLBACK')
      return {skipped:true,...marker}
    }

    const entries = Array.isArray(store?.financialEntries) ? store.financialEntries : []
    let migrated = 0
    for(const raw of entries){
      const companyId = text(raw?.company_id)
      const tipo = normalizeTipo(raw?.tipo)
      if(!companyId || !tipo) continue
      const id = text(raw?.id) || crypto.randomUUID()
      const payload = cleanJson(raw)
      const createdAt = timestamp(raw?.created_at)
      const updatedAt = timestamp(raw?.updated_at || raw?.created_at)
      const result = await client.query(`
        INSERT INTO app_financial_entries_v2 (
          company_id,id,tipo,descricao,cliente,fornecedor,valor,data_vencimento,status,
          forma_pagamento,categoria,payload,created_at,updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14)
        ON CONFLICT (company_id,id) DO NOTHING
      `,[
        companyId,id,tipo,text(raw?.descricao),text(raw?.cliente),text(raw?.fornecedor),
        num(raw?.valor,0),isoDate(raw?.dataVencimento),normalizeStatus(raw?.status),
        text(raw?.formaPagamento),text(raw?.categoria),JSON.stringify(payload),createdAt,updatedAt
      ])
      migrated += result.rowCount || 0
    }

    const marker = {entries:migrated,finished_at:new Date().toISOString()}
    await client.query(`
      INSERT INTO app_financial_v2_meta (key,value,updated_at)
      VALUES ('legacy_import_v1',$1::jsonb,NOW())
      ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value,updated_at=NOW()
    `,[JSON.stringify(marker)])
    await client.query('COMMIT')
    return {skipped:false,...marker}
  }catch(err){
    await client.query('ROLLBACK').catch(()=>{})
    throw err
  }finally{
    client.release()
  }
}

async function listEntries(companyId,{tipo='',status=''}={}){
  const pool = getPool()
  const params=[text(companyId)]
  const where=['company_id=$1']
  const normalizedTipo=normalizeTipo(tipo)
  const normalizedStatus=text(status).toLowerCase()
  if(normalizedTipo){
    params.push(normalizedTipo)
    where.push(`tipo=$${params.length}`)
  }
  if(['pendente','pago','recebido'].includes(normalizedStatus)){
    params.push(normalizedStatus)
    where.push(`status=$${params.length}`)
  }
  const result=await pool.query(`
    SELECT * FROM app_financial_entries_v2
    WHERE ${where.join(' AND ')}
    ORDER BY data_vencimento ASC,id ASC
  `,params)
  return result.rows.map(entryFromRow)
}

async function getEntry(companyId,id){
  const pool=getPool()
  const result=await pool.query(
    'SELECT * FROM app_financial_entries_v2 WHERE company_id=$1 AND id=$2 LIMIT 1',
    [text(companyId),text(id)]
  )
  return entryFromRow(result.rows[0])
}

async function createEntry(companyId,input={}){
  const tipo=normalizeTipo(input?.tipo)
  if(!tipo){
    const err=new Error('tipo deve ser "pagar" ou "receber".')
    err.code='invalid_tipo'
    err.statusCode=400
    throw err
  }
  const pool=getPool()
  const id=crypto.randomUUID()
  const payload=cleanJson(input)
  const result=await pool.query(`
    INSERT INTO app_financial_entries_v2 (
      company_id,id,tipo,descricao,cliente,fornecedor,valor,data_vencimento,status,
      forma_pagamento,categoria,payload,created_at,updated_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pendente',$9,$10,$11::jsonb,NOW(),NOW())
    RETURNING *
  `,[
    text(companyId),id,tipo,text(input?.descricao),text(input?.cliente),text(input?.fornecedor),
    num(input?.valor,0),isoDate(input?.dataVencimento),text(input?.formaPagamento),
    text(input?.categoria),JSON.stringify(payload)
  ])
  return entryFromRow(result.rows[0])
}

async function updateEntry(companyId,id,patch={}){
  const current=await getEntry(companyId,id)
  if(!current) return null

  const payload={...(current || {}),...cleanJson(patch)}
  delete payload.id
  delete payload.company_id
  delete payload.created_at
  delete payload.updated_at

  const descricao=patch.descricao!==undefined ? text(patch.descricao,current.descricao) : current.descricao
  const cliente=patch.cliente!==undefined ? text(patch.cliente,current.cliente) : current.cliente
  const fornecedor=patch.fornecedor!==undefined ? text(patch.fornecedor,current.fornecedor) : current.fornecedor
  const valor=patch.valor!==undefined ? num(patch.valor,current.valor) : current.valor
  const dataVencimento=patch.dataVencimento!==undefined ? (isoDate(patch.dataVencimento)||current.dataVencimento) : current.dataVencimento
  const formaPagamento=patch.formaPagamento!==undefined ? text(patch.formaPagamento,current.formaPagamento) : current.formaPagamento
  const categoria=patch.categoria!==undefined ? text(patch.categoria,current.categoria) : current.categoria
  const incomingStatus=patch.status!==undefined ? text(patch.status).toLowerCase() : current.status
  const status=['pendente','pago','recebido'].includes(incomingStatus) ? incomingStatus : current.status

  const pool=getPool()
  const result=await pool.query(`
    UPDATE app_financial_entries_v2
    SET descricao=$3,cliente=$4,fornecedor=$5,valor=$6,data_vencimento=$7,status=$8,
        forma_pagamento=$9,categoria=$10,payload=$11::jsonb,updated_at=NOW()
    WHERE company_id=$1 AND id=$2
    RETURNING *
  `,[text(companyId),text(id),descricao,cliente,fornecedor,valor,dataVencimento,status,formaPagamento,categoria,JSON.stringify(payload)])
  return entryFromRow(result.rows[0])
}

async function deleteEntry(companyId,id){
  const pool=getPool()
  const result=await pool.query(
    'DELETE FROM app_financial_entries_v2 WHERE company_id=$1 AND id=$2 RETURNING id',
    [text(companyId),text(id)]
  )
  return result.rowCount>0
}

async function auditEvent(companyId,action,detail,user={}){
  const pool=getPool()
  await pool.query(`
    INSERT INTO app_financial_audit_v2 (company_id,action,detail,actor_name,actor_email,actor_role)
    VALUES ($1,$2,$3,$4,$5,$6)
  `,[
    text(companyId),text(action),text(detail),text(user?.name || user?.email || 'Usuário'),
    text(user?.email),text(user?.role || 'user')
  ])
}

module.exports={
  ensureSchema,
  migrateLegacyFinancial,
  listEntries,
  getEntry,
  createEntry,
  updateEntry,
  deleteEntry,
  auditEvent
}
