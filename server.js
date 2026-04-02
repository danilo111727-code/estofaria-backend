const express = require('express')
const cors = require('cors')
const { ensureStore, bootstrapStore, STORE_FILE } = require('./src/lib/store')
const authRoutes = require('./src/routes/auth')
const saasRoutes = require('./src/routes/saas')
const billingRoutes = require('./src/routes/billing')
const operationsRoutes = require('./src/routes/operations')

ensureStore()
bootstrapStore()

function parseAllowedOrigins(){
  return String(process.env.CORS_ALLOWED_ORIGINS || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)
}

const allowedOrigins = parseAllowedOrigins()
const corsOptions = {
  origin(origin, callback){
    if(!origin) return callback(null, true)
    if(!allowedOrigins.length) return callback(null, true)
    if(allowedOrigins.includes(origin)) return callback(null, true)
    return callback(new Error('origin_not_allowed'))
  },
  credentials: true,
  methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Accept','Authorization']
}

const app = express()
app.set('trust proxy', 1)
app.disable('x-powered-by')
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'SAMEORIGIN')
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
  if(req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store')
  next()
})
app.use(cors(corsOptions))
app.options('*', cors(corsOptions))
app.use(express.json({ limit:'1mb' }))
app.use(express.urlencoded({ extended:false, limit:'1mb' }))

app.get('/', (_req, res) => {
  res.json({ ok:true, service:'estofaria-saas-backend-starter', health:'/api/health' })
})

app.get('/api/health', (_req, res) => {
  res.json({ ok:true, service:'estofaria-saas-backend-starter', store_file: STORE_FILE })
})

app.use('/api/auth', authRoutes)

// Rotas principais
app.use('/api/saas', saasRoutes)
app.use('/api/billing', billingRoutes)
app.use('/api', operationsRoutes)

// Aliases para compatibilidade com frontends já publicados
app.use('/api/master', saasRoutes)
app.use('/api/admin', saasRoutes)
app.use('/api/subscription/admin', saasRoutes)
app.use('/api/subscription', billingRoutes)

app.use((err, _req, res, _next) => {
  if(err && err.type === 'entity.parse.failed'){
    return res.status(400).json({ error:'invalid_json', message:'JSON inválido na requisição.' })
  }
  if(err && err.message === 'origin_not_allowed'){
    return res.status(403).json({ error:'forbidden_origin', message:'Origem não permitida por CORS.' })
  }
  console.error(err)
  res.status(500).json({ error:'internal_error', message:'Erro interno do servidor.' })
})

const port = Number(process.env.PORT || 8787)
app.listen(port, () => {
  console.log(`Estofaria SaaS backend starter rodando na porta ${port}`)
})
