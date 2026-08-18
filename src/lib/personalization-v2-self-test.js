'use strict'

const crypto = require('crypto')
const storeLib = require('./store')
const modelsDb = require('./models-v2-db')
const personalizationDb = require('./personalization-v2-db')

function assert(condition, message){
  if(!condition) throw new Error(message)
}

async function runPersonalizationV2SelfTest(){
  const pool = storeLib && storeLib._pg && storeLib._pg.pool
  if(!pool) throw new Error('PostgreSQL indisponível no self-test da Personalização V2.')

  const suffix = crypto.randomUUID()
  const companyA = `selftest-a-${suffix}`
  const companyB = `selftest-b-${suffix}`
  let model = null

  try{
    model = await modelsDb.createModel(companyA, {
      name:'Modelo temporário Personalização V2',
      base_meters:2,
      spacing_cm:10,
      sale_price_cents:100000
    })
    assert(model && model.id, 'Self-test: modelo temporário não foi criado.')

    const initialCatalog = await personalizationDb.getCatalog(companyA)
    assert(initialCatalog.revision === 0, 'Self-test: catálogo novo deveria iniciar na revisão 0.')

    const savedCatalog = await personalizationDb.saveCatalog(companyA, {
      items:[{name:'Pé de madeira',unit:'jogo',price_cents:3500,category:'pe'}],
      albums:[],
      groups:[]
    }, 0)
    assert(savedCatalog.revision === 1, 'Self-test: catálogo não avançou para revisão 1.')
    assert(savedCatalog.items.length === 1, 'Self-test: item do catálogo não foi persistido.')

    const otherCatalog = await personalizationDb.getCatalog(companyB)
    assert(otherCatalog.items.length === 0, 'Self-test: houve vazamento de catálogo entre empresas.')

    const savedModel = await personalizationDb.saveModelConfig(companyA, model.id, {
      metragens:['1.00','2.00'],
      consumos:{'pé de madeira':{'1.00':1,'2.00':2}}
    }, 0)
    assert(savedModel.revision === 1, 'Self-test: configuração do modelo não avançou para revisão 1.')
    assert(Number(savedModel.consumos?.['pé de madeira']?.['2.0'] ?? savedModel.consumos?.['pé de madeira']?.['2.00']) === 2,
      'Self-test: consumo do modelo não foi persistido.')

    const foreignModel = await modelsDb.getModel(companyB, model.id, { includeInactive:true })
    assert(!foreignModel, 'Self-test: Models V2 permitiu leitura do modelo por outra empresa.')

    let foreignWriteBlocked = false
    try{
      await personalizationDb.saveModelConfig(companyB, model.id, {
        metragens:['1.00'],
        consumos:{'pé de madeira':{'1.00':999}}
      }, 0)
    }catch(err){
      foreignWriteBlocked = err?.code === '23503' || /foreign key/i.test(String(err?.message || ''))
    }
    assert(foreignWriteBlocked, 'Self-test: banco não bloqueou vínculo de modelo com empresa estrangeira.')

    let revisionConflict = false
    try{
      await personalizationDb.saveCatalog(companyA, {
        items:[{name:'Tentativa antiga',unit:'unidade',price_cents:1}],
        albums:[],
        groups:[]
      }, 0)
    }catch(err){
      revisionConflict = err?.code === 'revision_conflict'
    }
    assert(revisionConflict, 'Self-test: revisão antiga não foi bloqueada.')

    console.log('[personalization-v2-self-test] OK — persistência, isolamento e conflito validados.')
    return { ok:true }
  } finally {
    if(model?.id){
      await pool.query('DELETE FROM app_models_v2 WHERE id = $1', [model.id]).catch(() => {})
    }
    await pool.query('DELETE FROM app_personalization_catalog_v2 WHERE company_id = ANY($1::text[])', [[companyA, companyB]]).catch(() => {})
  }
}

module.exports = { runPersonalizationV2SelfTest }
