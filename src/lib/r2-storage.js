'use strict'

const crypto = require('crypto')
const https = require('https')

const REGION = 'auto'
const SERVICE = 's3'

function env(name) {
  return String(process.env[name] || '').trim()
}

function getConfig() {
  const accountId = env('R2_ACCOUNT_ID')
  const accessKeyId = env('R2_ACCESS_KEY_ID')
  const secretAccessKey = env('R2_SECRET_ACCESS_KEY')
  const bucket = env('R2_BUCKET')
  const endpoint = env('R2_ENDPOINT') || (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : '')

  return { accountId, accessKeyId, secretAccessKey, bucket, endpoint }
}

function isConfigured() {
  const cfg = getConfig()
  return Boolean(cfg.endpoint && cfg.accessKeyId && cfg.secretAccessKey && cfg.bucket)
}

function assertConfigured() {
  const cfg = getConfig()
  const missing = []
  if (!cfg.endpoint) missing.push('R2_ACCOUNT_ID ou R2_ENDPOINT')
  if (!cfg.accessKeyId) missing.push('R2_ACCESS_KEY_ID')
  if (!cfg.secretAccessKey) missing.push('R2_SECRET_ACCESS_KEY')
  if (!cfg.bucket) missing.push('R2_BUCKET')
  if (missing.length) {
    const err = new Error(`R2 não configurado: ${missing.join(', ')}`)
    err.code = 'r2_not_configured'
    throw err
  }
  return cfg
}

