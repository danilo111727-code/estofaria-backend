'use strict'

const { AsyncLocalStorage } = require('async_hooks')
const perfStore = new AsyncLocalStorage()

function nowMs(){
  return Number(process.hrtime.bigint()) / 1e6
}

function isQuoteCreate(req){
  return !!req && req.method === 'POST' && req.path === '/api/quotes'
}

function middleware(req, res, next){
  if(!isQuoteCreate(req)) return next()

  const ctx = {
    startedAt: nowMs(),
    readStoreMs: 0,
    readStoreCalls: 0,
    writeStoreMs: 0,
    writeStoreCalls: 0
  }

  perfStore.run(ctx, () => {
    res.on('finish', () => {
      const totalMs = nowMs() - ctx.startedAt
      const otherMs = Math.max(0, totalMs - ctx.readStoreMs - ctx.writeStoreMs)
      console.log(
        `[perf][POST /api/quotes] status=${res.statusCode} total=${totalMs.toFixed(1)}ms ` +
        `readStore=${ctx.readStoreMs.toFixed(1)}ms(${ctx.readStoreCalls}x) ` +
        `writeStore=${ctx.writeStoreMs.toFixed(1)}ms(${ctx.writeStoreCalls}x) ` +
        `other=${otherMs.toFixed(1)}ms`
      )
    })
    next()
  })
}

function installStoreTiming(storeLib){
  if(!storeLib || storeLib.__quotePerfTimingInstalled) return

  ;['readStore', 'writeStore'].forEach(name => {
    if(typeof storeLib[name] !== 'function') return
    const original = storeLib[name].bind(storeLib)
    storeLib[name] = function(){
      const ctx = perfStore.getStore()
      if(!ctx) return original(...arguments)

      const startedAt = nowMs()
      try {
        return original(...arguments)
      } finally {
        const elapsed = nowMs() - startedAt
        if(name === 'readStore'){
          ctx.readStoreMs += elapsed
          ctx.readStoreCalls += 1
        } else {
          ctx.writeStoreMs += elapsed
          ctx.writeStoreCalls += 1
        }
      }
    }
  })

  storeLib.__quotePerfTimingInstalled = true
}

module.exports = { middleware, installStoreTiming }
