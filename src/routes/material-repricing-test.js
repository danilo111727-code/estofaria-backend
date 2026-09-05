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

async function repriceModelsForMaterial(companyId, previousMaterial, updatedMaterial) {
  const pool = storeLib && storeLib._pg && storeLib._pg.pool
  if (!pool) {
    const err = new Error('PostgreSQL não disponível para reajustar os modelos.')
    err.code = 'postgres_required'
    throw err
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const result = await client.query(`
      WITH updated_materials AS (
        UPDATE app_model_materials_v2 mm
        SET material_id = $2,
            material_name = $3,
            unit = $4,
            unit_price_cents = $5,
            total_cents = ROUND(mm.quantity * $5)::bigint,
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
              LOWER(TRIM(mm.material_name)) = LOWER(TRIM($6))
              AND LOWER(TRIM(mm.unit)) = LOWER(TRIM($7))
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
      String(previousMaterial.unit || '')
    ])

    await client.query('COMMIT')
    return {
      material_rows_updated: Number(result.rows[0]?.material_rows_updated || 0),
      models_repriced: Number(result.rows[0]?.models_repriced || 0)
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

    const repricing = await repriceModelsForMaterial(company.id, previousMaterial, updatedMaterial)

    Object.assign(material, updatedMaterial)
    storeLib.writeStore(store)

    return res.json({
      ...material,
      models_repriced: repricing.models_repriced,
      model_materials_updated: repricing.material_rows_updated
    })
  } catch (err) {
    next(err)
  }
})

module.exports = router
