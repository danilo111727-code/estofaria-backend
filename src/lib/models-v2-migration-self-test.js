'use strict'

const storeLib = require('./store')
const modelsDb = require('./models-v2-db')
const { normalizeLegacyForV2, canonicalLegacyBaseMeters } = require('../../scripts/migrate-models-v2')

function assert(condition, message){
  if(!condition) throw new Error(message)
}

async function runModelsV2MigrationSelfTest(){
  const pool = storeLib && storeLib._pg && storeLib._pg.pool
  if(!pool) throw new Error('PostgreSQL indisponível para self-test Models V2.')

  assert(canonicalLegacyBaseMeters({ base_meters:200 }) === 2, '200 deve virar 2.00 m')
  assert(canonicalLegacyBaseMeters({ base_meters:235 }) === 2.35, '235 deve virar 2.35 m')
  assert(canonicalLegacyBaseMeters({ base_meters:2.4 }) === 2.4, '2.40 m deve permanecer 2.40 m')

  const companyId = '__models_v2_migration_self_test__'
  const legacyId = 'legacy-200'
  const modelId = modelsDb.deterministicLegacyId(companyId, legacyId)

  async function cleanup(){
    await pool.query('DELETE FROM app_model_materials_v2 WHERE company_id=$1 AND model_id=$2',[companyId,modelId]).catch(()=>{})
    await pool.query('DELETE FROM app_model_images_v2 WHERE company_id=$1 AND model_id=$2',[companyId,modelId]).catch(()=>{})
    await pool.query('DELETE FROM app_models_v2 WHERE company_id=$1 AND id=$2',[companyId,modelId]).catch(()=>{})
  }

  await cleanup()
  try{
    const first = normalizeLegacyForV2({
      id:legacyId,
      company_id:companyId,
      name:'Self-test migração 200',
      base_meters:200,
      spacing_cm:10,
      sale_price_cents:10000,
      value_per_spacing_cents:500,
      materials:[]
    })
    const savedFirst = await modelsDb.upsertMigratedModel(companyId,legacyId,first)
    assert(savedFirst && savedFirst.id === modelId, 'Primeira migração não gerou o ID determinístico esperado.')
    assert(Number(savedFirst.base_meters) === 2, 'Primeira migração não persistiu 2.00 m.')
    assert(String(savedFirst.legacy_id) === legacyId, 'legacy_id não foi preservado.')

    const second = normalizeLegacyForV2({
      ...first,
      name:'Self-test migração 235',
      base_meters:235
    })
    const savedSecond = await modelsDb.upsertMigratedModel(companyId,legacyId,second)
    assert(savedSecond && savedSecond.id === savedFirst.id, 'Migração não foi idempotente por company_id + legacy_id.')
    assert(Number(savedSecond.base_meters) === 2.35, 'Segunda migração não atualizou para 2.35 m.')

    const count = await pool.query('SELECT COUNT(*)::int AS total FROM app_models_v2 WHERE company_id=$1 AND legacy_id=$2',[companyId,legacyId])
    assert(Number(count.rows[0]?.total || 0) === 1, 'Migração idempotente criou modelo duplicado.')

    console.log('[models-v2-self-test] OK — normalização 200→2.00, atualização 235→2.35 e idempotência validadas.')
    return { ok:true }
  } finally {
    await cleanup()
  }
}

module.exports = { runModelsV2MigrationSelfTest }
