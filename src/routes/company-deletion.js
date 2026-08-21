'use strict'

const crypto = require('crypto')
const express = require('express')
const storeLib = require('../lib/store')
const r2 = require('../lib/r2-storage')
const { requireAuth, requireMaster, requirePermission } = require('../middleware/auth')

const router = express.Router()
const stripeSecretKey = String(process.env.STRIPE_SECRET_KEY || '').trim()
const stripe = stripeSecretKey ? require('stripe')(stripeSecretKey) : null

const DELETE_PATHS = [
  '/saas/companies/:companyId',
  '/master/companies/:companyId',
  '/admin/companies/:companyId',
  '/subscription/admin/companies/:companyId'
]

const RESERVED_COLLECTIONS = new Set([
  'users', 'companies', 'companyUsers', 'auditLogs', 'webhookEvents'
])

function text(value){ return String(value ?? '').trim() }
function clone(value){ return JSON.parse(JSON.stringify(value)) }

function companyIdOfWebhook(record){
  const payload = record && record.payload && typeof record.payload === 'object' ? record.payload : {}
  const object = payload.data && payload.data.object && typeof payload.data.object === 'object' ? payload.data.object : {}
  return text(record?.company_id || payload.company_id || object.company_id || object.metadata?.company_id || '')
}

function removeCompanyScopedCollections(store, companyId, counts){
  const cid = text(companyId)
  for(const [key, value] of Object.entries(store || {})){
    if(!Array.isArray(value) || RESERVED_COLLECTIONS.has(key)) continue
    const before = value.length
    store[key] = value.filter(item => !item || typeof item !== 'object' || text(item.company_id) !== cid)
    const removed = before - store[key].length
    if(removed) counts[key] = removed
  }
}

function cleanLegacyStore(rawStore, companyId, company, actor){
  const store = clone(rawStore || {})
  const cid = text(companyId)
  const counts = {}
  if(!Array.isArray(store.companies)) store.companies = []
  if(!Array.isArray(store.companyUsers)) store.companyUsers = []
  if(!Array.isArray(store.users)) store.users = []
  if(!Array.isArray(store.auditLogs)) store.auditLogs = []
  if(!Array.isArray(store.webhookEvents)) store.webhookEvents = []

  const linkedUserIds = new Set(store.companyUsers.filter(link => text(link.company_id) === cid).map(link => text(link.user_id)).filter(Boolean))
  for(const user of store.users){ if(text(user?.company_id) === cid && user?.id) linkedUserIds.add(text(user.id)) }

  const companiesBefore = store.companies.length
  store.companies = store.companies.filter(item => text(item?.id) !== cid)
  counts.companies = companiesBefore - store.companies.length
  const linksBefore = store.companyUsers.length
  store.companyUsers = store.companyUsers.filter(item => text(item?.company_id) !== cid)
  counts.companyUsers = linksBefore - store.companyUsers.length

  const remainingMemberships = new Map()
  for(const link of store.companyUsers){ const uid = text(link?.user_id); if(uid && !remainingMemberships.has(uid)) remainingMemberships.set(uid, link) }
  let removedUsers = 0
  store.users = store.users.filter(user => {
    const uid = text(user?.id)
    if(!linkedUserIds.has(uid)) return true
    const remaining = remainingMemberships.get(uid)
    if(!remaining){ removedUsers += 1; return false }
    if(text(user.company_id) === cid){ user.company_id = remaining.company_id; user.is_owner = Boolean(remaining.is_owner) }
    return true
  })
  if(removedUsers) counts.users = removedUsers

  removeCompanyScopedCollections(store, cid, counts)
  const auditsBefore = store.auditLogs.length
  store.auditLogs = store.auditLogs.filter(item => text(item?.company_id) !== cid)
  counts.auditLogs = auditsBefore - store.auditLogs.length
  const webhooksBefore = store.webhookEvents.length
  store.webhookEvents = store.webhookEvents.filter(item => companyIdOfWebhook(item) !== cid)
  const webhookRemoved = webhooksBefore - store.webhookEvents.length
  if(webhookRemoved) counts.webhookEvents = webhookRemoved

  store.auditLogs.unshift({ id:crypto.randomUUID(), created_at:new Date().toISOString(), company_id:cid, action:'company_deleted_by_master', message:`Empresa "${text(company?.name || company?.trade_name || cid)}" excluída com limpeza completa.`, actor_user_id:text(actor?.id), actor_name:text(actor?.name || actor?.email || 'Master'), actor_email:text(actor?.email), actor_role:text(actor?.role || 'master'), source:'master-delete-company-v2' })
  store.auditLogs = store.auditLogs.slice(0, 5000)
  return { store, counts }
}

