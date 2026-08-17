'use strict'

const crypto = require('crypto')
const r2 = require('./r2-storage')

// PNG 1x1 transparente. Pequeno o suficiente para um smoke test sem custo relevante.
const TEST_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
)

async function runR2SmokeTest() {
  if (!r2.isConfigured()) {
    const err = new Error('R2 não configurado para smoke test.')
    err.code = 'r2_not_configured'
    throw err
  }

  const nonce = crypto.randomBytes(8).toString('hex')
  const key = `smoke-tests/${Date.now()}-${nonce}.png`
  let uploaded = false

  console.log('[r2-smoke] Iniciando teste isolado do R2...')

  try {
    const put = await r2.putObject(key, TEST_PNG, 'image/png', { purpose: 'smoke-test' })
    uploaded = true
    if (put.sizeBytes !== TEST_PNG.length) {
      throw new Error(`Tamanho inesperado após PUT: ${put.sizeBytes}`)
    }

    const head = await r2.headObject(key)
    if (!head.exists) throw new Error('Objeto não encontrado após PUT.')
    if (head.sizeBytes !== TEST_PNG.length) {
      throw new Error(`HEAD retornou tamanho inesperado: ${head.sizeBytes}`)
    }

    const signedUrl = await r2.presignGetUrl(key, 60)
    const response = await fetch(signedUrl)
    if (!response.ok) {
      throw new Error(`GET assinado falhou com HTTP ${response.status}.`)
    }

    const downloaded = Buffer.from(await response.arrayBuffer())
    if (!downloaded.equals(TEST_PNG)) {
      throw new Error('Conteúdo baixado não corresponde ao arquivo enviado.')
    }

    await r2.deleteObject(key)
    uploaded = false

    const afterDelete = await r2.headObject(key)
    if (afterDelete.exists) throw new Error('Objeto ainda existe após DELETE.')

    console.log('[r2-smoke] PASS: PUT, HEAD, URL assinada, GET e DELETE funcionando.')
    return { ok: true, bytes: TEST_PNG.length }
  } finally {
    if (uploaded) {
      await r2.deleteObject(key).catch(err => {
        console.warn('[r2-smoke] Falha ao limpar objeto temporário:', err.message)
      })
    }
  }
}

module.exports = { runR2SmokeTest }
