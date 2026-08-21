'use strict'

const express = require('express')
const cors = require('cors')
const storeLib = require('./src/lib/store')
const perfDiagnostics = require('./src/lib/perf-diagnostics')
const compactModelResponse = require('./src/middleware/compact-model-response')
const normalizeModelsV2BaseMeters = require('./src/middleware/models-v2-base-meters')
const legacyApiPermissions = require('./src/middleware/legacy-api-permissions')
const modelsV2Db = require('./src/lib/models-v2-db')
const quotesV2Db = require('./src/lib/quotes-v2-db')
const personalizationV2Db = require('./src/lib/personalization-v2-db')
const { ensurePersonalizationIsolation } = require('./src/lib/personalization-v2-hardening')
const { runPersonalizationV2SelfTest } = require('./src/lib/personalization-v2-self-test')
const { runModelsV2MigrationSelfTest } = require('./src/lib/models-v2-migration-self-test')
const { normalizeExistingBaseMeters } = require('./src/lib/models-v2-base-migration')
const { runR2SmokeTest } = require('./src/lib/r2-smoke-test')
const { migrateModels } = require('./scripts/migrate-models-v2')

perfDiagnostics.installStoreTiming(storeLib)

const authRoutes = require('./src/routes/auth')
const saasRoutes = require('./src/routes/saas')
const billingRoutes = require('./src/routes/billing')
const operationsRoutes = require('./src/routes/operations')
const materialUnitsRoutes = require('./src/routes/material-units')
const modelsV2Routes = require('./src/routes/models-v2')
const quotesV2Routes = require('./src/routes/quotes-v2')
const personalizationV2Routes = require('./src/routes/personalization-v2')

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
const jsonParser = express.json({ limit: '1mb' })
app.use((req, res, next) => {
  const isStripeWebhook = req.path === '/api/billing/webhooks/stripe'
    || req.path === '/api/subscription/webhooks/stripe'
  if (isStripeWebhook) return next()
  return jsonParser(req, res, next)
})
app.use(express.urlencoded({ extended: false, limit: '1mb' }))
app.use(perfDiagnostics.middleware)
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
    version: '20260819-models-v2-cleanup-dev2',
    storage: process.env.DATABASE_URL ? 'postgresql' : 'file',
    store_file: storeLib.STORE_FILE,
    models_v2: process.env.DATABASE_URL ? 'available' : 'postgres_required',
    quotes_v2: process.env.DATABASE_URL ? 'available' : 'postgres_required',
    personalization_v2: process.env.DATABASE_URL ? 'available' : 'postgres_required'
  })
})

app.use('/api/auth', authRoutes)
app.use('/api/saas', saasRoutes)
app.use('/api/billing', billingRoutes)
app.use('/api', legacyApiPermissions)
app.use('/api', materialUnitsRoutes)
app.use('/api/v2/models', normalizeModelsV2BaseMeters)
app.use('/api/v2', modelsV2Routes)
app.use('/api/v2', quotesV2Routes)
app.use('/api/v2', personalizationV2Routes)
app.use('/api', operationsRoutes)
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

async function runControlledModelsMigration() {
  const mode = String(process.env.MODELS_V2_MIGRATION_ON_START || '').trim().toLowerCase()
  if (!mode) return null
  if (!['dry-run', 'apply'].includes(mode)) {
    throw new Error('MODELS_V2_MIGRATION_ON_START deve ser dry-run ou apply.')
  }
  const companyId = String(process.env.MODELS_V2_MIGRATION_COMPANY_ID || '').trim()
  console.log(`[models-v2] Migração controlada no startup: ${mode}${companyId ? ` | empresa ${companyId}` : ''}`)
  return migrateModels({
    apply: mode === 'apply',
    forceImages: false,
    companyId,
    skipInit: true
  })
}

async function start() {
  if (process.env.DATABASE_URL) {
    console.log('[server] DATABASE_URL detectada — usando PostgreSQL')
    const pg = storeLib._pg
    await pg.init()
    await pg.bootstrapStore()
    await modelsV2Db.ensureSchema()
    await normalizeExistingBaseMeters()

    if (String(process.env.MODELS_V2_MIGRATION_SELF_TEST_ON_START || '') === '1') {
      await runModelsV2MigrationSelfTest()
    }

    await runControlledModelsMigration()

    await quotesV2Db.ensureSchema()
    await quotesV2Db.migrateLegacyQuotes(storeLib.readStore())
    await personalizationV2Db.ensureSchema()
    await ensurePersonalizationIsolation()
    const personalizationMigration = await personalizationV2Db.migrateLegacyPersonalization(storeLib.readStore())
    console.log('[server] Models V2, Quotes V2 e Personalização V2 prontos (APIs paralelas)')
    if (personalizationMigration.companies || personalizationMigration.model_configs) {
      console.log(`[personalization-v2] Migração inicial: ${personalizationMigration.companies} catálogo(s), ${personalizationMigration.model_configs} configuração(ões) de modelo.`)
    }

    if (String(process.env.PERSONALIZATION_V2_SELF_TEST_ON_START || '') === '1') {
      await runPersonalizationV2SelfTest()
    }
    if (String(process.env.R2_SMOKE_TEST_ON_START || '') === '1') {
      await runR2SmokeTest()
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