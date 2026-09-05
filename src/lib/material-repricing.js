'use strict'

const storeLib = require('./store')

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
    `, [String(companyId), materialId])

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
      `, [String(companyId), materialName, materialUnit])
    }

    if (!affected.rows.length) {
      await client.query('COMMIT')
      console.log(`[material-repricing] company=${companyId} material=${materialId} modelos=0`)
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
      `, [String(companyId), materialId, materialName, materialUnit, materialPrice])
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
      `, [String(companyId), materialId, materialName, materialUnit, materialPrice])
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
    `, [String(companyId), modelIds])

    await client.query('COMMIT')
    console.log(`[material-repricing] company=${companyId} material=${materialId} modelos=${modelIds.length} match=${matchMode}`)
    return { affectedModels: modelIds.length, matchMode }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}

module.exports = { repriceModelsByMaterial }