function assertLegacyClean(store, companyId){
  const cid = text(companyId)
  if((store.companies || []).some(item => text(item?.id) === cid)) throw new Error('company_delete_verify_companies')
  if((store.companyUsers || []).some(item => text(item?.company_id) === cid)) throw new Error('company_delete_verify_memberships')
  if((store.users || []).some(item => text(item?.company_id) === cid)) throw new Error('company_delete_verify_users')
  for(const [key, value] of Object.entries(store || {})){
    if(!Array.isArray(value) || ['auditLogs','webhookEvents'].includes(key)) continue
    if(value.some(item => item && typeof item === 'object' && text(item.company_id) === cid)) throw new Error(`company_delete_verify_${key}`)
  }
  if((store.webhookEvents || []).some(item => companyIdOfWebhook(item) === cid)) throw new Error('company_delete_verify_webhooks')
}

async function cancelStripeSubscription(company){
  const subscriptionId = text(company?.stripe_subscription_id)
  if(!subscriptionId) return { attempted:false, status:'not_linked' }
  if(!stripe){ const err = new Error('A empresa possui assinatura Stripe vinculada, mas a Stripe não está configurada no servidor.'); err.code='stripe_not_configured'; err.statusCode=503; throw err }
  try{ const canceled = await stripe.subscriptions.cancel(subscriptionId); return { attempted:true, status:text(canceled?.status || 'canceled') || 'canceled' } }
  catch(error){
    if(error && error.code === 'resource_missing') return { attempted:true, status:'already_absent' }
    const err = new Error('Não foi possível cancelar a assinatura Stripe. A empresa não foi excluída.'); err.code='stripe_cancel_failed'; err.statusCode=502; err.cause=error; throw err
  }
}

async function verifyV2Clean(client, companyId){
  const tables = ['app_model_materials_v2','app_model_images_v2','app_model_personalization_v2','app_models_v2','app_quote_model_items_v2','app_quote_models_v2','app_quotes_v2','app_personalization_catalog_v2']
  for(const table of tables){
    const result = await client.query(`SELECT COUNT(*)::int AS total FROM ${table} WHERE company_id = $1`, [companyId])
    if(Number(result.rows[0]?.total || 0) !== 0) throw new Error(`company_delete_verify_${table}`)
  }
}

async function deletePgData(companyId, company, actor){
  const pg = storeLib._pg
  if(!pg?.pool) throw new Error('postgres_required')
  await pg.flushNow()
  const client = await pg.pool.connect()
  let cleanedStore, legacyCounts = {}, imageKeys = []
  const v2Counts = {}
  try{
    await client.query('BEGIN')
    const storeResult = await client.query("SELECT value FROM kv_store WHERE key = 'main' FOR UPDATE")
    const rawStore = storeResult.rows[0]?.value || storeLib.readStore()
    const persistedCompany = (rawStore.companies || []).find(item => text(item?.id) === text(companyId))
    if(!persistedCompany){ const err = new Error('Empresa não encontrada.'); err.code='company_not_found'; err.statusCode=404; throw err }
    const imageResult = await client.query('SELECT DISTINCT object_key FROM app_model_images_v2 WHERE company_id = $1 AND object_key IS NOT NULL', [companyId])
    imageKeys = imageResult.rows.map(row => text(row.object_key)).filter(Boolean)
    const pm = await client.query('DELETE FROM app_model_personalization_v2 WHERE company_id = $1', [companyId])
    const pc = await client.query('DELETE FROM app_personalization_catalog_v2 WHERE company_id = $1', [companyId])
    const q = await client.query('DELETE FROM app_quotes_v2 WHERE company_id = $1', [companyId])
    const m = await client.query('DELETE FROM app_models_v2 WHERE company_id = $1', [companyId])
    v2Counts.personalization_models=pm.rowCount||0; v2Counts.personalization_catalog=pc.rowCount||0; v2Counts.quotes=q.rowCount||0; v2Counts.models=m.rowCount||0
    const cleaned = cleanLegacyStore(rawStore, companyId, company || persistedCompany, actor)
    cleanedStore=cleaned.store; legacyCounts=cleaned.counts
    assertLegacyClean(cleanedStore, companyId)
    await verifyV2Clean(client, companyId)
    await client.query(`INSERT INTO kv_store (key, value, updated_at) VALUES ('main', $1::jsonb, NOW()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`, [JSON.stringify(cleanedStore)])
    await client.query('COMMIT')
  }catch(error){ await client.query('ROLLBACK').catch(()=>{}); throw error }
  finally{ client.release() }
  storeLib.writeStore(cleanedStore)
  await pg.flushNow()
  return { imageKeys, legacyCounts, v2Counts }
}

