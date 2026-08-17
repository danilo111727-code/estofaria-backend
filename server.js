'use strict'

const express = require('express')
const cors = require('cors')
const storeLib = require('./src/lib/store')
const perfDiagnostics = require('./src/lib/perf-diagnostics')
const compactModelResponse = require('./src/middleware/compact-model-response')
const modelsV2Db = require('./src/lib/models-v2-db')
const { runR2SmokeTest } = require('./src/lib/r2-smoke-test')
const { runModelsV2SelfTest } = require('./src/lib/models-v2-self-test')

// Instala a medição antes de carregar as rotas, para que imports destruturados
// de readStore/writeStore já recebam as versões instrumentadas.
perfDiagnostics.installStoreTiming(storeLib)

const authRoutes = require('./src/routes/auth')
const saasRoutes = require('./src/routes/saas')
const billingRoutes = require('./src/routes/billing')
const operationsRoutes = require('./src/routes/operations')
const materialUnitsRoutes = require('./src/routes/material-units')
const modelsV2Routes = require('./src/routes/models-v2')

function parseAllowedOrigins() {
  return String(process.env.CORS_ALLOWED_ORIGINS || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)
}

const allowedOrigins = parseAllowedOrigins()
const corsOptions = {
  origin(origin, callback) {
    if (!origin) return callback(null, true)
    if (!allowedOrigins.length) return callback(null, true)
    if (allowedOrigins.includes(origin)) return callback(null, true)
    return callback(new Error('origin_not_allowed'))
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Accept', 'Authorization']
}

const app = express()
app.set('trust proxy', 1)
app.disable('x-powered-by')

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'SAMEORIGIN')
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
  if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store')
  next()
})

app.use(cors(corsOptions))
app.options('*', cors(corsOptions))
app.use(express.json({ limit: '1mb' }))
app.use(express.urlencoded({ extended: false, limit: '1mb' }))

// Diagnóstico temporário: só mede POST /api/quotes e não altera a resposta.
app.use(perfDiagnostics.middleware)

// Modelos legados são armazenados com uma única imagem; a API antiga também
// devolve apenas image_data_url para reduzir base64 durante a transição.
app.use(compactModelResponse)

app.get('/', (_req, res) => {
  res.json({
    ok: true,
    service: 'estofaria-saas-backend-starter',
    storage: process.env.DATABASE_URL ? 'postgresql' : 'file',
    health: '/api/health'
  })
})

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'estofaria-saas-backend-starter',
    version: '20260816-models-v2a',
    storage: process.env.DATABASE_URL ? 'postgresql' : 'file',
    store_file: storeLib.STORE_FILE,
    models_v2: process.env.DATABASE_URL ? 'available' : 'postgres_required'
  })
})

app.use('/api/auth', authRoutes)

// Rotas principais
app.use('/api/saas', saasRoutes)
app.use('/api/billing', billingRoutes)
app.use('/api', materialUnitsRoutes)

// API V2 paralela. Não substitui nem altera /api/models nesta fase.
app.use('/api/v2', modelsV2Routes)

app.use('/api', operationsRoutes)

// Aliases para compatibilidade com frontends já publicados
app.use('/api/master', saasRoutes)
app.use('/api/admin', saasRoutes)
app.use('/api/subscription/admin', saasRoutes)
app.use('/api/subscription', billingRoutes)

app.use((err, _req, res, _next) => {
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'invalid_json', message: 'JSON inválido na requisição.' })
  }
  if (err && err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'payload_too_large', message: 'Arquivo ou conteúdo acima do limite permitido.' })
  }
  if (err && err.message === 'origin_not_allowed') {
    return res.status(403).json({ error: 'forbidden_origin', message: 'Origem não permitida por CORS.' })
  }
  console.error(err)
  res.status(500).json({ error: 'internal_error', message: 'Erro interno do servidor.' })
})

async function start() {
  if (process.env.DATABASE_URL) {
    console.log('[server] DATABASE_URL detectada — usando PostgreSQL')
    const pg = storeLib._pg
    await pg.init()
    await pg.bootstrapStore()
    await modelsV2Db.ensureSchema()
    console.log('[server] Models V2 schema pronto (API paralela)')

    if (String(process.env.R2_SMOKE_TEST_ON_START || '') === '1') {
      await runR2SmokeTest()
      await runModelsV2SelfTest()
    }

    process.on('SIGTERM', async () => {
      console.log('[server] SIGTERM — salvando dados pendentes...')
      await pg.flushNow().catch(console.error)
      process.exit(0)
    })
    process.on('SIGINT', async () => {
      console.log('[server] SIGINT — salvando dados pendentes...')
      await pg.flushNow().catch(console.error)
      process.exit(0)
    })
  } else {
    console.log('[server] DATABASE_URL não configurada — usando store.json')
    storeLib.ensureStore()
    storeLib.bootstrapStore()
  }

  const port = Number(process.env.PORT || 8787)
  app.listen(port, () => {
    console.log(`Estofaria SaaS backend rodando na porta ${port} (storage: ${process.env.DATABASE_URL ? 'postgresql' : 'file'})`)
  })
}

start().catch(err => {
  console.error('[server] Erro fatal na inicialização:', err)
  process.exit(1)
})
