'use strict'

const { AsyncLocalStorage } = require('async_hooks')
const auditV2Db = require('./audit-v2-db')

const requestStore = new AsyncLocalStorage()
let installed = false
let storeLib = null
let originalReadStore = null
let originalWriteStore = null
let originalUpdateStore = null
let shadowStore = null
let outsideDirty = false
let outsideChangedKeys = new Set()
let outsideTimer = null
let mutationQueue = Promise.resolve()

function clone(value){
  return value == null ? value : JSON.parse(JSON.stringify(value))
}

function same(a, b){
  return JSON.stringify(a) === JSON.stringify(b)
}

function currentCommittedStore(){
  if(shadowStore) return clone(shadowStore)
  const current = originalReadStore()
  shadowStore = clone(current)
  return clone(current)
}

function changedTopLevelKeys(before, after){
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})])
  return Array.from(keys).filter(key => !same(before?.[key], after?.[key]))
}

function auditEntriesFromStore(store){
  if(!auditV2Db.isEnabled() || !store || typeof store !== 'object') return []
  const entries = []
  if(Array.isArray(store.__auditV2Pending)) entries.push(...store.__auditV2Pending)
  // Captura também qualquer gravação direta ainda existente no código legado.
  if(Array.isArray(store.auditLogs)) entries.push(...store.auditLogs)
  return entries.filter(Boolean)
}

function storeWithoutLegacyAudit(store){
  const next = clone(store || {})
  if(auditV2Db.isEnabled()){
    delete next.__auditV2Pending
    next.auditLogs = []
  }
  return next
}

function enqueue(task){
  const run = mutationQueue.then(task, task)
  mutationQueue = run.catch(() => {})
  return run
}

