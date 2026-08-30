'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const {
  COMPANY_TABLES,
  confirmationFor,
  splitKvStore,
  assertOrphanTarget,
  purgeOrphanCompany
} = require('../src/lib/orphan-company-cleanup')

test('confirmationFor vincula a confirmação à empresa exata', () => {
  assert.equal(confirmationFor(' company-1 '), 'PURGE-ORPHAN:company-1')
})

test('splitKvStore remove somente o alvo em todas as coleções suportadas', () => {
  const source = {
    companies: [{ id: 'active' }],
    materials: [
      { id: 'm1', company_id: 'orphan' },
      { id: 'm2', company_id: 'active' }
    ],
    quotes: [{ id: 'q1', companyId: 'orphan' }],
    webhookEvents: [
      { id: 'w1', payload: { data: { object: { metadata: { company_id: 'orphan' } } } } },
      { id: 'w2', payload: { company_id: 'active' } }
    ],
    billingConfig: { enabled: true }
  }
  const result = splitKvStore(source, 'orphan')

  assert.deepEqual(result.counts, { materials: 1, quotes: 1, webhookEvents: 1 })
  assert.deepEqual(result.cleaned.materials, [{ id: 'm2', company_id: 'active' }])
  assert.deepEqual(result.cleaned.quotes, [])
  assert.deepEqual(result.cleaned.webhookEvents, [{ id: 'w2', payload: { company_id: 'active' } }])
  assert.deepEqual(source.materials, [
    { id: 'm1', company_id: 'orphan' },
    { id: 'm2', company_id: 'active' }
  ])
})

test('assertOrphanTarget recusa empresa ativa', () => {
  assert.throws(
    () => assertOrphanTarget({ companies: [{ id: 'company-1' }] }, 'company-1'),
    error => error.code === 'orphan_cleanup_target_active'
  )
  assert.doesNotThrow(() => assertOrphanTarget({ companies: [] }, 'company-1'))
})

function cleanupFixture(store, initialTables = {}) {
  const state = {
    store: structuredClone(store),
    tables: Object.fromEntries(COMPANY_TABLES.map(table => [table, structuredClone(initialTables[table] || [])])),
    committed: false,
    rolledBack: false
  }
  const client = {
    async query(sql, params = []) {
      if (sql.startsWith('BEGIN')) return { rows: [], rowCount: 0 }
      if (sql === 'COMMIT') {
        state.committed = true
        return { rows: [], rowCount: 0 }
      }
      if (sql === 'ROLLBACK') {
        state.rolledBack = true
        return { rows: [], rowCount: 0 }
      }
      if (sql.includes("SELECT value FROM kv_store WHERE key = 'main'")) {
        return { rows: [{ value: structuredClone(state.store) }], rowCount: 1 }
      }
      const readMatch = sql.match(/^SELECT to_jsonb\(t\) AS row FROM (\w+) t WHERE company_id = \$1$/)
      if (readMatch) return { rows: state.tables[readMatch[1]].map(row => ({ row: structuredClone(row) })) }
      const deleteMatch = sql.match(/^DELETE FROM (\w+) WHERE company_id = \$1$/)
      if (deleteMatch) {
        const table = deleteMatch[1]
        const rowCount = state.tables[table].length
        state.tables[table] = []
        return { rows: [], rowCount }
      }
      const countMatch = sql.match(/^SELECT COUNT\(\*\)::int AS total FROM (\w+) WHERE company_id = \$1$/)
      if (countMatch) return { rows: [{ total: state.tables[countMatch[1]].length }], rowCount: 1 }
      if (sql.startsWith('UPDATE kv_store SET value')) {
        state.store = JSON.parse(params[0])
        return { rows: [], rowCount: 1 }
      }
      throw new Error(`SQL inesperado no teste: ${sql}`)
    },
    release() {}
  }
  let persistedBody = null
  const r2 = {
    isConfigured: () => true,
    async putObject(_key, body) {
      persistedBody = Buffer.from(body)
      return { sizeBytes: persistedBody.length }
    },
    async headObject() {
      return { exists: true, sizeBytes: persistedBody.length }
    },
    async getObjectBuffer() {
      return { body: Buffer.from(persistedBody), sizeBytes: persistedBody.length }
    }
  }
  const storeLib = {
    _pg: {
      pool: { connect: async () => client },
      flushNow: async () => {}
    },
    readStore: () => structuredClone(state.store),
    writeStore: next => { state.store = structuredClone(next) }
  }
  return {
    state,
    r2,
    storeLib,
    hasBackup: () => Boolean(persistedBody),
    getBackup: () => JSON.parse(persistedBody.toString('utf8'))
  }
}

test('purgeOrphanCompany confirma o backup antes de limpar KV e V2', async () => {
  const fixture = cleanupFixture({
    companies: [{ id: 'active' }],
    materials: [{ id: 'm1', company_id: 'orphan' }, { id: 'm2', company_id: 'active' }]
  }, {
    app_quotes_v2: [{ id: 'q1', company_id: 'orphan' }]
  })

  const result = await purgeOrphanCompany({
    companyId: 'orphan',
    confirmation: confirmationFor('orphan'),
    storeLib: fixture.storeLib,
    r2: fixture.r2
  })

  assert.equal(result.alreadyClean, false)
  assert.equal(result.kvCounts.materials, 1)
  assert.equal(result.pgCounts.app_quotes_v2, 1)
  assert.equal(fixture.state.committed, true)
  assert.deepEqual(fixture.state.store.materials, [{ id: 'm2', company_id: 'active' }])
  assert.equal(fixture.getBackup().kv_store.materials[0].id, 'm1')
  assert.equal(fixture.getBackup().postgres.app_quotes_v2[0].id, 'q1')
})

test('purgeOrphanCompany não cria backup nem limpa empresa ativa', async () => {
  const fixture = cleanupFixture({ companies: [{ id: 'active' }] })
  await assert.rejects(
    purgeOrphanCompany({
      companyId: 'active',
      confirmation: confirmationFor('active'),
      storeLib: fixture.storeLib,
      r2: fixture.r2
    }),
    error => error.code === 'orphan_cleanup_target_active'
  )
  assert.equal(fixture.state.committed, false)
  assert.equal(fixture.state.rolledBack, true)
  assert.equal(fixture.hasBackup(), false)
})
