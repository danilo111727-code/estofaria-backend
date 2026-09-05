'use strict'

const express = require('express')
const { requireAuth } = require('../middleware/auth')
const storeLib = require('../lib/store')

const router = express.Router()
router.use(requireAuth)

function text(value, fallback = '') {
  return String(value ?? fallback).trim()
}

function num(value, fallback = 0) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function normalizeName(value) {
  return String(value || '')
    .trim()
    .toLocaleLowerCase('pt-BR')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
}

function getCompanyContext(req, store) {
  const explicit = text(
    req.query.company_id || req.body?.company_id || req.params.companyId || req.user?.company_id || req.user?.company?.id || ''
  )
  if (explicit) {
    const company = (store.companies || []).find(item => String(item.id) === explicit)
    if (company) return company
  }
  if (req.user?.company_id) {
    return (store.companies || []).find(item => String(item.id) === String(req.user.company_id)) || null
  }
  return null
}

function companyMaterials(store, companyId) {
  return (Array.isArray(store.materials) ? store.materials : [])
    .filter(item => String(item.company_id) === String(companyId))
}

function canFallbackByName(materials, material) {
  const target = normalizeName(material?.name)
  if (!target) return false
  return materials.filter(item => normalizeName(item?.name) === target).length === 1
}

async function repriceModelsForMaterial(companyId, previousMaterial, updatedMaterial, materials) {
  const pool = storeLib && storeLib._pg && storeLib._pg.pool
  if (!pool) {
    const err = new Error('PostgreSQL não disponível para reajustar os modelos.')
    err.code = 'postgres_required'
    throw err
  }

  const allowNameFallback = canFallbackByName(materials, updatedMaterial)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const result = await client.query(`
      WITH updated_materials AS (
        UPDATE app_model_materials_v2 mm
        SET material_id = $2,
            material_name = $3,
            unit = $4,
            unit_price_cents = $5::bigint,
            total_cents = ROUND(mm.quantity * ($5::numeric))::bigint,
            updated_at = NOW()
        WHERE mm.company_id = $1
          AND mm.is_free_cost = FALSE
          AND EXISTS (
            SELECT 1
            FROM app_models_v2 active_model
            WHERE active_model.id = mm.model_id
              AND active_model.company_id = mm.company_id
              AND active_model.active = TRUE
          )
          AND (
            mm.material_id = $2
            OR (
              $8 = TRUE
              AND (
                LOWER(TRIM(mm.material_name)) = LOWER(TRIM($6))
                OR LOWER(TRIM(mm.material_name)) = LOWER(TRIM($3))
              )
            )
          )
        RETURNING mm.model_id
      ),
      affected_models AS (
        SELECT DISTINCT model_id FROM updated_materials
      ),
      recalculated_costs AS (
        SELECT mm.model_id,
               COALESCE(SUM(mm.total_cents), 0)::bigint AS total_cost_cents
        FROM app_model_materials_v2 mm
        INNER JOIN affected_models affected ON affected.model_id = mm.model_id
        WHERE mm.company_id = $1
        GROUP BY mm.model_id
      ),
      repriced_models AS (
        UPDATE app_models_v2 model
        SET total_cost_cents = costs.total_cost_cents,
            sale_price_cents = costs.total_cost_cents + model.target_profit_cents,
            updated_at = NOW()
        FROM recalculated_costs costs
        WHERE model.company_id = $1
          AND model.id = costs.model_id
          AND model.active = TRUE
        RETURNING model.id
      )
      SELECT
        (SELECT COUNT(*)::int FROM updated_materials) AS material_rows_updated,
        (SELECT COUNT(*)::int FROM repriced_models) AS models_repriced
    `, [
      String(companyId),
      String(updatedMaterial.id),
      String(updatedMaterial.name),
      String(updatedMaterial.unit),
      Number(updatedMaterial.price_cents || 0),
      String(previousMaterial.name || ''),
      String(previousMaterial.unit || ''),
      allowNameFallback
    ])

    await client.query('COMMIT')
    return {
      material_rows_updated: Number(result.rows[0]?.material_rows_updated || 0),
      models_repriced: Number(result.rows[0]?.models_repriced || 0),
      name_fallback_enabled: allowNameFallback
    }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}

