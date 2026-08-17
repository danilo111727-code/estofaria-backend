'use strict'

const crypto = require('crypto')
const storeLib = require('./store')

function getPool() {
  const pool = storeLib && storeLib._pg && storeLib._pg.pool
  if (!pool) {
    const err = new Error('PostgreSQL não disponível para Models V2.')
    err.code = 'postgres_required'
    throw err
  }
  return pool
}

async function ensureSchema() {
  const pool = getPool()
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_models_v2 (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL,
      legacy_id TEXT,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      base_meters NUMERIC(10,2) NOT NULL DEFAULT 0,
      spacing_cm INTEGER NOT NULL DEFAULT 10,
      total_cost_cents BIGINT NOT NULL DEFAULT 0,
      target_profit_cents BIGINT NOT NULL DEFAULT 0,
      sale_price_cents BIGINT NOT NULL DEFAULT 0,
      value_per_spacing_cents BIGINT NOT NULL DEFAULT 0,
      included_items JSONB NOT NULL DEFAULT '[]'::jsonb,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    ALTER TABLE app_models_v2
      ADD COLUMN IF NOT EXISTS included_items JSONB NOT NULL DEFAULT '[]'::jsonb;

    CREATE INDEX IF NOT EXISTS idx_app_models_v2_company_active
      ON app_models_v2 (company_id, active, updated_at DESC);

    CREATE UNIQUE INDEX IF NOT EXISTS ux_app_models_v2_company_legacy
      ON app_models_v2 (company_id, legacy_id)
      WHERE legacy_id IS NOT NULL;

    CREATE TABLE IF NOT EXISTS app_model_materials_v2 (
      id BIGSERIAL PRIMARY KEY,
      model_id TEXT NOT NULL REFERENCES app_models_v2(id) ON DELETE CASCADE,
      company_id TEXT NOT NULL,
      material_id TEXT,
      material_name TEXT NOT NULL DEFAULT '',
      unit TEXT NOT NULL DEFAULT '',
      quantity NUMERIC(16,4) NOT NULL DEFAULT 0,
      unit_price_cents BIGINT NOT NULL DEFAULT 0,
      total_cents BIGINT NOT NULL DEFAULT 0,
      is_free_cost BOOLEAN NOT NULL DEFAULT FALSE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    ALTER TABLE app_model_materials_v2
      ADD COLUMN IF NOT EXISTS is_free_cost BOOLEAN NOT NULL DEFAULT FALSE;

    CREATE INDEX IF NOT EXISTS idx_app_model_materials_v2_model
      ON app_model_materials_v2 (model_id, sort_order);

    CREATE INDEX IF NOT EXISTS idx_app_model_materials_v2_company
      ON app_model_materials_v2 (company_id, model_id);

    CREATE TABLE IF NOT EXISTS app_model_images_v2 (
      id TEXT PRIMARY KEY,
      model_id TEXT NOT NULL REFERENCES app_models_v2(id) ON DELETE CASCADE,
      company_id TEXT NOT NULL,
      variant TEXT NOT NULL CHECK (variant IN ('original', 'thumb')),
      object_key TEXT NOT NULL,
      content_type TEXT NOT NULL,
      size_bytes BIGINT NOT NULL DEFAULT 0,
      width INTEGER,
      height INTEGER,
      sha256 TEXT,
      etag TEXT,
      version INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (model_id, variant),
      UNIQUE (object_key)
    );

    CREATE INDEX IF NOT EXISTS idx_app_model_images_v2_company_model
      ON app_model_images_v2 (company_id, model_id, status);
  `)
}

function number(value, fallback = 0) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function text(value, fallback = '') {
  if (value === undefined || value === null) return fallback
  return String(value)
}

function normalizeIncludedItems(value) {
  const source = Array.isArray(value) ? value : []
  return Array.from(new Set(source.map(item => text(item).trim()).filter(Boolean))).slice(0, 200)
}

function normalizeModelInput(input = {}) {
  return {
    name: text(input.name || input.nome || input.modelo).trim().slice(0, 180),
    description: text(input.description ?? input.descricao_modelo ?? input.descricao ?? '').trim().slice(0, 2000),
    baseMeters: Math.max(0, number(input.base_meters ?? input.baseMeters ?? input.metragem_base ?? 0)),
    spacingCm: Math.max(1, Math.round(number(input.spacing_cm ?? input.spacingCm ?? input.espacamento_cm ?? input.espacamentoCm ?? 10, 10))),
    totalCostCents: Math.max(0, Math.round(number(input.total_cost_cents ?? input.totalCostCents ?? 0))),
    targetProfitCents: Math.max(0, Math.round(number(input.target_profit_cents ?? input.targetProfitCents ?? 0))),
    salePriceCents: Math.max(0, Math.round(number(input.sale_price_cents ?? input.salePriceCents ?? input.price_cents ?? 0))),
    valuePerSpacingCents: Math.max(0, Math.round(number(input.value_per_spacing_cents ?? input.valor_por_espacamento_cents ?? input.valorPorEspacamentoCents ?? 0))),
    includedItems: normalizeIncludedItems(input.itens_incluidos ?? input.included_items ?? input.itensIncluidos),
    materials: Array.isArray(input.materials) ? input.materials : []
  }
}

function normalizeMaterial(material = {}, sortOrder = 0) {
  const quantity = Math.max(0, number(material.quantity ?? material.quantidade ?? material.qtd ?? 0))
  const unitPriceCents = Math.max(0, Math.round(number(material.unit_price_cents ?? material.unitPriceCents ?? material.preco_unitario_cents ?? 0)))
  const totalCents = Math.max(0, Math.round(number(material.total_cents ?? material.totalCents ?? (quantity * unitPriceCents))))
  return {
    materialId: text(material.material_id ?? material.materialId ?? material.id ?? '').trim() || null,
    materialName: text(material.material_name ?? material.materialName ?? material.name ?? material.nome ?? '').trim().slice(0, 180),
    unit: text(material.unit ?? material.unidade ?? '').trim().slice(0, 80),
    quantity,
    unitPriceCents,
    totalCents,
    isFreeCost: Boolean(material.is_free_cost ?? material.is_custo_livre ?? material.isCustoLivre),
    sortOrder
  }
}

async function replaceMaterials(client, companyId, modelId, materials) {
  await client.query('DELETE FROM app_model_materials_v2 WHERE company_id = $1 AND model_id = $2', [companyId, modelId])
  const normalized = (Array.isArray(materials) ? materials : []).map(normalizeMaterial)
  for (const material of normalized) {
    await client.query(`
      INSERT INTO app_model_materials_v2 (
        model_id, company_id, material_id, material_name, unit,
        quantity, unit_price_cents, total_cents, is_free_cost, sort_order, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW(),NOW())
    `, [
      modelId,
      companyId,
      material.materialId,
      material.materialName,
      material.unit,
      material.quantity,
      material.unitPriceCents,
      material.totalCents,
      material.isFreeCost,
      material.sortOrder
    ])
  }
}

function rowToModel(row) {
  if (!row) return null
  return {
    id: row.id,
    company_id: row.company_id,
    legacy_id: row.legacy_id,
    name: row.name,
    descricao_modelo: row.description || '',
    description: row.description || '',
    base_meters: number(row.base_meters),
    spacing_cm: number(row.spacing_cm, 10),
    total_cost_cents: number(row.total_cost_cents),
    target_profit_cents: number(row.target_profit_cents),
    sale_price_cents: number(row.sale_price_cents),
    valor_por_espacamento_cents: number(row.value_per_spacing_cents),
    itens_incluidos: normalizeIncludedItems(row.included_items),
    included_items: normalizeIncludedItems(row.included_items),
    active: row.active !== false,
    created_at: row.created_at,
    updated_at: row.updated_at,
    materials: Array.isArray(row.materials) ? row.materials : [],
    images: row.images && typeof row.images === 'object' ? row.images : {}
  }
}

const MATERIALS_LATERAL = `
  LEFT JOIN LATERAL (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'material_id', mm.material_id,
      'material_name', mm.material_name,
      'unit', mm.unit,
      'quantity', mm.quantity,
      'unit_price_cents', mm.unit_price_cents,
      'total_cents', mm.total_cents,
      'is_custo_livre', mm.is_free_cost,
      'is_free_cost', mm.is_free_cost,
      'sort_order', mm.sort_order
    ) ORDER BY mm.sort_order), '[]'::jsonb) AS materials
    FROM app_model_materials_v2 mm
    WHERE mm.model_id = m.id AND mm.company_id = m.company_id
  ) mats ON TRUE