function sha256Hex(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function hmac(key, value, encoding) {
  return crypto.createHmac('sha256', key).update(value).digest(encoding)
}

function amzDate(date = new Date()) {
  const iso = date.toISOString().replace(/[:-]|\.\d{3}/g, '')
  return { dateTime: iso, dateStamp: iso.slice(0, 8) }
}

function encodeRfc3986(value) {
  return encodeURIComponent(String(value)).replace(/[!'()*]/g, ch => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`)
}

function canonicalObjectPath(bucket, key) {
  const normalizedKey = String(key || '')
    .split('/')
    .filter(Boolean)
    .map(encodeRfc3986)
    .join('/')
  return `/${encodeRfc3986(bucket)}/${normalizedKey}`
}

function signingKey(secret, dateStamp) {
  const kDate = hmac(`AWS4${secret}`, dateStamp)
  const kRegion = hmac(kDate, REGION)
  const kService = hmac(kRegion, SERVICE)
  return hmac(kService, 'aws4_request')
}

function authorizationHeader({ accessKeyId, secretAccessKey, method, host, path, payloadHash, contentType, now }) {
  const { dateTime, dateStamp } = amzDate(now)
  const headers = {
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': dateTime
  }
  if (contentType) headers['content-type'] = contentType

  const sortedNames = Object.keys(headers).sort()
  const canonicalHeaders = sortedNames.map(name => `${name}:${String(headers[name]).trim()}\n`).join('')
  const signedHeaders = sortedNames.join(';')
  const canonicalRequest = [
    method.toUpperCase(),
    path,
    '',
    canonicalHeaders,
    signedHeaders,
    payloadHash
  ].join('\n')

  const scope = `${dateStamp}/${REGION}/${SERVICE}/aws4_request`
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    dateTime,
    scope,
    sha256Hex(canonicalRequest)
  ].join('\n')

  const signature = hmac(signingKey(secretAccessKey, dateStamp), stringToSign, 'hex')
  return {
    authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    dateTime,
    headers
  }
}

function request({ method, key, body = Buffer.alloc(0), contentType = '', extraHeaders = {} }) {
  const cfg = assertConfigured()
  const endpoint = new URL(cfg.endpoint)
  const path = canonicalObjectPath(cfg.bucket, key)
  const payload = Buffer.isBuffer(body) ? body : Buffer.from(body || '')
  const payloadHash = sha256Hex(payload)
  const signed = authorizationHeader({
    accessKeyId: cfg.accessKeyId,
    secretAccessKey: cfg.secretAccessKey,
    method,
    host: endpoint.host,
    path,
    payloadHash,
    contentType,
    now: new Date()
  })

  const headers = {
    ...signed.headers,
    Authorization: signed.authorization,
    ...extraHeaders
  }
  if (payload.length) headers['Content-Length'] = String(payload.length)

  return new Promise((resolve, reject) => {
    const req = https.request({
      protocol: endpoint.protocol,
      hostname: endpoint.hostname,
      port: endpoint.port || 443,
      method,
      path,
      headers
    }, res => {
      const chunks = []
      res.on('data', chunk => chunks.push(chunk))
      res.on('end', () => {
        const responseBody = Buffer.concat(chunks)
        const status = Number(res.statusCode || 0)
        if (status >= 200 && status < 300) {
          resolve({ status, headers: res.headers, body: responseBody })
          return
        }
        const err = new Error(`R2 ${method} falhou com HTTP ${status}: ${responseBody.toString('utf8').slice(0, 500)}`)
        err.code = 'r2_request_failed'
        err.status = status
        reject(err)
      })
    })

    req.on('error', reject)
    if (payload.length) req.write(payload)
    req.end()
  })
}

async function putObject(key, body, contentType, metadata = {}) {
  const extraHeaders = {}
  for (const [name, value] of Object.entries(metadata || {})) {
    if (value === undefined || value === null || value === '') continue
    extraHeaders[`x-amz-meta-${String(name).toLowerCase()}`] = String(value)
  }
  const response = await request({ method: 'PUT', key, body, contentType, extraHeaders })
  return {
    etag: String(response.headers.etag || '').replace(/^"|"$/g, ''),
    sizeBytes: Buffer.isBuffer(body) ? body.length : Buffer.byteLength(body || '')
  }
}

async function headObject(key) {
  try {
    const response = await request({ method: 'HEAD', key })
    return {
      exists: true,
      etag: String(response.headers.etag || '').replace(/^"|"$/g, ''),
      contentType: String(response.headers['content-type'] || ''),
      sizeBytes: Number(response.headers['content-length'] || 0)
    }
  } catch (err) {
    if (err && err.status === 404) return { exists: false }
    throw err
  }
}

async function deleteObject(key) {
  await request({ method: 'DELETE', key })
  return { ok: true }
}

function presignGetUrl(key, expiresSeconds = 300) {
  const cfg = assertConfigured()
  const endpoint = new URL(cfg.endpoint)
  const path = canonicalObjectPath(cfg.bucket, key)
  const now = new Date()
  const { dateTime, dateStamp } = amzDate(now)
  const scope = `${dateStamp}/${REGION}/${SERVICE}/aws4_request`
  const expires = Math.min(3600, Math.max(30, Number(expiresSeconds || 300)))

  const params = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${cfg.accessKeyId}/${scope}`,
    'X-Amz-Date': dateTime,
    'X-Amz-Expires': String(expires),
    'X-Amz-SignedHeaders': 'host'
  }

  const canonicalQuery = Object.keys(params)
    .sort()
    .map(name => `${encodeRfc3986(name)}=${encodeRfc3986(params[name])}`)
    .join('&')

  const canonicalHeaders = `host:${endpoint.host}\n`
  const canonicalRequest = [
    'GET',
    path,
    canonicalQuery,
    canonicalHeaders,
    'host',
    'UNSIGNED-PAYLOAD'
  ].join('\n')

  const stringToSign = [
    'AWS4-HMAC-SHA256',
    dateTime,
    scope,
    sha256Hex(canonicalRequest)
  ].join('\n')
  const signature = hmac(signingKey(cfg.secretAccessKey, dateStamp), stringToSign, 'hex')
  return `${endpoint.origin}${path}?${canonicalQuery}&X-Amz-Signature=${signature}`
}

function extensionForContentType(contentType) {
  const normalized = String(contentType || '').toLowerCase().split(';')[0].trim()
  if (normalized === 'image/jpeg' || normalized === 'image/jpg') return 'jpg'
  if (normalized === 'image/png') return 'png'
  if (normalized === 'image/webp') return 'webp'
  return ''
}

function buildModelImageKey({ companyId, modelId, variant = 'original', contentType = 'image/jpeg' }) {
  const ext = extensionForContentType(contentType) || 'bin'
  const safeVariant = variant === 'thumb' ? 'thumb' : 'original'
  return `companies/${String(companyId)}/models/${String(modelId)}/${safeVariant}.${ext}`
}

module.exports = {
  getConfig,
  isConfigured,
  assertConfigured,
  putObject,
  headObject,
  deleteObject,
  presignGetUrl,
  buildModelImageKey,
  extensionForContentType,
  sha256Hex
}
