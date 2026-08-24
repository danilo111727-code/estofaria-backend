'use strict'

const express = require('express')
const cors = require('cors')
const storeLib = require('./src/lib/store')
const atomicStore = require('./src/lib/atomic-store')
const perfDiagnostics = require('./src/lib/perf-diagnostics')
const compactModelResponse = require('./src/middleware/compact-model-response')
const normalizeModelsV2BaseMeters = require('./src/middleware/models-v2-base-meters')
const legacyApiPermissions = require('./src/middleware/legacy-api-permissions')
const teamManagementPermissions = require('./src/middleware/team-management-permissions')
const modelsV2Db = require('./src/lib/models-v2-db')
const quotesV2Db = require('./src/lib/quotes-v2-db')
const personalizationV2Db = require('./src/lib/personalization-v2-db')
const agendaV2Db = require('./src/lib/agenda-v2-db')
const financialV2Db = require('./src/lib/financial-v2-db')
const auditV2Db = require('./src/lib/audit-v2-db')
const auditV2Bridge = require('./src/lib/audit-v2-bridge')
const { ensurePersonalizationIsolation } = require('./src/lib/personalization-v2-hardening')
const { runPersonalizationV2SelfTest } = require('./src/lib/personalization-v2-self-test')
const { normalizeExistingBaseMeters } = require('./src/lib/models-v2-base-migration')
const { runR2SmokeTest } = require('./src/lib/r2-smoke-test')
const { migrateModels } = require('./scripts/migrate-models-v2')

atomicStore.install(storeLib)
auditV2Bridge.install(storeLib,auditV2Db)
perfDiagnostics.installStoreTiming(storeLib)

const authRoutes = require('./src/routes/auth')
const companyDeletionRoutes = require('./src/routes/company-deletion')
const saasRoutes = require('./src/routes/saas')
const auditV2Routes = require('./src/routes/audit-v2')
const billingRoutes = require('./src/routes/billing')
const operationsRoutes = require('./src/routes/operations')
const materialUnitsRoutes = require('./src/routes/material-units')
const modelsV2Routes = require('./src/routes/models-v2')
const quotesV2Routes = require('./src/routes/quotes-v2')
const personalizationV2Routes = require('./src/routes/personalization-v2')
const agendaV2Routes = require('./src/routes/agenda-v2')
const financialV2Routes = require('./src/routes/financial-v2')
const dashboardV2Routes = require('./src/routes/dashboard-v2')

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
  if (isStripeWebhook) {
    const stripeConfigured = String(process.env.STRIPE_SECRET_KEY || '').trim()
    const webhookConfigured = String(process.env.STRIPE_WEBHOOK_SECRET || '').trim()
    if (!stripeConfigured || !webhookConfigured) {
      return res.status(503).json({
        error: 'stripe_webhook_not_configured',
        message: 'Webhook Stripe não configurado no servidor.'
      })
    }
    return next()
  }
  return jsonParser(req, res, next)
})
app.use(express.urlencoded({ extended: false, limit: '1mb' }))
app.use(perfDiagnostics.middleware)
app.use(compactModelResponse)
app.use(atomicStore.middleware)

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
    version: '20260824-dashboard-v2-prod1',
    storage: process.env.DATABASE_URL ? 'postgresql' : 'file',
    store_file: storeLib.STORE_FILE,
    models_v2: process.env.DATABASE_URL ? 'available' : 'postgres_required',
    quotes_v2: process.env.DATABASE_URL ? 'available' : 'postgres_required',
    personalization_v2: process.env.DATABASE_URL ? 'available' : 'postgres_required',
    agenda_v2: process.env.DATABASE_URL ? 'available' : 'postgres_required',
    financial_v2: process.env.DATABASE_URL ? 'available' : 'postgres_required',
    audit_v2: process.env.DATABASE_URL ? 'available' : 'postgres_required',
    dashboard_v2: process.env.DATABASE_URL ? 'available' : 'postgres_required'
  })
})

app.use('/api/auth/team', teamManagementPermissions)
app.use('/api', companyDeletionRoutes)
app.use('/api/auth', authRoutes)
app.use('/api/saas', auditV2Routes)
app.use('/api/saas', saasRoutes)
app.use('/api/billing', billingRoutes)
app.use('/api', legacyApiPermissions)
app.use('/api', dashboardV2Routes)
app.use('/api', agendaV2Routes)
app.use('/api', financialV2Routes)
app.use('/api', materialUnitsRoutes)
app.use('/api/v2/models', normalizeModelsV2BaseMeters)
app.use('/api/v2', modelsV2Routes)
app.use('/api/v2', quotesV2Routes)
app.use('/api/v2', personalizationV2Routes)
app.use('/api', operationsRoutes)
app.use('/api/master', auditV2Routes)
app.use('/api/master', saasRoutes)
app.use('/api/admin', auditV2Routes)
app.use('/api/admin', saasRoutes)
app.use('/api/subscription/admin', auditV2Routes)
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
    await runControlledModelsMigration()
    await quotesV2Db.ensureSchema()
    await quotesV2Db.migrateLegacyQuotes(storeLib.readStore())
    await personalizationV2Db.ensureSchema()
    await ensurePersonalizationIsolation()
    const personalizationMigration = await personalizationV2Db.migrateLegacyPersonalization(storeLib.readStore())

    await agendaV2Db.ensureSchema()
    const agendaMigration = await agendaV2Db.migrateLegacyAgenda(storeLib.readStore())

    await financialV2Db.ensureSchema()
    const financialMigration = await financialV2Db.migrateLegacyFinancial(storeLib.readStore())

    await auditV2Db.ensureSchema()
    const auditMigration = await auditV2Db.migrateLegacyAudit(storeLib.readStore())
    const legacyAuditStore = storeLib.readStore()
    const legacyAuditCount = Array.isArray(legacyAuditStore.auditLogs) ? legacyAuditStore.auditLogs.length : 0
    if(legacyAuditCount){
      legacyAuditStore.auditLogs = []
      storeLib.writeStore(legacyAuditStore)
      await pg.flushNow()
    }
    auditV2Db.enableWrites()

    console.log('[server] Models V2, Quotes V2, Personalização V2, Agenda V2, Financeiro V2, Auditoria V2 e Dashboard V2 prontos')
    if (personalizationMigration.companies || personalizationMigration.model_configs) {
      console.log(`[personalization-v2] Migração inicial: ${personalizationMigration.companies} catálogo(s), ${personalizationMigration.model_configs} configuração(ões) de modelo.`)
    }
    if (!agendaMigration.skipped) {
      console.log(`[agenda-v2] Migração inicial: ${agendaMigration.configs || 0} config(s), ${agendaMigration.blocos || 0} bloco(s), ${agendaMigration.orders || 0} pedido(s).`)
    } else {
      console.log('[agenda-v2] Migração legada já concluída anteriormente.')
    }
    if (!financialMigration.skipped) {
      console.log(`[financial-v2] Migração inicial: ${financialMigration.entries || 0} lançamento(s).`)
    } else {
      console.log('[financial-v2] Migração legada já concluída anteriormente.')
    }
    if (!auditMigration.skipped) {
      console.log(`[audit-v2] Migração inicial: ${auditMigration.entries || 0} registro(s); ${auditMigration.inserted || 0} inserido(s).`)
    } else {
      console.log(`[audit-v2] Migração legada já concluída; ${auditMigration.synced || 0} registro(s) pendente(s) sincronizado(s).`)
    }
    if(legacyAuditCount){
      console.log(`[audit-v2] auditLogs legado removido do kv_store após cópia confirmada: ${legacyAuditCount} registro(s).`)
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
