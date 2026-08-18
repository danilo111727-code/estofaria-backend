'use strict'

const storeLib = require('./store')

function getPool(){
  const pool = storeLib && storeLib._pg && storeLib._pg.pool
  if(!pool) throw new Error('PostgreSQL não disponível para hardening da Personalização V2.')
  return pool
}

async function ensurePersonalizationIsolation(){
  const pool = getPool()
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS ux_app_models_v2_company_id
      ON app_models_v2 (company_id, id);

    ALTER TABLE app_model_personalization_v2
      DROP CONSTRAINT IF EXISTS app_model_personalization_v2_model_id_fkey;

    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'app_model_personalization_v2_company_model_fkey'
      ) THEN
        ALTER TABLE app_model_personalization_v2
          ADD CONSTRAINT app_model_personalization_v2_company_model_fkey
          FOREIGN KEY (company_id, model_id)
          REFERENCES app_models_v2(company_id, id)
          ON DELETE CASCADE;
      END IF;
    END $$;
  `)
}

module.exports = { ensurePersonalizationIsolation }
