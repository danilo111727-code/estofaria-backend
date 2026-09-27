'use strict'

const storeLib = require('./store')

function getPool(){
  const pool = storeLib && storeLib._pg && storeLib._pg.pool
  if(!pool){
    const err = new Error('PostgreSQL não disponível para configuração de PDF.')
    err.code = 'postgres_required'
    throw err
  }
  return pool
}

function cleanConfig(value){
  if(!Array.isArray(value)) return []
  return JSON.parse(JSON.stringify(value))
}

async function ensureSchema(){
  const pool = getPool()
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_pdf_configs (
      company_id TEXT PRIMARY KEY,
      config JSONB NOT NULL DEFAULT '[]'::jsonb,
      migrated_from_local BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `)
}

async function getConfig(companyId){
  const pool = getPool()
  const result = await pool.query(
    'SELECT company_id,config,migrated_from_local,created_at,updated_at FROM app_pdf_configs WHERE company_id=$1 LIMIT 1',
    [String(companyId || '').trim()]
  )
  const row = result.rows[0]
  if(!row) return null
  return {
    company_id: row.company_id,
    config: Array.isArray(row.config) ? row.config : [],
    migrated_from_local: Boolean(row.migrated_from_local),
    created_at: row.created_at,
    updated_at: row.updated_at
  }
}

async function saveConfig(companyId, config, options={}){
  const pool = getPool()
  const normalizedCompanyId = String(companyId || '').trim()
  if(!normalizedCompanyId) throw new Error('company_required')
  const payload = cleanConfig(config)
  const migrated = Boolean(options.migratedFromLocal)
  const result = await pool.query(`
    INSERT INTO app_pdf_configs (company_id,config,migrated_from_local,created_at,updated_at)
    VALUES ($1,$2::jsonb,$3,NOW(),NOW())
    ON CONFLICT (company_id) DO UPDATE SET
      config=EXCLUDED.config,
      migrated_from_local=(app_pdf_configs.migrated_from_local OR EXCLUDED.migrated_from_local),
      updated_at=NOW()
    RETURNING company_id,config,migrated_from_local,created_at,updated_at
  `,[normalizedCompanyId,JSON.stringify(payload),migrated])
  const row=result.rows[0]
  return {
    company_id:row.company_id,
    config:Array.isArray(row.config) ? row.config : [],
    migrated_from_local:Boolean(row.migrated_from_local),
    created_at:row.created_at,
    updated_at:row.updated_at
  }
}

module.exports={ensureSchema,getConfig,saveConfig}
