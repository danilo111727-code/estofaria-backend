'use strict'

let installed = false

function install(storeLib,auditDb){
  if(installed || !storeLib || !auditDb) return
  installed = true

  const originalUpsertAudit = typeof storeLib.upsertAudit === 'function'
    ? storeLib.upsertAudit.bind(storeLib)
    : null

  storeLib.upsertAudit = function(store,entry){
    if(auditDb.isEnabled()){
      return auditDb.queueAudit(store,entry)
    }
    if(originalUpsertAudit) return originalUpsertAudit(store,entry)
    return null
  }
}

module.exports = { install }