`

const IMAGES_LATERAL = `
  LEFT JOIN LATERAL (
    SELECT COALESCE(jsonb_object_agg(mi.variant, jsonb_build_object(
      'id', mi.id,
      'variant', mi.variant,
      'object_key', mi.object_key,
      'content_type', mi.content_type,
      'size_bytes', mi.size_bytes,
      'width', mi.width,
      'height', mi.height,
      'sha256', mi.sha256,
      'etag', mi.etag,
      'version', mi.version,
      'updated_at', mi.updated_at
    )), '{}'::jsonb) AS images
    FROM app_model_images_v2 mi
    WHERE mi.model_id = m.id AND mi.company_id = m.company_id AND mi.status = 'active'
  ) imgs ON TRUE
`

async function listModels(companyId, { limit = 100, offset = 0, includeInactive = false, search = '' } = {}) {
  const pool = getPool()
  const safeLimit = Math.min(200, Math.max(1, Math.round(number(limit, 100))))
  const safeOffset = Math.max(0, Math.round(number(offset, 0)))
  const filters = ['m.company_id = $1']
  const params = [companyId]
  if (!includeInactive) filters.push('m.active = TRUE')
  if (text(search).trim()) {
    params.push(`%${text(search).trim().slice(0, 120)}%`)
    filters.push(`m.name ILIKE $${params.length}`)
  }
  const where = filters.join(' AND ')

  const countRes = await pool.query(`SELECT COUNT(*)::int AS total FROM app_models_v2 m WHERE ${where}`, params)
  const pageParams = [...params, safeLimit, safeOffset]
  const rowsRes = await pool.query(`
    SELECT m.*, mats.materials, imgs.images
    FROM app_models_v2 m
    ${MATERIALS_LATERAL}
    ${IMAGES_LATERAL}
    WHERE ${where}
    ORDER BY m.updated_at DESC, m.name ASC
    LIMIT $${params.length + 1} OFFSET $${params.length + 2}
  `, pageParams)

  return {
    items: rowsRes.rows.map(rowToModel),
    total: Number(countRes.rows[0]?.total || 0),
    limit: safeLimit,
    offset: safeOffset
  }
}

async function getModel(companyId, modelId, { includeInactive = false } = {}) {
  const pool = getPool()
  const filters = ['m.company_id = $1', 'm.id = $2']
  if (!includeInactive) filters.push('m.active = TRUE')
  const result = await pool.query(`
    SELECT m.*, mats.materials, imgs.images
    FROM app_models_v2 m
    ${MATERIALS_LATERAL}
    ${IMAGES_LATERAL}
    WHERE ${filters.join(' AND ')}
    LIMIT 1
  `, [companyId, modelId])
  return rowToModel(result.rows[0])
}

async function createModel(companyId, input = {}) {
  const normalized = normalizeModelInput(input)
  if (!normalized.name) {
    const err = new Error('Nome do modelo é obrigatório.')
    err.code = 'invalid_model_name'
    throw err
  }
  const id = crypto.randomUUID()
  const pool = getPool()
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(`
      INSERT INTO app_models_v2 (
        id, company_id, name, description, base_meters, spacing_cm,
        total_cost_cents, target_profit_cents, sale_price_cents,
        value_per_spacing_cents, included_items, active, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,TRUE,NOW(),NOW())
    `, [
      id,
      companyId,
      normalized.name,
      normalized.description,
      normalized.baseMeters,
      normalized.spacingCm,
      normalized.totalCostCents,
      normalized.targetProfitCents,
      normalized.salePriceCents,
      normalized.valuePerSpacingCents,
      JSON.stringify(normalized.includedItems)
    ])
    await replaceMaterials(client, companyId, id, normalized.materials)
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
  return getModel(companyId, id, { includeInactive: true })
}

async function updateModel(companyId, modelId, input = {}) {
  const existing = await getModel(companyId, modelId, { includeInactive: true })
  if (!existing) return null
  const merged = normalizeModelInput({ ...existing, ...input })
  if (!merged.name) {
    const err = new Error('Nome do modelo é obrigatório.')
    err.code = 'invalid_model_name'
    throw err
  }

  const pool = getPool()
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await client.query(`
      UPDATE app_models_v2
      SET name = $3,
          description = $4,
          base_meters = $5,
          spacing_cm = $6,
          total_cost_cents = $7,
          target_profit_cents = $8,
          sale_price_cents = $9,
          value_per_spacing_cents = $10,
          included_items = $11::jsonb,
          updated_at = NOW()
      WHERE company_id = $1 AND id = $2
      RETURNING id
    `, [
      companyId,
      modelId,
      merged.name,
      merged.description,
      merged.baseMeters,
      merged.spacingCm,
      merged.totalCostCents,
      merged.targetProfitCents,
      merged.salePriceCents,
      merged.valuePerSpacingCents,
      JSON.stringify(merged.includedItems)
    ])
    if (!result.rows.length) {
      await client.query('ROLLBACK')
      return null
    }
    if (Object.prototype.hasOwnProperty.call(input, 'materials')) {
      await replaceMaterials(client, companyId, modelId, input.materials)
    }
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
  return getModel(companyId, modelId, { includeInactive: true })
}

async function deactivateModel(companyId, modelId) {
  const pool = getPool()
  const result = await pool.query(`
    UPDATE app_models_v2
    SET active = FALSE, updated_at = NOW()
    WHERE company_id = $1 AND id = $2 AND active = TRUE
    RETURNING id
  `, [companyId, modelId])
  return result.rows.length > 0
}

function deterministicLegacyId(companyId, legacyId) {
  const digest = crypto.createHash('sha256').update(`model:${companyId}:${legacyId}`).digest('hex').slice(0, 32)
  return `mdl_${digest}`
}

async function upsertMigratedModel(companyId, legacyId, input = {}) {
  const normalized = normalizeModelInput(input)
  if (!normalized.name) throw new Error('Modelo legado sem nome não pode ser migrado.')
  const id = deterministicLegacyId(companyId, legacyId)
  const pool = getPool()
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(`
      INSERT INTO app_models_v2 (
        id, company_id, legacy_id, name, description, base_meters, spacing_cm,
        total_cost_cents, target_profit_cents, sale_price_cents,
        value_per_spacing_cents, included_items, active, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,TRUE,$13,$14)
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        description = EXCLUDED.description,
        base_meters = EXCLUDED.base_meters,
        spacing_cm = EXCLUDED.spacing_cm,
        total_cost_cents = EXCLUDED.total_cost_cents,
        target_profit_cents = EXCLUDED.target_profit_cents,
        sale_price_cents = EXCLUDED.sale_price_cents,
        value_per_spacing_cents = EXCLUDED.value_per_spacing_cents,
        included_items = EXCLUDED.included_items,
        active = TRUE,
        updated_at = EXCLUDED.updated_at
    `, [
      id,
      companyId,
      text(legacyId),
      normalized.name,
      normalized.description,
      normalized.baseMeters,
      normalized.spacingCm,
      normalized.totalCostCents,
      normalized.targetProfitCents,
      normalized.salePriceCents,
      normalized.valuePerSpacingCents,
      JSON.stringify(normalized.includedItems),
      input.created_at || input.createdAt || new Date().toISOString(),
      input.updated_at || input.updatedAt || new Date().toISOString()
    ])
    await replaceMaterials(client, companyId, id, normalized.materials)
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
  return getModel(companyId, id, { includeInactive: true })
}

async function upsertImageMeta(companyId, modelId, variant, meta = {}) {
  const pool = getPool()
  const existing = await getImageMeta(companyId, modelId, variant)
  const id = existing?.id || crypto.randomUUID()
  const nextVersion = existing ? Number(existing.version || 0) + 1 : 1
  const result = await pool.query(`
    INSERT INTO app_model_images_v2 (
      id, model_id, company_id, variant, object_key, content_type,
      size_bytes, width, height, sha256, etag, version, status, created_at, updated_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'active',NOW(),NOW())
    ON CONFLICT (model_id, variant) DO UPDATE SET
      object_key = EXCLUDED.object_key,
      content_type = EXCLUDED.content_type,
      size_bytes = EXCLUDED.size_bytes,
      width = EXCLUDED.width,
      height = EXCLUDED.height,
      sha256 = EXCLUDED.sha256,
      etag = EXCLUDED.etag,
      version = EXCLUDED.version,
      status = 'active',
      updated_at = NOW()
    RETURNING *
  `, [
    id,
    modelId,
    companyId,
    variant,
    meta.objectKey,
    meta.contentType,
    Number(meta.sizeBytes || 0),
    meta.width === undefined ? null : Number(meta.width),
    meta.height === undefined ? null : Number(meta.height),
    meta.sha256 || null,
    meta.etag || null,
    nextVersion
  ])
  return result.rows[0]
}

async function getImageMeta(companyId, modelId, variant) {
  const pool = getPool()
  const result = await pool.query(`
    SELECT * FROM app_model_images_v2
    WHERE company_id = $1 AND model_id = $2 AND variant = $3 AND status = 'active'
    LIMIT 1
  `, [companyId, modelId, variant])
  return result.rows[0] || null
}

async function removeImageMeta(companyId, modelId, variant) {
  const pool = getPool()
  const result = await pool.query(`
    UPDATE app_model_images_v2
    SET status = 'deleted', updated_at = NOW()
    WHERE company_id = $1 AND model_id = $2 AND variant = $3 AND status = 'active'
    RETURNING *
  `, [companyId, modelId, variant])
  return result.rows[0] || null
}

module.exports = {
  ensureSchema,
  normalizeModelInput,
  listModels,
  getModel,
  createModel,
  updateModel,
  deactivateModel,
  deterministicLegacyId,
  upsertMigratedModel,
  upsertImageMeta,
  getImageMeta,
  removeImageMeta
}