'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { ensureLedger, runOnce, runStartupMigrations } = require('../src/lib/startup-migrations')

function fixture() {
  const state = { rows: new Map(), locks: 0, unlocks: 0 }
  const client = {
    async query(sql, params = []) {
      if (sql.includes('pg_advisory_lock')) { state.locks++; return { rows: [] } }
      if (sql.includes('pg_advisory_unlock')) { state.unlocks++; return { rows: [] } }
      if (sql.includes('SELECT status, details')) {
        const row = state.rows.get(params[0])
        return { rows: row ? [structuredClone(row)] : [] }
      }
      if (sql.includes("VALUES ($1,'running'")) {
        state.rows.set(params[0], { status: 'running', details: {} })
        return { rows: [], rowCount: 1 }
      }
      if (sql.includes("SET status='completed'")) {
        state.rows.set(params[0], { status: 'completed', details: JSON.parse(params[1]) })
        return { rows: [], rowCount: 1 }
      }
      if (sql.includes("SET status='failed'")) {
        state.rows.set(params[0], { status: 'failed', details: JSON.parse(params[1]) })
        return { rows: [], rowCount: 1 }
      }
      if (sql.includes('CREATE TABLE IF NOT EXISTS')) return { rows: [] }
      throw new Error(`SQL inesperado: ${sql}`)
    },
    release() {}
  }
  const pool = {
    query: (...args) => client.query(...args),
    connect: async () => client
  }
  return { state, pool }
}

test('ensureLedger cria somente a tabela de controle', async () => {
  const f = fixture()
  await ensureLedger(f.pool)
})

test('runOnce executa uma migração apenas uma vez', async () => {
  const f = fixture()
  let calls = 0
  const migration = { name: 'migration-v1', run: async () => ({ changed: ++calls }) }
  const first = await runOnce(f.pool, migration)
  const second = await runOnce(f.pool, migration)

  assert.equal(first.skipped, false)
  assert.equal(second.skipped, true)
  assert.equal(calls, 1)
  assert.equal(f.state.rows.get('migration-v1').status, 'completed')
  assert.equal(f.state.locks, 2)
  assert.equal(f.state.unlocks, 2)
})

test('falha fica registrada e pode ser tentada novamente', async () => {
  const f = fixture()
  let calls = 0
  const migration = {
    name: 'retry-v1',
    run: async () => {
      calls++
      if (calls === 1) throw new Error('falha controlada')
      return { ok: true }
    }
  }
  await assert.rejects(runOnce(f.pool, migration), /falha controlada/)
  assert.equal(f.state.rows.get('retry-v1').status, 'failed')
  const retry = await runOnce(f.pool, migration)
  assert.equal(retry.skipped, false)
  assert.equal(f.state.rows.get('retry-v1').status, 'completed')
})

test('runStartupMigrations mantém a ordem declarada', async () => {
  const f = fixture()
  const order = []
  await runStartupMigrations({
    pool: f.pool,
    migrations: [
      { name: 'one', run: async () => { order.push('one') } },
      { name: 'two', run: async () => { order.push('two') } }
    ]
  })
  assert.deepEqual(order, ['one', 'two'])
})
