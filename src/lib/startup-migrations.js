'use strict'

const LEDGER_TABLE = 'app_startup_migrations'

function text(value) {
  return String(value ?? '').trim()
}

function safeDetails(value) {
  if (value === undefined) return {}
  try {
    return JSON.parse(JSON.stringify(value))
  } catch (_error) {
    return { result: text(value).slice(0, 500) }
  }
}

async function ensureLedger(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${LEDGER_TABLE} (
      name TEXT PRIMARY KEY,
      status TEXT NOT NULL CHECK (status IN ('running','completed','failed')),
      details JSONB NOT NULL DEFAULT '{}'::jsonb,
      started_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
}

async function runOnce(pool, migration) {
  const name = text(migration?.name)
  if (!name || typeof migration?.run !== 'function') throw new Error('startup_migration_invalid')
  const client = await pool.connect()
  let locked = false
  try {
    await client.query('SELECT pg_advisory_lock(hashtext($1))', [`startup-migration:${name}`])
    locked = true
    const existing = await client.query(
      `SELECT status, details, completed_at FROM ${LEDGER_TABLE} WHERE name=$1 LIMIT 1`,
      [name]
    )
    if (existing.rows[0]?.status === 'completed') {
      return { name, skipped: true, details: existing.rows[0].details || {} }
    }

    await client.query(`
      INSERT INTO ${LEDGER_TABLE} (name,status,details,started_at,completed_at,updated_at)
      VALUES ($1,'running','{}'::jsonb,NOW(),NULL,NOW())
      ON CONFLICT (name) DO UPDATE SET
        status='running',details='{}'::jsonb,started_at=NOW(),completed_at=NULL,updated_at=NOW()
    `, [name])

    try {
      const details = safeDetails(await migration.run())
      await client.query(`
        UPDATE ${LEDGER_TABLE}
        SET status='completed',details=$2::jsonb,completed_at=NOW(),updated_at=NOW()
        WHERE name=$1
      `, [name, JSON.stringify(details)])
      return { name, skipped: false, details }
    } catch (error) {
      await client.query(`
        UPDATE ${LEDGER_TABLE}
        SET status='failed',details=$2::jsonb,completed_at=NULL,updated_at=NOW()
        WHERE name=$1
      `, [name, JSON.stringify({ error: text(error?.message || error).slice(0, 500) })]).catch(() => {})
      throw error
    }
  } finally {
    if (locked) {
      await client.query('SELECT pg_advisory_unlock(hashtext($1))', [`startup-migration:${name}`]).catch(() => {})
    }
    client.release()
  }
}

async function runStartupMigrations({ pool, migrations = [] }) {
  if (!pool) throw new Error('startup_migrations_postgres_required')
  await ensureLedger(pool)
  const results = []
  for (const migration of migrations) results.push(await runOnce(pool, migration))
  const executed = results.filter(item => !item.skipped).map(item => item.name)
  const skipped = results.filter(item => item.skipped).map(item => item.name)
  console.log('[startup-migrations] Resultado:', JSON.stringify({ executed, skipped }))
  return results
}

module.exports = { LEDGER_TABLE, ensureLedger, runOnce, runStartupMigrations }
