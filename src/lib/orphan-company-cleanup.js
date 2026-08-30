'use strict'

const crypto = require('crypto')

const COMPANY_TABLES = [
  'app_quote_model_items_v2',
  'app_quote_models_v2',
  'app_quotes_v2',
  'app_model_images_v2',
  'app_model_materials_v2',
  'app_model_personalization_v2',
  'app_models_v2',
  'app_personalization_catalog_v2',
  'app_agenda_orders_v2',
  'app_agenda_blocos_v2',
  'app_agenda_configs_v2',
  'app_agenda_audit_v2',
  'app_financial_audit_v2',
  'app_financial_entries_v2',
  'app_audit_logs_v2',
  'audits',
  'users'
]

function text(value) {
  return String(value ?? '').trim()
}

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function confirmationFor(companyId) {
  return `PURGE-ORPHAN:${text(companyId)}`
}

function companyIdOfWebhook(record) {
  const payload = record && typeof record.payload === 'object' ? record.payload : {}
  const object = payload.data && typeof payload.data.object === 'object'
    ? payload.data.object
    : {}
  return text(
    record?.company_id ||
    record?.companyId ||
    payload.company_id ||
    payload.companyId ||
    object.company_id ||
    object.companyId ||
    object.metadata?.company_id ||
    object.metadata?.companyId
  )
}

function itemBelongsToCompany(collection, item, companyId) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return false
  const cid = text(companyId)
  if (collection === 'companies') return text(item.id) === cid
  if (collection === 'webhookEvents') return companyIdOfWebhook(item) === cid
  return text(item.company_id || item.companyId) === cid
}

function splitKvStore(rawStore, companyId) {
  const cleaned = clone(rawStore || {})
  const backup = {}
  const counts = {}

  for (const [collection, value] of Object.entries(cleaned)) {
    if (!Array.isArray(value)) continue
    const matched = value.filter(item => itemBelongsToCompany(collection, item, companyId))
    if (!matched.length) continue
    backup[collection] = matched
    counts[collection] = matched.length
    cleaned[collection] = value.filter(item => !itemBelongsToCompany(collection, item, companyId))
  }

  return { cleaned, backup, counts }
}

function assertOrphanTarget(store, companyId) {
  const cid = text(companyId)
  if (!cid) {
    const err = new Error('ORPHAN_CLEANUP_COMPANY_ID não pode ser vazio.')
    err.code = 'orphan_cleanup_company_required'
    throw err
  }
  if ((store?.companies || []).some(company => text(company?.id) === cid)) {
    const err = new Error('A limpeza de órfãos recusou uma empresa ativa.')
    err.code = 'orphan_cleanup_target_active'
    throw err
  }
}

async function readCompanyRows(client, companyId) {
  const rows = {}
  for (const table of COMPANY_TABLES) {
    const result = await client.query(
      `SELECT to_jsonb(t) AS row FROM ${table} t WHERE company_id = $1`,
      [companyId]
    )
    if (result.rows.length) rows[table] = result.rows.map(item => item.row)
  }
  return rows
}

async function deleteCompanyRows(client, companyId) {
  const counts = {}
  for (const table of COMPANY_TABLES) {
    const result = await client.query(`DELETE FROM ${table} WHERE company_id = $1`, [companyId])
    if (result.rowCount) counts[table] = result.rowCount
  }
  return counts
}

async function assertPgClean(client, companyId) {
  for (const table of COMPANY_TABLES) {
    const result = await client.query(
      `SELECT COUNT(*)::int AS total FROM ${table} WHERE company_id = $1`,
      [companyId]
    )
    if (Number(result.rows[0]?.total || 0) !== 0) {
      throw new Error(`orphan_cleanup_verify_${table}`)
    }
  }
}

function countRows(groups) {
  return Object.values(groups || {}).reduce((total, rows) => total + rows.length, 0)
}

function backupKey(companyId, timestamp) {
  const safeTime = timestamp.replace(/[:.]/g, '-')
  return `backups/orphan-company-cleanup/${text(companyId)}/${safeTime}.json`
}

