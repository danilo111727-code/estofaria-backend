'use strict'
const {test}=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm')
function load(query){
 const context={module:{exports:{}},require:name=>name==='./store'?{_pg:{pool:{query}}}:require(name)}
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/lib/financial-v2-db.js'),'utf8'),context)
 return context.module.exports
}
test('Excluir do histórico altera somente metadado, preservando pagamento, status, valor e datas',async()=>{
 let called=false
 const db=load(async(sql,args)=>{
  called=true
  assert.match(sql,/UPDATE app_financial_entries_v2/)
  assert.doesNotMatch(sql,/DELETE|SET status|updated_at\s*=|total_cents\s*=/i)
  assert.match(sql,/SET payload=jsonb_set/)
  assert.match(sql,/WHERE company_id=\$1 AND id=\$2/)
  assert.match(sql,/IN \('pago','recebido'\)/)
  assert.match(sql,/COALESCE\(payload->'history_removed_at',to_jsonb\(NOW\(\)\)\)/)
  assert.deepEqual(Array.from(args),['empresa1','pedido1'])
  return {rows:[{id:'pedido1'}]}
 })
 assert.equal(await db.removeEntryFromHistory('empresa1','pedido1'),true)
 assert.equal(called,true)
})
test('Registro ausente, ativo ou de outra empresa não é removido do histórico',async()=>{
 const db=load(async()=>({rows:[]}))
 assert.equal(await db.removeEntryFromHistory('empresa2','pedido1'),false)
})
test('Falha de banco é propagada sem simular exclusão bem sucedida',async()=>{
 const db=load(async()=>{throw new Error('database unavailable')})
 await assert.rejects(db.removeEntryFromHistory('empresa1','pedido1'),/database unavailable/)
})