async function reconcileAllV2ModelsWithMaterialCatalog() {
  const pool = storeLib && storeLib._pg && storeLib._pg.pool
  if (!pool) return { material_rows_updated: 0, models_repriced: 0, unresolved: 0 }

  const store = storeLib.readStore()
  const materials = Array.isArray(store.materials) ? store.materials : []
  const byCompanyId = new Map()
  const byCompanyName = new Map()

  for (const material of materials) {
    const companyId = String(material.company_id || '')
    if (!companyId) continue
    if (!byCompanyId.has(companyId)) byCompanyId.set(companyId, new Map())
    byCompanyId.get(companyId).set(String(material.id), material)

    if (!byCompanyName.has(companyId)) byCompanyName.set(companyId, new Map())
    const name = normalizeName(material.name)
    if (!name) continue
    const bucket = byCompanyName.get(companyId)
    const existing = bucket.get(name) || []
    existing.push(material)
    bucket.set(name, existing)
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const rows = await client.query(`
      SELECT mm.id, mm.company_id, mm.model_id, mm.material_id, mm.material_name,
             mm.unit, mm.quantity, mm.unit_price_cents, mm.total_cents
      FROM app_model_materials_v2 mm
      INNER JOIN app_models_v2 m
        ON m.id = mm.model_id AND m.company_id = mm.company_id
      WHERE m.active = TRUE AND mm.is_free_cost = FALSE
      ORDER BY mm.id
    `)

    const affected = new Set()
    let materialRowsUpdated = 0
    let unresolved = 0

    for (const row of rows.rows) {
      const companyId = String(row.company_id)
      const byId = byCompanyId.get(companyId) || new Map()
      const byName = byCompanyName.get(companyId) || new Map()
      let current = row.material_id ? byId.get(String(row.material_id)) : null
      if (!current) {
        const candidates = byName.get(normalizeName(row.material_name)) || []
        if (candidates.length === 1) current = candidates[0]
      }
      if (!current) {
        unresolved += 1
        continue
      }

      const quantity = Number(row.quantity || 0)
      const price = Math.max(0, Math.round(Number(current.price_cents || 0)))
      const total = Math.round(quantity * price)
      const needsUpdate =
        String(row.material_id || '') !== String(current.id) ||
        String(row.material_name || '') !== String(current.name || '') ||
        String(row.unit || '') !== String(current.unit || '') ||
        Number(row.unit_price_cents || 0) !== price ||
        Number(row.total_cents || 0) !== total

      if (!needsUpdate) continue

      await client.query(`
        UPDATE app_model_materials_v2
        SET material_id = $2,
            material_name = $3,
            unit = $4,
            unit_price_cents = $5,
            total_cents = $6,
            updated_at = NOW()
        WHERE id = $1
      `, [row.id, String(current.id), String(current.name || ''), String(current.unit || ''), price, total])
      materialRowsUpdated += 1
      affected.add(String(row.model_id))
    }

    if (affected.size) {
      await client.query(`
        WITH costs AS (
          SELECT model_id, COALESCE(SUM(total_cents), 0)::bigint AS total_cost_cents
          FROM app_model_materials_v2
          WHERE model_id = ANY($1::text[])
          GROUP BY model_id
        )
        UPDATE app_models_v2 m
        SET total_cost_cents = costs.total_cost_cents,
            sale_price_cents = costs.total_cost_cents + m.target_profit_cents,
            updated_at = NOW()
        FROM costs
        WHERE m.id = costs.model_id AND m.active = TRUE
      `, [Array.from(affected)])
    }

    await client.query('COMMIT')
    return {
      material_rows_updated: materialRowsUpdated,
      models_repriced: affected.size,
      unresolved
    }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}

router.put('/materials/:id', async (req, res, next) => {
  try {
    const store = storeLib.readStore()
    if (!Array.isArray(store.materials)) store.materials = []

    const company = getCompanyContext(req, store)
    if (!company) {
      return res.status(400).json({ error: 'company_required', message: 'Empresa não identificada.' })
    }

    const material = store.materials.find(item =>
      String(item.company_id) === String(company.id)
      && String(item.id) === String(req.params.id)
    )
    if (!material) {
      return res.status(404).json({ error: 'not_found', message: 'Material não encontrado.' })
    }

    const previousMaterial = {
      id: material.id,
      name: material.name,
      unit: material.unit,
      price_cents: Number(material.price_cents || 0)
    }

    const updatedMaterial = {
      ...material,
      name: text(req.body?.name || material.name),
      unit: text(req.body?.unit || material.unit, 'unidade').toLowerCase(),
      price_cents: Math.max(0, Math.round(num(req.body?.price_cents, material.price_cents))),
      updated_at: new Date().toISOString()
    }

    const materials = companyMaterials(store, company.id)
    const repricing = await repriceModelsForMaterial(company.id, previousMaterial, updatedMaterial, materials)

    Object.assign(material, updatedMaterial)
    storeLib.writeStore(store)

    console.log('[material-repricing-test]', JSON.stringify({
      company_id: String(company.id),
      material_id: String(material.id),
      material_name: material.name,
      price_cents: material.price_cents,
      ...repricing
    }))

    return res.json({
      ...material,
      models_repriced: repricing.models_repriced,
      model_materials_updated: repricing.material_rows_updated
    })
  } catch (err) {
    next(err)
  }
})

function legacyModelWriteBlocked(_req, res) {
  return res.status(410).json({
    error: 'models_v2_only',
    message: 'Models V2 é a única fonte de gravação neste ambiente de teste.'
  })
}

router.post('/models', legacyModelWriteBlocked)
router.put('/models/:id', legacyModelWriteBlocked)
router.patch('/models/:id', legacyModelWriteBlocked)
router.delete('/models/:id', legacyModelWriteBlocked)

setTimeout(() => {
  reconcileAllV2ModelsWithMaterialCatalog()
    .then(result => console.log('[models-v2-reconcile]', JSON.stringify(result)))
    .catch(error => console.error('[models-v2-reconcile] falha', error))
}, 12000)

module.exports = router