async function uploadVerifiedBackup(r2, companyId, payload) {
  if (!r2?.isConfigured?.()) {
    const err = new Error('R2 precisa estar configurado antes da limpeza de órfãos.')
    err.code = 'orphan_cleanup_r2_required'
    throw err
  }

  const body = Buffer.from(JSON.stringify(payload))
  const sha256 = crypto.createHash('sha256').update(body).digest('hex')
  const objectKey = backupKey(companyId, payload.created_at)
  await r2.putObject(objectKey, body, 'application/json', {
    company_id: companyId,
    backup_type: 'orphan-company-cleanup',
    sha256
  })

  const head = await r2.headObject(objectKey)
  if (!head.exists || Number(head.sizeBytes) !== body.length) {
    throw new Error('orphan_cleanup_backup_head_mismatch')
  }
  const downloaded = await r2.getObjectBuffer(objectKey)
  const restoredSha256 = crypto.createHash('sha256').update(downloaded.body).digest('hex')
  if (downloaded.sizeBytes !== body.length || restoredSha256 !== sha256) {
    throw new Error('orphan_cleanup_backup_hash_mismatch')
  }

  return { objectKey, sha256, sizeBytes: body.length }
}

async function purgeOrphanCompany({ companyId, confirmation, storeLib, r2 }) {
  const cid = text(companyId)
  if (text(confirmation) !== confirmationFor(cid)) {
    const err = new Error('Confirmação da limpeza de órfãos inválida.')
    err.code = 'orphan_cleanup_confirmation_invalid'
    throw err
  }
  const pg = storeLib?._pg
  if (!pg?.pool) throw new Error('postgres_required')

  await pg.flushNow()
  const client = await pg.pool.connect()
  let cleanedStore = null
  let backup = null
  let kvCounts = {}
  let pgCounts = {}

  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ')
    const storeResult = await client.query("SELECT value FROM kv_store WHERE key = 'main' FOR UPDATE")
    const rawStore = storeResult.rows[0]?.value || storeLib.readStore()
    assertOrphanTarget(rawStore, cid)

    const split = splitKvStore(rawStore, cid)
    const pgRows = await readCompanyRows(client, cid)
    const totalRows = countRows(split.backup) + countRows(pgRows)
    if (!totalRows) {
      await client.query('ROLLBACK')
      return { alreadyClean: true, companyId: cid, kvCounts: {}, pgCounts: {} }
    }

    const createdAt = new Date().toISOString()
    const backupPayload = {
      schema: 'estofaria-orphan-company-backup-v1',
      company_id: cid,
      created_at: createdAt,
      kv_store: split.backup,
      postgres: pgRows
    }
    backup = await uploadVerifiedBackup(r2, cid, backupPayload)

    pgCounts = await deleteCompanyRows(client, cid)
    kvCounts = split.counts
    cleanedStore = split.cleaned
    await client.query(
      `UPDATE kv_store SET value = $1::jsonb, updated_at = NOW() WHERE key = 'main'`,
      [JSON.stringify(cleanedStore)]
    )
    await assertPgClean(client, cid)
    const verifyStore = await client.query("SELECT value FROM kv_store WHERE key = 'main'")
    const residual = splitKvStore(verifyStore.rows[0]?.value || {}, cid)
    if (countRows(residual.backup) !== 0) throw new Error('orphan_cleanup_verify_kv_store')

    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    client.release()
  }

  storeLib.writeStore(cleanedStore)
  await pg.flushNow()
  return { alreadyClean: false, companyId: cid, backup, kvCounts, pgCounts }
}

async function runControlledOrphanCleanup({ storeLib, r2, env = process.env }) {
  const companyId = text(env.ORPHAN_CLEANUP_COMPANY_ID)
  if (!companyId) return null
  const result = await purgeOrphanCompany({
    companyId,
    confirmation: env.ORPHAN_CLEANUP_CONFIRM,
    storeLib,
    r2
  })
  console.log('[orphan-cleanup] Resultado:', JSON.stringify(result))
  return result
}

module.exports = {
  COMPANY_TABLES,
  confirmationFor,
  splitKvStore,
  assertOrphanTarget,
  purgeOrphanCompany,
  runControlledOrphanCleanup
}
