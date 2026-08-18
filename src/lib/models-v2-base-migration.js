'use strict'

const storeLib = require('./store')

async function normalizeExistingBaseMeters() {
  const pool = storeLib && storeLib._pg && storeLib._pg.pool
  if (!pool) return { updated: 0 }

  const result = await pool.query(`
    UPDATE app_models_v2
    SET base_meters = ROUND((base_meters / 100.0)::numeric, 2)
    WHERE base_meters > 10
  `)

  const updated = Number(result.rowCount || 0)
  if (updated > 0) {
    console.log(`[models-v2] Medida base normalizada para metros em ${updated} modelo(s).`)
  }
  return { updated }
}

module.exports = { normalizeExistingBaseMeters }