async function persistOutsideChanges(){
  if(!outsideDirty || !storeLib?._pg?.pool) return

  const snapshot = clone(shadowStore || currentCommittedStore())
  const keys = Array.from(outsideChangedKeys)
  outsideDirty = false
  outsideChangedKeys = new Set()

  if(!keys.length) return

  await enqueue(async () => {
    const client = await storeLib._pg.pool.connect()
    try{
      await client.query('BEGIN')
      const result = await client.query("SELECT value FROM kv_store WHERE key = 'main' FOR UPDATE")
      const latest = result.rows[0]?.value || {}
      const merged = { ...latest }
      for(const key of keys){
        if(auditV2Db.isEnabled() && key === '__auditV2Pending') continue
        if(auditV2Db.isEnabled() && key === 'auditLogs'){
          merged.auditLogs = []
          continue
        }
        if(Object.prototype.hasOwnProperty.call(snapshot, key)) merged[key] = clone(snapshot[key])
        else delete merged[key]
      }

      const pendingAudits = auditEntriesFromStore(snapshot)
      if(pendingAudits.length) await auditV2Db.insertMany(client,pendingAudits)
      if(auditV2Db.isEnabled()){
        delete merged.__auditV2Pending
        merged.auditLogs = []
      }

      await client.query(
        `INSERT INTO kv_store (key, value, updated_at)
         VALUES ('main', $1::jsonb, NOW())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
        [JSON.stringify(merged)]
      )
      await client.query('COMMIT')
      shadowStore = clone(merged)
    }catch(error){
      await client.query('ROLLBACK').catch(() => {})
      outsideDirty = true
      keys.forEach(key => outsideChangedKeys.add(key))
      throw error
    }finally{
      client.release()
    }
  })
}

function scheduleOutsideWrite(){
  if(outsideTimer) clearTimeout(outsideTimer)
  outsideTimer = setTimeout(() => {
    outsideTimer = null
    persistOutsideChanges().catch(error => {
      console.error('[atomic-store] Falha ao persistir alteração fora de transação:', error?.message || error)
      scheduleOutsideWrite()
    })
  }, 200)
}

function install(targetStoreLib){
  if(installed || !targetStoreLib) return
  installed = true
  storeLib = targetStoreLib

  originalReadStore = targetStoreLib.readStore.bind(targetStoreLib)
  originalWriteStore = targetStoreLib.writeStore.bind(targetStoreLib)
  originalUpdateStore = targetStoreLib.updateStore.bind(targetStoreLib)

  targetStoreLib.readStore = function(){
    const ctx = requestStore.getStore()
    if(ctx?.store) return clone(ctx.store)
    return currentCommittedStore()
  }

  targetStoreLib.writeStore = function(nextStore){
    const ctx = requestStore.getStore()
    const next = clone(nextStore)

    // GETs marcados como somente leitura podem manter mutações legadas na
    // cópia local para montar a resposta, mas nunca persistem essas mudanças.
    if(ctx?.readOnly){
      ctx.store = next
      return
    }

    if(ctx){
      if(!same(ctx.store, next)){
        ctx.store = next
        ctx.dirty = true
      }
      return
    }

    const before = currentCommittedStore()
    const changed = changedTopLevelKeys(before, next)
    shadowStore = next
    if(!changed.length) return
    changed.forEach(key => outsideChangedKeys.add(key))
    outsideDirty = true

    if(storeLib?._pg?.pool) scheduleOutsideWrite()
    else return originalWriteStore(next)
  }

  targetStoreLib.updateStore = function(mutator){
    const working = targetStoreLib.readStore()
    const next = mutator(working) || working
    targetStoreLib.writeStore(next)
    return next
  }

  const pg = targetStoreLib._pg
  if(pg && typeof pg.readAuthStore === 'function'){
    pg.readAuthStore = function(){
      const current = targetStoreLib.readStore()
      return {
        users: Array.isArray(current.users) ? current.users.slice() : [],
        companies: Array.isArray(current.companies) ? current.companies.slice() : [],
        companyUsers: Array.isArray(current.companyUsers) ? current.companyUsers.slice() : []
      }
    }
  }

  if(pg && typeof pg.flushNow === 'function'){
    pg.flushNow = async function(){
      if(outsideTimer){
        clearTimeout(outsideTimer)
        outsideTimer = null
      }
      if(outsideDirty) await persistOutsideChanges()
    }
  }
}

function requestPath(req){
  return String(req.originalUrl || req.url || '').split('?')[0].replace(/\/$/, '')
}

function isParallelReadOnlyGet(req){
  if(String(req.method || '').toUpperCase() !== 'GET') return false
  // Agenda V2 e Dashboard V2 já leem PostgreSQL diretamente. Apenas a rota
  // legada de quotes continua precisando da cópia isolada do store.
  return ['/api/quotes'].includes(requestPath(req))
}

function isAgendaV2Mutation(method,path){
  if(method === 'PATCH' && path === '/api/agenda/config') return true
  if(method === 'POST' && path === '/api/agenda/orders') return true
  if(['PATCH','DELETE'].includes(method) && /^\/api\/agenda\/orders\/[^/]+$/.test(path)) return true
  if(method === 'POST' && path === '/api/agenda/blocos') return true
  if(['PATCH','DELETE'].includes(method) && /^\/api\/agenda\/blocos\/[^/]+$/.test(path)) return true
  if(['POST','DELETE'].includes(method) && /^\/api\/agenda\/blocos\/[^/]+\/vaga$/.test(path)) return true
  if(method === 'POST' && /^\/api\/agenda\/blocos\/[^/]+\/pedido$/.test(path)) return true
  return false
}

function isFinancialV2Mutation(method,path){
  if(method === 'POST' && path === '/api/financial/entries') return true
  if(['PATCH','DELETE'].includes(method) && /^\/api\/financial\/entries\/[^/]+$/.test(path)) return true
  return false
}

function shouldWrap(req){
  if(!storeLib?._pg?.pool) return false
  const method = String(req.method || '').toUpperCase()
  if(['POST','PUT','PATCH','DELETE'].includes(method)){
    const path = requestPath(req)
    // Agenda V2 e Financeiro V2 gravam diretamente em tabelas PostgreSQL próprias.
    if(isAgendaV2Mutation(method,path) || isFinancialV2Mutation(method,path)) return false
    if(path.startsWith('/api/v2/')) return false
    if(path.includes('/companies/') && method === 'DELETE') return false
    if(path.endsWith('/stripe/create-checkout') || path.endsWith('/customer-portal')) return false
    return path.startsWith('/api/')
  }

  if(method !== 'GET') return false
  const path = requestPath(req)
  return [
    '/api/materials',
    '/api/models',
    '/api/material-units'
  ].includes(path) || /^\/api\/models\/[^/]+\/personalization-items$/.test(path)
}

function captureResponse(res){
  const original = {
    json: res.json.bind(res),
    send: res.send.bind(res),
    end: res.end.bind(res)
  }
  let captured = null
  let resolveReady
  const ready = new Promise(resolve => { resolveReady = resolve })

  res.json = function(body){
    if(!captured){
      captured = { type:'json', args:[body] }
      resolveReady()
    }
    return res
  }
  res.send = function(body){
    if(!captured){
      captured = { type:'send', args:[body] }
      resolveReady()
    }
    return res
  }
  res.end = function(chunk, encoding, callback){
    if(!captured){
      captured = { type:'end', args:[chunk, encoding, callback] }
      resolveReady()
    }
    return res
  }

  function restore(){
    res.json = original.json
    res.send = original.send
    res.end = original.end
  }

  function release(){
    const response = captured
    restore()
    if(!response) return original.end()
    if(response.type === 'json') return original.json(...response.args)
    if(response.type === 'send') return original.send(...response.args)
    return original.end(...response.args)
  }

  return { ready, release, restore }
}

function middleware(req, res, next){
  // Estas rotas legadas de consulta recebem uma cópia isolada do estado atual
  // e podem rodar em paralelo, sem SELECT ... FOR UPDATE e sem fila de mutações.
  if(isParallelReadOnlyGet(req)){
    const ctx = { store:currentCommittedStore(), dirty:false, readOnly:true }
    return requestStore.run(ctx, () => next())
  }

  if(!shouldWrap(req)) return next()

  const captured = captureResponse(res)

  enqueue(async () => {
    const pg = storeLib._pg
    const client = await pg.pool.connect()
    let committedStore = null
    try{
      await client.query('BEGIN')
      const result = await client.query("SELECT value FROM kv_store WHERE key = 'main' FOR UPDATE")
      const fresh = clone(result.rows[0]?.value || currentCommittedStore())
      const ctx = { store:fresh, dirty:false }

      await requestStore.run(ctx, async () => {
        next()
        await Promise.race([
          captured.ready,
          new Promise((_, reject) => setTimeout(() => reject(new Error('atomic_request_timeout')), 30000))
        ])
      })

      if(ctx.dirty && res.statusCode < 400){
        const pendingAudits = auditEntriesFromStore(ctx.store)
        const persistedStore = storeWithoutLegacyAudit(ctx.store)
        if(pendingAudits.length) await auditV2Db.insertMany(client,pendingAudits)
        await client.query(
          `INSERT INTO kv_store (key, value, updated_at)
           VALUES ('main', $1::jsonb, NOW())
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
          [JSON.stringify(persistedStore)]
        )
        committedStore = clone(persistedStore)
        await client.query('COMMIT')
      }else{
        committedStore = fresh
        await client.query('ROLLBACK')
      }

      shadowStore = clone(committedStore)
      captured.release()
    }catch(error){
      await client.query('ROLLBACK').catch(() => {})
      captured.restore()
      console.error('[atomic-store] Falha na transação:', error?.message || error)
      if(!res.headersSent){
        return res.status(503).json({
          error:'store_transaction_failed',
          message:'Não foi possível concluir esta alteração agora. Tente novamente.'
        })
      }
    }finally{
      client.release()
    }
  }).catch(error => {
    captured.restore()
    console.error('[atomic-store] Falha na fila transacional:', error?.message || error)
    if(!res.headersSent){
      res.status(503).json({
        error:'store_transaction_failed',
        message:'Não foi possível concluir esta alteração agora. Tente novamente.'
      })
    }
  })
}

module.exports = { install, middleware, persistOutsideChanges }
