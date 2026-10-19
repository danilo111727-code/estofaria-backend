'use strict'
// Run with @electric-sql/pglite and express available through NODE_PATH.
const {test}=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm')
const {PGlite}=require('@electric-sql/pglite')
const tables=['app_model_materials_v2','app_model_images_v2','app_model_personalization_v2','app_models_v2','app_quote_model_items_v2','app_quote_models_v2','app_quotes_v2','app_personalization_catalog_v2','app_agenda_orders_v2','app_agenda_blocos_v2','app_agenda_configs_v2','app_agenda_audit_v2','app_financial_entries_v2','app_financial_audit_v2','app_audit_logs_v2']
function load(file,requires){const context={module:{exports:{}},console,Date,process:{env:{}},require:name=>name in requires?requires[name]:require(name)};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src',file),'utf8'),context);return context.module.exports}
async function scenario(fail){
 const pg=new PGlite()
 try{
  await pg.exec('CREATE TABLE kv_store(key text PRIMARY KEY,value jsonb,updated_at timestamptz);'+tables.map(table=>'CREATE TABLE '+table+'(id text PRIMARY KEY,company_id text,object_key text);').join(''))
  for(const [child,parent,column] of [
   ['app_model_materials_v2','app_models_v2','model_id'],
   ['app_model_images_v2','app_models_v2','model_id'],
   ['app_quote_models_v2','app_quotes_v2','quote_id'],
   ['app_quote_model_items_v2','app_quote_models_v2','quote_model_id']
  ])await pg.exec('ALTER TABLE '+child+' ADD COLUMN '+column+' text REFERENCES '+parent+'(id) ON DELETE CASCADE')
  let snapshot={companies:[{id:'remove',name:'Excluir'},{id:'keep',name:'Manter'}],users:[],companyUsers:[],auditLogs:[]}
  await pg.query("INSERT INTO kv_store(key,value) VALUES('main',$1)",[JSON.stringify(snapshot)])
  for(const table of tables)await pg.query('INSERT INTO '+table+'(id,company_id) VALUES($1,$2),($3,$4)',['a','remove','b','keep'])
  for(const [table,column] of [['app_model_materials_v2','model_id'],['app_model_images_v2','model_id'],['app_quote_models_v2','quote_id'],['app_quote_model_items_v2','quote_model_id']])await pg.exec('UPDATE '+table+' SET '+column+'=id')
  // No external storage interaction: these fixtures have no image objects.
  let transaction=false
  const client={release(){},async query(sql,params){
   if(sql==='BEGIN')transaction=true
   if(fail&&sql.startsWith('DELETE FROM app_quotes_v2'))throw new Error('simulated_failure_after_adjustments')
   const result=await pg.query(sql,params)
   if(sql==='ROLLBACK'||sql==='COMMIT')transaction=false
   return result
  }}
  const pool={connect:async()=>client,query:(...args)=>pg.query(...args)}
  const store={readStore:()=>structuredClone(snapshot),writeStore:value=>{snapshot=structuredClone(value)},_pg:{pool,flushNow:async()=>{}}}
  const adjustments=load('lib/revenue-adjustments-db.js',{'./store':store})
  await adjustments.save('remove','agenda:a',10000,false,0)
  await adjustments.save('keep','agenda:b',20000,false,0)
  const scopedAdjustments={deleteForCompany:async(...args)=>{assert.equal(transaction,true);return adjustments.deleteForCompany(...args)}}
  const next=(_req,_res,next)=>next()
  const route=load('routes/company-deletion.js',{'../lib/store':store,'../lib/audit-v2-db':{isEnabled:()=>true},'../lib/revenue-adjustments-db':scopedAdjustments,'../lib/r2-storage':{isConfigured:()=>false},'../middleware/auth':{requireAuth:next,requireMaster:next,requirePermission:()=>next}})
  if(fail){
   await assert.rejects(route.deleteCompanyCompletely('remove',{id:'master'}),/simulated_failure_after_adjustments/)
   assert.equal((await adjustments.list('remove')).size,1)
   assert.equal((await pg.query("SELECT id FROM app_quotes_v2 WHERE company_id='remove'")).rows.length,1)
   assert.equal(snapshot.companies.length,2)
  }else{
   const result=await route.deleteCompanyCompletely('remove',{id:'master'})
   assert.equal(result.v2_deleted.revenue_adjustments,1)
   assert.equal((await adjustments.list('remove')).size,0)
   assert.equal(snapshot.companies.length,1)
   assert.equal(snapshot.companies[0].id,'keep')
  }
  assert.equal((await adjustments.list('keep')).size,1)
  for(const table of tables)assert.equal((await pg.query('SELECT id FROM '+table+" WHERE company_id='keep'")).rows.length,1)
  assert.equal(transaction,false)
 }finally{await pg.close()}
}
test('exclusão completa da empresa remove ajustes e preserva outra empresa',()=>scenario(false))
test('falha após limpar ajustes desfaz toda a exclusão da empresa',()=>scenario(true))
