'use strict'

const crypto = require('crypto')
const storeLib = require('./store')

let enabled = false

function getPool(){
  const pool = storeLib && storeLib._pg && storeLib._pg.pool
  if(!pool){
    const err = new Error('PostgreSQL não disponível para Auditoria V2.')
    err.code = 'postgres_required'
    throw err
  }
  return pool
}

function text(value,fallback=''){
  if(value === undefined || value === null) return fallback
  return String(value).trim()
}

function jsonObject(value){
  if(!value || typeof value !== 'object' || Array.isArray(value)) return null
  return JSON.parse(JSON.stringify(value))
}

function timestamp(value){
  const d = value ? new Date(value) : new Date()
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString()
}

function normalizeEntry(entry={}){
  const raw = jsonObject(entry) || {}
  return {
    ...raw,
    id: text(raw.id) || crypto.randomUUID(),
    company_id: text(raw.company_id) || null,
    action: text(raw.action,'unknown') || 'unknown',
    message: text(raw.message || raw.detail),
    actor_user_id: text(raw.actor_user_id),
    actor_name: text(raw.actor_name || raw.actor),
    actor_email: text(raw.actor_email),
    actor_role: text(raw.actor_role),
    reason: text(raw.reason),
    source: text(raw.source),
    ip_address: text(raw.ip_address),
    user_agent: text(raw.user_agent),
    request_json: jsonObject(raw.request_json),
    before_json: jsonObject(raw.before_json),
    after_json: jsonObject(raw.after_json),
    created_at: timestamp(raw.created_at)
  }
}

async function ensureSchema(){
  const pool = getPool()
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_audit_v2_meta (
      key TEXT PRIMARY KEY,
      value JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS app_audit_logs_v2 (
      id TEXT PRIMARY KEY,
      company_id TEXT,
      action TEXT NOT NULL DEFAULT 'unknown',
      message TEXT NOT NULL DEFAULT '',
      actor_user_id TEXT NOT NULL DEFAULT '',
      actor_name TEXT NOT NULL DEFAULT '',
      actor_email TEXT NOT NULL DEFAULT '',
      actor_role TEXT NOT NULL DEFAULT '',
      reason TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT '',
      ip_address TEXT NOT NULL DEFAULT '',
      user_agent TEXT NOT NULL DEFAULT '',
      request_json JSONB,
      before_json JSONB,
      after_json JSONB,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_audit_logs_v2_company_created
      ON app_audit_logs_v2 (company_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_v2_action_created
      ON app_audit_logs_v2 (action, created_at DESC);
  `)
}

async function insertMany(clientOrPool, entries){
  const normalized = (Array.isArray(entries) ? entries : [])
    .filter(Boolean)
    .map(normalizeEntry)
  if(!normalized.length) return 0

  const runner = clientOrPool || getPool()
  const result = await runner.query(`
    INSERT INTO app_audit_logs_v2 (
      id,company_id,action,message,actor_user_id,actor_name,actor_email,actor_role,
      reason,source,ip_address,user_agent,request_json,before_json,after_json,payload,created_at
    )
    SELECT
      item->>'id',
      NULLIF(item->>'company_id',''),
      COALESCE(NULLIF(item->>'action',''),'unknown'),
      COALESCE(item->>'message',''),
      COALESCE(item->>'actor_user_id',''),
      COALESCE(item->>'actor_name',''),
      COALESCE(item->>'actor_email',''),
      COALESCE(item->>'actor_role',''),
      COALESCE(item->>'reason',''),
      COALESCE(item->>'source',''),
      COALESCE(item->>'ip_address',''),
      COALESCE(item->>'user_agent',''),
      item->'request_json',
      item->'before_json',
      item->'after_json',
      item,
      (item->>'created_at')::timestamptz
    FROM jsonb_array_elements($1::jsonb) AS item
    ON CONFLICT (id) DO NOTHING
  `,[JSON.stringify(normalized)])
  return result.rowCount || 0
}

async function migrationMarker(client){
  const result = await client.query("SELECT value FROM app_audit_v2_meta WHERE key='legacy_import_v1' LIMIT 1")
  return result.rows[0]?.value || null
}

async function migrateLegacyAudit(store){
  const pool = getPool()
  const client = await pool.connect()
  try{
    await client.query('BEGIN')
    const existing = await migrationMarker(client)
    const legacy = Array.isArray(store?.auditLogs) ? store.auditLogs : []
    const synced = await insertMany(client, legacy)

    if(existing){
      await client.query('COMMIT')
      return { skipped:true, synced, ...(existing || {}) }
    }

    const marker = {
      entries: legacy.length,
      inserted: synced,
      finished_at: new Date().toISOString()
    }
    await client.query(`
      INSERT INTO app_audit_v2_meta (key,value,updated_at)
      VALUES ('legacy_import_v1',$1::jsonb,NOW())
      ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value,updated_at=NOW()
    `,[JSON.stringify(marker)])
    await client.query('COMMIT')
    return { skipped:false, synced, ...marker }
  }catch(err){
    await client.query('ROLLBACK').catch(()=>{})
    throw err
  }finally{
    client.release()
  }
}

function enableWrites(){
  enabled = true
}

function isEnabled(){
  return enabled
}

function queueAudit(store,entry){
  if(!store || typeof store !== 'object') return null
  const normalized = normalizeEntry(entry)
  if(!Array.isArray(store.__auditV2Pending)) store.__auditV2Pending = []
  store.__auditV2Pending.push(normalized)
  return normalized
}

function fromRow(row){
  if(!row) return null
  return {
    ...(row.payload || {}),
    id: row.id,
    company_id: row.company_id || undefined,
    action: row.action || 'unknown',
    message: row.message || '',
    actor_user_id: row.actor_user_id || '',
    actor_name: row.actor_name || '',
    actor_email: row.actor_email || '',
    actor_role: row.actor_role || '',
    reason: row.reason || '',
    source: row.source || '',
    ip_address: row.ip_address || '',
    user_agent: row.user_agent || '',
    request_json: row.request_json || undefined,
    before_json: row.before_json || undefined,
    after_json: row.after_json || undefined,
    created_at: row.created_at
  }
}

async function listGlobal(limit=100){
  const pool = getPool()
  const safeLimit = Math.min(500,Math.max(1,Number(limit)||100))
  const [itemsResult,totalResult] = await Promise.all([
    pool.query('SELECT * FROM app_audit_logs_v2 ORDER BY created_at ASC, id ASC LIMIT $1',[safeLimit]),
    pool.query('SELECT COUNT(*)::int AS total FROM app_audit_logs_v2')
  ])
  return {
    items: itemsResult.rows.map(fromRow),
    total: Number(totalResult.rows[0]?.total || 0)
  }
}

async function listCompany(companyId){
  const pool = getPool()
  const result = await pool.query(
    'SELECT * FROM app_audit_logs_v2 WHERE company_id=$1 ORDER BY created_at DESC, id DESC',
    [text(companyId)]
  )
  return result.rows.map(fromRow)
}

async function deleteCompanyAudits(clientOrPool,companyId){
  const runner = clientOrPool || getPool()
  const result = await runner.query('DELETE FROM app_audit_logs_v2 WHERE company_id=$1',[text(companyId)])
  return result.rowCount || 0
}

module.exports = {
  ensureSchema,
  migrateLegacyAudit,
  insertMany,
  enableWrites,
  isEnabled,
  queueAudit,
  listGlobal,
  listCompany,
  deleteCompanyAudits,
  normalizeEntry
}
