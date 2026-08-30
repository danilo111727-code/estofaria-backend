'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('crypto')
const {
  confirmationFor,
  parseInlineImage,
  archiveAndRemoveInlineImage
} = require('../src/lib/inline-image-cleanup')

const INLINE = `data:image/png;base64,${Buffer.from('legacy-image').toString('base64')}`

function fixture() {
  const state = {
    store: {
      companies: [{ id: 'company-1' }],
      models: [
        { id: 4, company_id: 'company-1', name: 'Modelo', image_data_url: INLINE },
        { id: 5, company_id: 'company-1', name: 'Outro', image_data_url: 'https://example.test/image.jpg' }
      ]
    },
    committed: false,
    rolledBack: false,
    objects: new Map([['current/original.jpg', Buffer.from('current-image')]])
  }
  const client = {
    async query(sql, params = []) {
      if (sql.startsWith('BEGIN')) return { rows: [] }
      if (sql === 'COMMIT') { state.committed = true; return { rows: [] } }
      if (sql === 'ROLLBACK') { state.rolledBack = true; return { rows: [] } }
      if (sql.includes("SELECT value FROM kv_store WHERE key = 'main'")) {
        return { rows: [{ value: structuredClone(state.store) }] }
      }
      if (sql.includes('SELECT id FROM app_models_v2')) return { rows: [{ id: 'mdl-v2' }] }
      if (sql.includes('SELECT object_key FROM app_model_images_v2')) {
        return { rows: [{ object_key: 'current/original.jpg' }] }
      }
      if (sql.startsWith('UPDATE kv_store SET value')) {
        state.store = JSON.parse(params[0])
        return { rows: [], rowCount: 1 }
      }
      throw new Error(`SQL inesperado: ${sql}`)
    },
    release() {}
  }
  const r2 = {
    isConfigured: () => true,
    async putObject(key, body) { state.objects.set(key, Buffer.from(body)); return { sizeBytes: body.length } },
    async headObject(key) {
      const body = state.objects.get(key)
      return body ? { exists: true, sizeBytes: body.length } : { exists: false }
    },
    async getObjectBuffer(key) {
      const body = state.objects.get(key)
      if (!body) throw new Error('not_found')
      return { body: Buffer.from(body), sizeBytes: body.length }
    }
  }
  const storeLib = {
    _pg: { pool: { connect: async () => client }, flushNow: async () => {} },
    readStore: () => structuredClone(state.store),
    writeStore: next => { state.store = structuredClone(next) }
  }
  return { state, r2, storeLib }
}

test('parseInlineImage aceita somente data URL de imagem suportada', () => {
  assert.equal(parseInlineImage(INLINE).body.toString(), 'legacy-image')
  assert.equal(parseInlineImage('data:text/plain;base64,WA=='), null)
})

test('confirmação fica vinculada à empresa e ao modelo', () => {
  assert.equal(confirmationFor('company-1', '4'), 'ARCHIVE-INLINE-IMAGE:company-1:4')
})

test('arquiva e verifica a imagem antiga sem alterar o objeto atual', async () => {
  const f = fixture()
  const currentHash = crypto.createHash('sha256').update('current-image').digest('hex')
  const result = await archiveAndRemoveInlineImage({
    companyId: 'company-1',
    legacyModelId: '4',
    confirmation: confirmationFor('company-1', '4'),
    storeLib: f.storeLib,
    r2: f.r2
  })

  assert.equal(result.alreadyClean, false)
  assert.equal(result.currentR2Preserved.sha256, currentHash)
  assert.equal(f.state.objects.get('current/original.jpg').toString(), 'current-image')
  assert.equal(f.state.store.models[0].image_data_url, undefined)
  assert.equal(f.state.store.models[1].image_data_url, 'https://example.test/image.jpg')
  assert.equal(f.state.committed, true)
})

test('confirmação inválida não inicia alteração', async () => {
  const f = fixture()
  await assert.rejects(
    archiveAndRemoveInlineImage({
      companyId: 'company-1', legacyModelId: '4', confirmation: 'errada',
      storeLib: f.storeLib, r2: f.r2
    }),
    error => error.code === 'inline_image_confirmation_invalid'
  )
  assert.equal(f.state.committed, false)
})
