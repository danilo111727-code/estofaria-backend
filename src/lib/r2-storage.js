'use strict'

const crypto = require('crypto')
const {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand
} = require('@aws-sdk/client-s3')
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner')

const REGION = 'auto'
let cachedClient = null
let cachedClientKey = ''

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

function getClient() {
  const cfg = assertConfigured()
  const cacheKey = [cfg.endpoint, cfg.accessKeyId, cfg.secretAccessKey].join('|')
  if (!cachedClient || cachedClientKey !== cacheKey) {
    cachedClient = new S3Client({
      region: REGION,
      endpoint: cfg.endpoint,
      credentials: {
        accessKeyId: cfg.accessKeyId,
        secretAccessKey: cfg.secretAccessKey
      }
    })
    cachedClientKey = cacheKey
  }
  return { client: cachedClient, cfg }
}

function sha256Hex(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function normalizeMetadata(metadata = {}) {
  const result = {}
  for (const [name, value] of Object.entries(metadata || {})) {
    if (value === undefined || value === null || value === '') continue
    result[String(name)] = String(value)
  }
  return result
}

function etagValue(value) {
  return String(value || '').replace(/^"|"$/g, '')
}

function isNotFoundError(err) {
  return Boolean(
    err && (
      err.name === 'NotFound' ||
      err.name === 'NoSuchKey' ||
      err.$metadata?.httpStatusCode === 404
    )
  )
}

async function putObject(key, body, contentType, metadata = {}) {
  const { client, cfg } = getClient()
  const payload = Buffer.isBuffer(body) ? body : Buffer.from(body || '')
  const response = await client.send(new PutObjectCommand({
    Bucket: cfg.bucket,
    Key: String(key),
    Body: payload,
    ContentType: contentType || undefined,
    Metadata: normalizeMetadata(metadata)
  }))

  return {
    etag: etagValue(response.ETag),
    sizeBytes: payload.length
  }
}

async function headObject(key) {
  const { client, cfg } = getClient()
  try {
    const response = await client.send(new HeadObjectCommand({
      Bucket: cfg.bucket,
      Key: String(key)
    }))
    return {
      exists: true,
      etag: etagValue(response.ETag),
      contentType: String(response.ContentType || ''),
      sizeBytes: Number(response.ContentLength || 0)
    }
  } catch (err) {
    if (isNotFoundError(err)) return { exists: false }
    throw err
  }
}

async function getObjectBuffer(key) {
  const { client, cfg } = getClient()
  const response = await client.send(new GetObjectCommand({
    Bucket: cfg.bucket,
    Key: String(key)
  }))
  const bytes = await response.Body.transformToByteArray()
  return {
    body: Buffer.from(bytes),
    contentType: String(response.ContentType || 'application/octet-stream'),
    sizeBytes: Number(response.ContentLength || bytes.length || 0),
    etag: etagValue(response.ETag)
  }
}

async function deleteObject(key) {
  const { client, cfg } = getClient()
  await client.send(new DeleteObjectCommand({
    Bucket: cfg.bucket,
    Key: String(key)
  }))
  return { ok: true }
}

function normalizeExpiresSeconds(expiresSeconds) {
  return Math.min(3600, Math.max(30, Number(expiresSeconds || 300)))
}

async function presignGetUrl(key, expiresSeconds = 300) {
  const { client, cfg } = getClient()
  return getSignedUrl(
    client,
    new GetObjectCommand({
      Bucket: cfg.bucket,
      Key: String(key)
    }),
    { expiresIn: normalizeExpiresSeconds(expiresSeconds) }
  )
}

async function presignPutUrl(key, contentType, expiresSeconds = 300) {
  const { client, cfg } = getClient()
  const normalizedContentType = String(contentType || '').trim()
  const command = new PutObjectCommand({
    Bucket: cfg.bucket,
    Key: String(key),
    ContentType: normalizedContentType || undefined
  })

  const options = {
    expiresIn: normalizeExpiresSeconds(expiresSeconds)
  }
  if (normalizedContentType) {
    options.signableHeaders = new Set(['content-type'])
  }

  return getSignedUrl(client, command, options)
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

function buildQuoteImageKey({ companyId, imageId, contentType = 'image/jpeg' }) {
  const ext = extensionForContentType(contentType) || 'bin'
  return `companies/${String(companyId)}/quotes/free-models/${String(imageId)}.${ext}`
}

function quoteImagePrefix(companyId) {
  return `companies/${String(companyId)}/quotes/free-models/`
}

module.exports = {
  getConfig,
  isConfigured,
  assertConfigured,
  putObject,
  headObject,
  getObjectBuffer,
  deleteObject,
  presignGetUrl,
  presignPutUrl,
  buildModelImageKey,
  buildQuoteImageKey,
  quoteImagePrefix,
  extensionForContentType,
  sha256Hex
}