async function deleteFileStoreData(companyId, company, actor){
  const cleaned = cleanLegacyStore(storeLib.readStore(), companyId, company, actor)
  assertLegacyClean(cleaned.store, companyId)
  storeLib.writeStore(cleaned.store)
  return { imageKeys:[], legacyCounts:cleaned.counts, v2Counts:{} }
}

async function recordR2CleanupPending(companyId, keys){
  if(!keys.length) return
  const store = storeLib.readStore()
  if(!Array.isArray(store.deletionCleanupJobs)) store.deletionCleanupJobs = []
  store.deletionCleanupJobs.push({ id:crypto.randomUUID(), company_id:text(companyId), type:'r2_delete', object_keys:keys, error_count:keys.length, status:'pending', created_at:new Date().toISOString() })
  storeLib.writeStore(store)
  if(storeLib._pg?.flushNow) await storeLib._pg.flushNow()
}

async function deleteR2Objects(companyId, imageKeys){
  if(!imageKeys.length) return { deleted:0, pending:0 }
  const failed=[]; let deleted=0
  if(!r2.isConfigured()) failed.push(...imageKeys)
  else for(const key of imageKeys){ try{ await r2.deleteObject(key); deleted+=1 }catch(error){ console.warn('[company-delete] falha ao remover R2:', key, error?.message || error); failed.push(key) } }
  if(failed.length) await recordR2CleanupPending(companyId, failed)
  return { deleted, pending:failed.length }
}

async function deleteCompanyCompletely(companyId, actor){
  const cid=text(companyId), snapshot=storeLib.readStore()
  const company=(snapshot.companies || []).find(item => text(item?.id) === cid)
  if(!company){ const err=new Error('Empresa não encontrada.'); err.code='company_not_found'; err.statusCode=404; throw err }
  const stripeResult=await cancelStripeSubscription(company)
  const dbResult=storeLib._pg?.pool ? await deletePgData(cid, company, actor) : await deleteFileStoreData(cid, company, actor)
  const r2Result=await deleteR2Objects(cid, dbResult.imageKeys)
  return { company_name:text(company.name || company.trade_name || cid), stripe:stripeResult, legacy_deleted:dbResult.legacyCounts, v2_deleted:dbResult.v2Counts, r2:r2Result }
}

router.delete(DELETE_PATHS, requireAuth, requireMaster, requirePermission('saas.companies.write'), async (req,res) => {
  try{
    const result=await deleteCompanyCompletely(req.params.companyId, req.user)
    return res.json({ ok:true, message:`Empresa "${result.company_name}" excluída com limpeza completa.`, cleanup:result })
  }catch(error){
    console.error('[company-delete]', error?.cause || error)
    const status=Number(error?.statusCode || (error?.code === 'company_not_found' ? 404 : 500))
    return res.status(status).json({ error:error?.code || 'company_delete_failed', message:error?.message || 'Não foi possível excluir a empresa com segurança.' })
  }
})

module.exports = router
module.exports.deleteCompanyCompletely = deleteCompanyCompletely
module.exports.cleanLegacyStore = cleanLegacyStore
module.exports.assertLegacyClean = assertLegacyClean
