'use strict'

const fs = require('fs')
const path = require('path')
const { Pool } = require('pg')

const TARGET_IDS = [
  '0ce24c76-dc40-4ed6-a632-b2fd8fc5ea6c',
  '1bb1f492-f7cd-493f-8d5b-cc3e9df84af2',
  '350cc7c4-7ac7-473b-ba75-c60207de05b8',
  '8bacc8ec-8433-4ec0-b93a-9d46543f5a85',
  '94ee8175-da39-4dde-8ee5-75f5ce49111b',
  'b7085267-80b0-4388-8780-8fb0eff9e55b',
  'd628cd4e-c4a8-4d8e-a480-61c3ad68138b',
  'eb363c21-6d58-46b6-9425-19dc99d8a63b',
  'ee1a79cd-2d14-46a3-8ad3-17ecf8916e7e'
]

const TABLES_IN_DELETE_ORDER = [
  'app_model_materials_v2',
  'app_model_images_v2',
  'app_model_personalization_v2',
  'app_quote_model_items_v2',
  'app_quote_models_v2',
  'app_quotes_v2',
  'app_models_v2',
  'app_personalization_catalog_v2',
  'app_agenda_orders_v2',
  'app_agenda_blocos_v2',
  'app_agenda_configs_v2',
  'app_agenda_audit_v2',
  'app_financial_entries_v2',
  'app_financial_audit_v2',
  'app_audit_logs_v2',
  'audits',
  'users'
]

function text(v){ return String(v ?? '').trim() }
function belongsToTarget(item, targets){
  if(!item || typeof item !== 'object') return false
  if(targets.has(text(item.company_id))) return true
  if(targets.has(text(item.companyId))) return true
  if(targets.has(text(item.tenant_id))) return true
  if(targets.has(text(item.tenantId))) return true
  if(targets.has(text(item?.payload?.company_id))) return true
  if(targets.has(text(item?.payload?.data?.object?.company_id))) return true
  if(targets.has(text(item?.payload?.data?.object?.metadata?.company_id))) return true
  return false
}

async function main(){
  if(!process.env.DATABASE_URL) throw new Error('DATABASE_URL ausente')
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 })
  const client = await pool.connect()
  const targets = new Set(TARGET_IDS)
  const backup = {
    created_at: new Date().toISOString(),
    target_company_ids: TARGET_IDS,
    kv_store: {},
    tables: {}
  }

  try{
    await client.query('BEGIN')
    const kv = await client.query("SELECT value FROM kv_store WHERE key='main' FOR UPDATE")
    if(!kv.rows.length) throw new Error('kv_store.main ausente')
    const store = kv.rows[0].value || {}

    const stillActive = (Array.isArray(store.companies) ? store.companies : [])
      .filter(c => targets.has(text(c?.id)))
      .map(c => ({ id:text(c?.id), name:text(c?.name || c?.trade_name) }))
    if(stillActive.length){
      throw new Error(`ABORTADO: company_id alvo ainda existe em companies: ${JSON.stringify(stillActive)}`)
    }

    for(const [key, value] of Object.entries(store)){
      if(!Array.isArray(value)) continue
      const matched = value.filter(item => belongsToTarget(item, targets))
      if(matched.length){
        backup.kv_store[key] = matched
        store[key] = value.filter(item => !belongsToTarget(item, targets))
      }
    }

    for(const table of TABLES_IN_DELETE_ORDER){
      const rows = await client.query(`SELECT * FROM ${table} WHERE company_id = ANY($1::uuid[])`, [TARGET_IDS])
      if(rows.rows.length) backup.tables[table] = rows.rows
    }

    const backupDir = process.env.DATA_DIR || '/data'
    fs.mkdirSync(backupDir, { recursive:true })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const backupPath = path.join(backupDir, `orphan-companies-backup-${stamp}.json`)
    fs.writeFileSync(backupPath, JSON.stringify(backup, null, 2), { mode:0o600 })

    for(const table of TABLES_IN_DELETE_ORDER){
      await client.query(`DELETE FROM ${table} WHERE company_id = ANY($1::uuid[])`, [TARGET_IDS])
    }

    await client.query(
      `UPDATE kv_store SET value=$1::jsonb, updated_at=NOW() WHERE key='main'`,
      [JSON.stringify(store)]
    )

    for(const table of TABLES_IN_DELETE_ORDER){
      const check = await client.query(`SELECT COUNT(*)::int AS total FROM ${table} WHERE company_id = ANY($1::uuid[])`, [TARGET_IDS])
      if(Number(check.rows[0]?.total || 0) !== 0) throw new Error(`verificação falhou em ${table}`)
    }

    for(const [key, value] of Object.entries(store)){
      if(!Array.isArray(value)) continue
      if(value.some(item => belongsToTarget(item, targets))) throw new Error(`verificação falhou em kv_store.${key}`)
    }

    await client.query('COMMIT')
    console.log('[orphan-cleanup] SUCESSO')
    console.log(`[orphan-cleanup] backup=${backupPath}`)
    console.log(`[orphan-cleanup] company_ids=${TARGET_IDS.length}`)
  }catch(error){
    await client.query('ROLLBACK').catch(() => {})
    console.error('[orphan-cleanup] FALHA:', error?.stack || error)
    process.exitCode = 1
  }finally{
    client.release()
    await pool.end()
  }
}

main()
