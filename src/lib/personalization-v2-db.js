'use strict'

const crypto = require('crypto')
const storeLib = require('./store')

function getPool() {
  const pool = storeLib && storeLib._pg && storeLib._pg.pool
  if (!pool) {
    const err = new Error('PostgreSQL não disponível para Personalização V2.')
    err.code = 'postgres_required'
    throw err
  }
  return pool
}

async function ensureSchema() {
  const pool = getPool()
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_personalization_catalog_v2 (
      company_id TEXT PRIMARY KEY,
      revision INTEGER NOT NULL DEFAULT 0,
      items JSONB NOT NULL DEFAULT '[]'::jsonb,
      albums JSONB NOT NULL DEFAULT '[]'::jsonb,
      groups JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS app_model_personalization_v2 (
      company_id TEXT NOT NULL,
      model_id TEXT NOT NULL REFERENCES app_models_v2(id) ON DELETE CASCADE,
      revision INTEGER NOT NULL DEFAULT 0,
      metragens JSONB NOT NULL DEFAULT '[]'::jsonb,
      consumos JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (company_id, model_id)
    );

    CREATE INDEX IF NOT EXISTS idx_app_model_personalization_v2_company
      ON app_model_personalization_v2 (company_id, updated_at DESC);
  `)
}

function text(value, fallback = '') {
  if (value === undefined || value === null) return fallback
  return String(value)
}

function finiteNumber(value, fallback = 0) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function normalizeId(value, prefix = 'itm') {
  const raw = text(value).trim().slice(0, 180)
  return raw || `${prefix}_${crypto.randomUUID()}`
}

function normalizeCategory(value) {
  const raw = text(value || 'outro').trim().toLowerCase()
  return ['tecido', 'espuma', 'pe', 'outro'].includes(raw) ? raw : 'outro'
}

function sanitizeItem(item = {}) {
  const name = text(item.name || item.nome).replace(/\s+/g, ' ').trim().slice(0, 180)
  if (!name) return null
  return {
    id: normalizeId(item.id, 'itm'),
    name,
    unit: text(item.unit || item.unidade || 'unidade').replace(/\s+/g, ' ').trim().slice(0, 80) || 'unidade',
    price_cents: Math.max(0, Math.round(finiteNumber(item.price_cents ?? item.value_cents ?? item.valor_cents ?? 0))),
    category: normalizeCategory(item.category),
    isAlbum: Boolean(item.isAlbum || item.is_album),
    isGrupo: Boolean(item.isGrupo || item.is_group)
  }
}

function sanitizeAlbum(album = {}) {
  const nome = text(album.nome || album.name).replace(/\s+/g, ' ').trim().slice(0, 180)
  if (!nome) return null
  const tecidos = (Array.isArray(album.itens) ? album.itens : [])
    .slice(0, 500)
    .map(item => ({
      nome: text(item?.nome || item?.name).replace(/\s+/g, ' ').trim().slice(0, 180),
      codigo: text(item?.codigo || item?.code).replace(/\s+/g, ' ').trim().slice(0, 120),
      price_cents: Math.max(0, Math.round(finiteNumber(
        item?.price_cents ?? item?.value_cents ?? item?.valor_cents ?? 0
      )))
    }))
    .filter(item => item.nome || item.codigo)
  const priceMode = text(album.price_mode || album.priceMode || 'album').trim().toLowerCase() === 'individual'
    ? 'individual'
    : 'album'
  return {
    id: normalizeId(album.id, 'alb'),
    nome,
    custo: Math.max(0, finiteNumber(album.custo ?? album.cost ?? 0)),
    unidade: text(album.unidade || album.unit || '').replace(/\s+/g, ' ').trim().slice(0, 80),
    price_mode: priceMode,
    itens: tecidos,
    createdAt: text(album.createdAt || album.created_at || '').slice(0, 80),
    updatedAt: text(album.updatedAt || album.updated_at || '').slice(0, 80)
  }
}

function sanitizeGroup(group = {}) {
  const nome = text(group.nome || group.name).replace(/\s+/g, ' ').trim().slice(0, 180)
  if (!nome) return null
  const albuns = Array.from(new Set((Array.isArray(group.albuns) ? group.albuns : [])
    .map(id => text(id).trim().slice(0, 180))
    .filter(Boolean)))
    .slice(0, 500)
  return {
    id: normalizeId(group.id, 'grp'),
    nome,
    price_cents: Math.max(0, Math.round(finiteNumber(group.price_cents ?? group.value_cents ?? 0))),
    albuns,
    createdAt: text(group.createdAt || group.created_at || '').slice(0, 80),
    updatedAt: text(group.updatedAt || group.updated_at || '').slice(0, 80)
  }
}

function sanitizeCatalog(input = {}) {
  const items = (Array.isArray(input.items) ? input.items : [])
    .slice(0, 1000)
    .map(sanitizeItem)
    .filter(Boolean)
  const albums = (Array.isArray(input.albums) ? input.albums : [])
    .slice(0, 500)
    .map(sanitizeAlbum)
    .filter(Boolean)
  const groups = (Array.isArray(input.groups) ? input.groups : [])
    .slice(0, 500)
    .map(sanitizeGroup)
    .filter(Boolean)
  return { items, albums, groups }
}

function sanitizeMetragens(value) {
  const list = Array.isArray(value) ? value : []
  return Array.from(new Set(list
    .map(item => finiteNumber(String(item).replace(',', '.'), NaN))
    .filter(item => Number.isFinite(item) && item > 0 && item <= 100)
    .map(item => item.toFixed(item % 1 === 0 ? 1 : 2))))
    .sort((a, b) => Number(a) - Number(b))
    .slice(0, 1000)
}

function sanitizeConsumos(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const result = {}
  for (const [rawName, rawValues] of Object.entries(value)) {
    const name = text(rawName).replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 180)
    if (!name || !rawValues || typeof rawValues !== 'object' || Array.isArray(rawValues)) continue
    const row = {}
    for (const [rawMeter, rawQty] of Object.entries(rawValues)) {
      const meter = finiteNumber(String(rawMeter).replace(',', '.'), NaN)
      const qty = finiteNumber(String(rawQty).replace(',', '.'), NaN)
      if (!Number.isFinite(meter) || meter <= 0 || meter > 100) continue
      if (!Number.isFinite(qty) || qty < 0 || qty > 1000000) continue
      const meterKey = meter.toFixed(meter % 1 === 0 ? 1 : 2)
      row[meterKey] = qty
    }
    result[name] = row
    if (Object.keys(result).length >= 1000) break
  }
  return result
}

function rowToCatalog(row) {
  return {
    revision: Number(row?.revision || 0),
    items: Array.isArray(row?.items) ? row.items : [],
    albums: Array.isArray(row?.albums) ? row.albums : [],
    groups: Array.isArray(row?.groups) ? row.groups : [],
    updated_at: row?.updated_at || null
  }
}

function rowToModelConfig(row) {
  return {
    revision: Number(row?.revision || 0),
    metragens: Array.isArray(row?.metragens) ? row.metragens : [],
    consumos: row?.consumos && typeof row.consumos === 'object' && !Array.isArray(row.consumos) ? row.consumos : {},
    updated_at: row?.updated_at || null
  }
}

async function getCatalog(companyId) {
  const pool = getPool()
  const result = await pool.query(`
    SELECT company_id, revision, items, albums, groups, updated_at
    FROM app_personalization_catalog_v2
    WHERE company_id = $1
    LIMIT 1
  `, [companyId])
  return result.rows.length ? rowToCatalog(result.rows[0]) : rowToCatalog(null)
}

function conflictError(currentRevision) {
  const err = new Error('A configuração foi alterada em outro dispositivo. Recarregue antes de salvar novamente.')
  err.code = 'revision_conflict'
  err.currentRevision = Number(currentRevision || 0)
  return err
}

async function saveCatalog(companyId, input = {}, expectedRevision = null) {
  const normalized = sanitizeCatalog(input)
  const pool = getPool()
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const currentRes = await client.query(`
      SELECT revision FROM app_personalization_catalog_v2
      WHERE company_id = $1
      FOR UPDATE
    `, [companyId])
    const currentRevision = Number(currentRes.rows[0]?.revision || 0)
    if (expectedRevision !== null && Number(expectedRevision) !== currentRevision) {
      throw conflictError(currentRevision)
    }
    const nextRevision = currentRevision + 1
    await client.query(`
      INSERT INTO app_personalization_catalog_v2 (
        company_id, revision, items, albums, groups, created_at, updated_at
      ) VALUES ($1,$2,$3::jsonb,$4::jsonb,$5::jsonb,NOW(),NOW())
      ON CONFLICT (company_id) DO UPDATE SET
        revision = EXCLUDED.revision,
        items = EXCLUDED.items,
        albums = EXCLUDED.albums,
        groups = EXCLUDED.groups,
        updated_at = NOW()
    `, [
      companyId,
      nextRevision,
      JSON.stringify(normalized.items),
      JSON.stringify(normalized.albums),
      JSON.stringify(normalized.groups)
    ])
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
  return getCatalog(companyId)
}

async function getModelConfig(companyId, modelId) {
  const pool = getPool()
  const result = await pool.query(`
    SELECT company_id, model_id, revision, metragens, consumos, updated_at
    FROM app_model_personalization_v2
    WHERE company_id = $1 AND model_id = $2
    LIMIT 1
  `, [companyId, modelId])
  return result.rows.length ? rowToModelConfig(result.rows[0]) : rowToModelConfig(null)
}

async function saveModelConfig(companyId, modelId, input = {}, expectedRevision = null) {
  const normalized = {
    metragens: sanitizeMetragens(input.metragens),
    consumos: sanitizeConsumos(input.consumos)
  }
  const pool = getPool()
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const currentRes = await client.query(`
      SELECT revision FROM app_model_personalization_v2
      WHERE company_id = $1 AND model_id = $2
      FOR UPDATE
    `, [companyId, modelId])
    const currentRevision = Number(currentRes.rows[0]?.revision || 0)
    if (expectedRevision !== null && Number(expectedRevision) !== currentRevision) {
      throw conflictError(currentRevision)
    }
    const nextRevision = currentRevision + 1
    await client.query(`
      INSERT INTO app_model_personalization_v2 (
        company_id, model_id, revision, metragens, consumos, created_at, updated_at
      ) VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,NOW(),NOW())
      ON CONFLICT (company_id, model_id) DO UPDATE SET
        revision = EXCLUDED.revision,
        metragens = EXCLUDED.metragens,
        consumos = EXCLUDED.consumos,
        updated_at = NOW()
    `, [
      companyId,
      modelId,
      nextRevision,
      JSON.stringify(normalized.metragens),
      JSON.stringify(normalized.consumos)
    ])
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
  return getModelConfig(companyId, modelId)
}

function legacyPriceCents(item = {}) {
  const values = item && typeof item.values === 'object' && item.values ? item.values : {}
  return Math.max(0, Math.round(finiteNumber(
    item.price_cents ?? item.value_cents ?? values.padrao ?? values['1.00'] ?? 0
  )))
}

function legacyCatalogItem(companyId, item = {}) {
  const name = text(item.name || item.nome).replace(/\s+/g, ' ').trim().slice(0, 180)
  if (!name) return null
  const digest = crypto.createHash('sha256').update(`personalization:${companyId}:${name.toLowerCase()}`).digest('hex').slice(0, 24)
  return {
    id: `itm_${digest}`,
    name,
    unit: text(item.unit || item.unidade || 'unidade').replace(/\s+/g, ' ').trim().slice(0, 80) || 'unidade',
    price_cents: legacyPriceCents(item),
    category: normalizeCategory(item.category),
    isAlbum: Boolean(item.isAlbum || item.is_album),
    isGrupo: Boolean(item.isGrupo || item.is_group)
  }
}

async function migrateLegacyPersonalization(store = {}) {
  const legacyRows = Array.isArray(store.personalizationItems) ? store.personalizationItems : []
  if (!legacyRows.length) return { companies: 0, model_configs: 0 }

  const byCompany = new Map()
  for (const row of legacyRows) {
    const companyId = text(row?.company_id).trim()
    if (!companyId) continue
    if (!byCompany.has(companyId)) byCompany.set(companyId, [])
    byCompany.get(companyId).push(row)
  }

  const pool = getPool()
  let companiesMigrated = 0
  let modelConfigsMigrated = 0

  for (const [companyId, rows] of byCompany.entries()) {
    const currentCatalog = await getCatalog(companyId)
    if (!currentCatalog.items.length && currentCatalog.revision === 0) {
      const seen = new Map()
      for (const row of rows) {
        const normalized = legacyCatalogItem(companyId, row)
        if (!normalized) continue
        const key = normalized.name.toLowerCase()
        const existing = seen.get(key)
        if (!existing) seen.set(key, normalized)
        else if (!existing.price_cents && normalized.price_cents) seen.set(key, normalized)
      }
      if (seen.size) {
        await saveCatalog(companyId, { items: [...seen.values()], albums: [], groups: [] }, 0)
        companiesMigrated += 1
      }
    }

    const modelMapRes = await pool.query(`
      SELECT id, legacy_id FROM app_models_v2
      WHERE company_id = $1 AND legacy_id IS NOT NULL
    `, [companyId])
    const byLegacyId = new Map(modelMapRes.rows.map(row => [String(row.legacy_id), String(row.id)]))
    const groupedByModel = new Map()
    for (const row of rows) {
      const v2ModelId = byLegacyId.get(String(row?.model_id ?? ''))
      if (!v2ModelId) continue
      if (!groupedByModel.has(v2ModelId)) groupedByModel.set(v2ModelId, [])
      groupedByModel.get(v2ModelId).push(row)
    }

    for (const [modelId, modelRows] of groupedByModel.entries()) {
      const existing = await getModelConfig(companyId, modelId)
      if (existing.revision > 0) continue
      const consumos = {}
      const meters = new Set()
      for (const row of modelRows) {
        const name = text(row?.name || row?.nome).replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 180)
        if (!name) continue
        const rawConsumos = row?.consumos && typeof row.consumos === 'object' ? row.consumos : {}
        consumos[name] = {}
        for (const [meter, qty] of Object.entries(rawConsumos)) {
          const m = finiteNumber(String(meter).replace(',', '.'), NaN)
          const q = finiteNumber(String(qty).replace(',', '.'), NaN)
          if (!Number.isFinite(m) || !Number.isFinite(q) || m <= 0 || q < 0) continue
          const key = m.toFixed(m % 1 === 0 ? 1 : 2)
          consumos[name][key] = q
          meters.add(key)
        }
      }
      const metragens = [...meters].sort((a, b) => Number(a) - Number(b))
      await saveModelConfig(companyId, modelId, { metragens, consumos }, 0)
      modelConfigsMigrated += 1
    }
  }

  return { companies: companiesMigrated, model_configs: modelConfigsMigrated }
}

module.exports = {
  ensureSchema,
  sanitizeCatalog,
  sanitizeMetragens,
  sanitizeConsumos,
  getCatalog,
  saveCatalog,
  getModelConfig,
  saveModelConfig,
  migrateLegacyPersonalization
}
