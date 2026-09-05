'use strict'

const express = require('express')
const { requireAuth } = require('../middleware/auth')
const { hasMasterAccess, hasPermission } = require('../lib/policies')
const storeLib = require('../lib/store')

const router = express.Router()

function canEditMaterial(user) {
  return hasMasterAccess(user) || hasPermission(user, 'material')
}

function companyIdFor(req) {
  if (hasMasterAccess(req.user)) {
    return String(req.query?.company_id || req.user?.company_id || '').trim()
  }
  return String(req.user?.company_id || '').trim()
}

function text(value, fallback = '') {
  return String(value ?? fallback).trim()
}

function number(value, fallback = 0) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

async function repriceModelsByMaterial(companyId, material) {
  const pool = storeLib?._pg?.pool
  if (!pool) {
    const err = new Error('PostgreSQL não disponível para reajuste dos Models V2.')
    err.code = 'postgres_required'
    throw err
  }

  const materialId = String(material.id)
  const materialName = text(material.name)
  const materialUnit = text(material.unit).toLowerCase()
  const materialPrice = Math.max(0, Math.round(number(material.price_cents, 0)))

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    let matchMode = 'id'
    let affected = await client.query(`
      SELECT DISTINCT mm.model_id
      FROM app_model_materials_v2 mm
      JOIN app_models_v2 m
        ON m.id = mm.model_id
       AND m.company_id = mm.company_id
      WHERE mm.company_id = $1
        AND mm.material_id = $2
        AND m.active = TRUE
    `, [companyId, materialId])

    if (!affected.rows.length && materialName && materialUnit) {
      matchMode = 'name_unit'
      affected = await client.query(`
        SELECT DISTINCT mm.model_id
        FROM app_model_materials_v2 mm
        JOIN app_models_v2 m
          ON m.id = mm.model_id
         AND m.company_id = mm.company_id
        WHERE mm.company_id = $1
          AND LOWER(TRIM(mm.material_name)) = LOWER(TRIM($2))
          AND LOWER(TRIM(mm.unit)) = LOWER(TRIM($3))
          AND m.active = TRUE
      `, [companyId, materialName, materialUnit])
    }

    if (!affected.rows.length) {
      await client.query('COMMIT')
      console.log(`[material-repricing] material=${materialId} nome="${materialName}" unidade="${materialUnit}" modelos=0`)
      return { affectedModels: 0, matchMode: 'none' }
    }

    const modelIds = affected.rows.map(row => String(row.model_id))

    if (matchMode === 'id') {
      await client.query(`
        UPDATE app_model_materials_v2 mm
        SET material_name = $3,
            unit = $4,
            unit_price_cents = CASE WHEN mm.is_free_cost = TRUE THEN mm.unit_price_cents ELSE $5 END,
            total_cents = CASE WHEN mm.is_free_cost = TRUE THEN mm.total_cents ELSE ROUND(mm.quantity * $5)::bigint END,
            updated_at = NOW()
        FROM app_models_v2 m
        WHERE mm.model_id = m.id
          AND mm.company_id = m.company_id
          AND mm.company_id = $1
          AND mm.material_id = $2
          AND m.active = TRUE
      `, [companyId, materialId, materialName, materialUnit, materialPrice])
    } else {
      await client.query(`
        UPDATE app_model_materials_v2 mm
        SET material_id = $2,
            material_name = $3,
            unit = $4,
            unit_price_cents = CASE WHEN mm.is_free_cost = TRUE THEN mm.unit_price_cents ELSE $5 END,
            total_cents = CASE WHEN mm.is_free_cost = TRUE THEN mm.total_cents ELSE ROUND(mm.quantity * $5)::bigint END,
            updated_at = NOW()
        FROM app_models_v2 m
        WHERE mm.model_id = m.id
          AND mm.company_id = m.company_id
          AND mm.company_id = $1
          AND LOWER(TRIM(mm.material_name)) = LOWER(TRIM($3))
          AND LOWER(TRIM(mm.unit)) = LOWER(TRIM($4))
          AND m.active = TRUE
      `, [companyId, materialId, materialName, materialUnit, materialPrice])
    }

    await client.query(`
      UPDATE app_models_v2 m
      SET total_cost_cents = totals.total_cost_cents,
          sale_price_cents = totals.total_cost_cents + m.target_profit_cents,
          updated_at = NOW()
      FROM (
        SELECT mm.model_id,
               COALESCE(SUM(mm.total_cents), 0)::bigint AS total_cost_cents
        FROM app_model_materials_v2 mm
        WHERE mm.company_id = $1
          AND mm.model_id = ANY($2::text[])
        GROUP BY mm.model_id
      ) totals
      WHERE m.company_id = $1
        AND m.id = totals.model_id
        AND m.active = TRUE
    `, [companyId, modelIds])

    await client.query('COMMIT')
    console.log(`[material-repricing] material=${materialId} nome="${materialName}" unidade="${materialUnit}" modelos=${modelIds.length} match=${matchMode}`)
    return { affectedModels: modelIds.length, matchMode }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}

async function updateMaterialAndModels(req, res, next) {
  try {
    if (!canEditMaterial(req.user)) {
      return res.status(403).json({ error:'forbidden', message:'Sem permissão para alterar materiais.' })
    }

    const companyId = companyIdFor(req)
    if (!companyId) return res.status(400).json({ error:'company_required', message:'Empresa não identificada.' })

    const store = storeLib.readStore()
    if (!Array.isArray(store.materials)) store.materials = []
    const row = store.materials.find(item =>
      String(item.company_id) === String(companyId) && String(item.id) === String(req.params.id)
    )
    if (!row) return res.status(404).json({ error:'not_found', message:'Material não encontrado.' })

    const nextMaterial = {
      ...row,
      name: req.body?.name !== undefined ? text(req.body.name) : text(row.name),
      unit: req.body?.unit !== undefined ? text(req.body.unit).toLowerCase() : text(row.unit).toLowerCase(),
      price_cents: req.body?.price_cents !== undefined
        ? Math.max(0, Math.round(number(req.body.price_cents, row.price_cents)))
        : Math.max(0, Math.round(number(row.price_cents, 0))),
      updated_at: storeLib.nowIso()
    }

    const repriced = await repriceModelsByMaterial(companyId, nextMaterial)
    Object.assign(row, nextMaterial)
    storeLib.upsertAudit(store, {
      company_id: companyId,
      action: 'material.update.models-v2',
      message: `Material atualizado: ${nextMaterial.name}; ${repriced.affectedModels} modelo(s) V2 recalculado(s).`,
      actor_name: req.user?.name || req.user?.email || 'Usuário',
      actor_email: req.user?.email || '',
      actor_role: req.user?.role || 'user',
      source: 'material-repricing'
    })
    storeLib.writeStore(store)

    return res.json({
      ...row,
      models_v2_repriced: repriced.affectedModels,
      models_v2_match: repriced.matchMode
    })
  } catch (err) {
    next(err)
  }
}

router.put('/materials/:id', requireAuth, updateMaterialAndModels)
router.patch('/materials/:id', requireAuth, updateMaterialAndModels)

module.exports = router
module.exports.updateMaterialAndModels = updateMaterialAndModels
