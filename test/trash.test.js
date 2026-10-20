'use strict'
const {test,before,after}=require('node:test')
const assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm'),path=require('path')
const {PGlite}=require('@electric-sql/pglite')
let pg,pool,trash,quotes,agenda,financial,models,catalog,store
const cache={}
function load(file){
 const full=path.resolve(__dirname,'../src',file)
 if(cache[full])return cache[full].exports
 const mod={exports:{}};cache[full]=mod
 vm.runInNewContext(fs.readFileSync(full,'utf8'),{module:mod,require:n=>{
   if(n==='./store'||n==='../lib/store')return store
   if(n==='./r2-storage')return {isConfigured:()=>false}
   return n.startsWith('.')?load(path.relative(path.join(__dirname,'../src'),path.resolve(path.dirname(full),n+'.js'))):require(n)
 },console,Date,Intl,Buffer,setTimeout,clearTimeout,setInterval,clearInterval},{filename:full})
 return mod.exports
}
const normalize=x=>JSON.parse(JSON.stringify(x))
async function q(s,p=[]){return pool.query(s,p)}
async function row(table,id,c='a'){return (await q(`SELECT * FROM ${table} WHERE company_id=$1 AND id=$2`,[c,id])).rows[0]}
async function entry(kind,key,c='a'){return (await q('SELECT * FROM app_trash_v1 WHERE company_id=$1 AND kind=$2 AND record_key=$3',[c,kind,key])).rows[0]}
async function restore(item,c='a'){return trash.transaction(pool,client=>trash.restore(client,c,item.id))}
before(async()=>{
 pg=new PGlite();pool={query:async(s,p=[])=>{const r=p.length?await pg.query(s,p):(await pg.exec(s)).at(-1);return {...r,rowCount:r.affectedRows??r.rows?.length??0}},connect:async()=>({...pool,release(){}})}
 store={_pg:{pool},readStore:()=>({companies:[{id:'a'},{id:'b'}]})}
 trash=load('lib/trash-db.js');models=load('lib/models-v2-db.js');quotes=load('lib/quotes-v2-db.js');agenda=load('lib/agenda-v2-db.js');financial=load('lib/financial-v2-db.js');catalog=load('lib/personalization-v2-db.js')
 for(const db of [models,quotes,agenda,financial,catalog])await db.ensureSchema()
 await q("CREATE TABLE app_audit_logs_v2(id text,company_id text,action text,message text,created_at timestamptz DEFAULT NOW())")
 await trash.ensureSchema(pool)
})
after(async()=>pg?.close())
test('excluir e recuperar pedido mantém modelos, itens, Agenda e contas sem duplicar',async()=>{
 await q("INSERT INTO app_quotes_v2(id,company_id,cliente,status,total_cents) VALUES('sale','a','Cliente A','pedido',153077)")
 await q("INSERT INTO app_quote_models_v2(id,quote_id,company_id,model_name,subtotal_cents) VALUES('model-sale','sale','a','Sofá',153077)")
 await q("INSERT INTO app_quote_model_items_v2(quote_model_id,company_id,name) VALUES('model-sale','a','Adicional')")
 await q("INSERT INTO app_agenda_orders_v2(id,company_id,cliente,source_quote_id,payload) VALUES('agenda-sale','a','Cliente A','sale','{\"valor\":1530.77}')")
 await q("INSERT INTO app_financial_entries_v2(id,company_id,tipo,valor) VALUES('bill-sale','a','receber',500)")
 assert.equal(await quotes.deleteQuote('a','sale'),true)
 assert.equal(await row('app_quotes_v2','sale'),undefined);assert.equal(await row('app_agenda_orders_v2','agenda-sale'),undefined)
 const item=await entry('quote','sale');assert.equal(item.snapshot.models.length,1);assert.equal(item.snapshot.model_items.length,1);assert.equal(item.snapshot.agenda.length,1)
 await restore(item)
 assert.equal((await row('app_quotes_v2','sale')).total_cents,153077)
 assert.equal((await row('app_agenda_orders_v2','agenda-sale')).source_quote_id,'sale')
 assert.equal((await q("SELECT count(*)::int n FROM app_financial_entries_v2 WHERE id='bill-sale'")).rows[0].n,1)
 assert.equal(await entry('quote','sale'),undefined)
 await assert.rejects(restore(item),e=>e.status===404)
})
test('isolamento de empresa impede recuperar ou consultar exclusão de outra conta',async()=>{
 await q("INSERT INTO app_financial_entries_v2(id,company_id,tipo,valor) VALUES('private','b','receber',1000)")
 await financial.deleteEntry('b','private');const item=await entry('financial','private','b')
 await assert.rejects(restore(item,'a'),e=>e.status===404)
 assert.equal((await trash.list('a','financeiro')).items.length,0)
 assert.equal((await trash.list('b','financeiro')).items.length,1)
})
test('conflito de identificador desfaz a recuperação inteira e preserva a lixeira',async()=>{
 await q("INSERT INTO app_quotes_v2(id,company_id,cliente) VALUES('conflict-sale','a','Original')")
 await q("INSERT INTO app_quote_models_v2(id,quote_id,company_id,model_name) VALUES('conflict-child','conflict-sale','a','Original')")
 await quotes.deleteQuote('a','conflict-sale');const item=await entry('quote','conflict-sale')
 await q("INSERT INTO app_quote_models_v2(id,quote_id,company_id,model_name) VALUES('conflict-child','sale','a','Existente')")
 await assert.rejects(restore(item),e=>e.code==='23505')
 assert.equal(await row('app_quotes_v2','conflict-sale'),undefined);assert.ok(await entry('quote','conflict-sale'))
 assert.equal((await row('app_quote_models_v2','conflict-child')).model_name,'Existente')
})
test('falha ao arquivar impede exclusão do registro original',async()=>{
 await q("INSERT INTO app_financial_entries_v2(id,company_id,tipo) VALUES('failure','a','pagar')")
 const original=trash.archive
 // Exercita falha real de persistência, não um retorno artificial de sucesso.
 await q('ALTER TABLE app_trash_v1 RENAME TO unavailable_trash')
 try{await assert.rejects(financial.deleteEntry('a','failure'));assert.ok(await row('app_financial_entries_v2','failure'))}
 finally{await q('ALTER TABLE unavailable_trash RENAME TO app_trash_v1')}
 assert.equal(trash.archive,original)
})
test('modelo só volta ao Catálogo quando recuperado e é apagado ao expirar',async()=>{
 await q("INSERT INTO app_models_v2(id,company_id,name) VALUES('catalog-model','a','Modelo')")
 await models.deactivateModel('a','catalog-model');assert.equal((await row('app_models_v2','catalog-model')).active,false)
 await restore(await entry('model','catalog-model'));assert.equal((await row('app_models_v2','catalog-model')).active,true)
 await models.deactivateModel('a','catalog-model')
 await q("UPDATE app_trash_v1 SET expires_at=NOW()-INTERVAL '1 second' WHERE kind='model' AND company_id='a'")
 assert.equal((await trash.list('a','catalogo')).items.length,0)
 await trash.purgeExpired(pool);assert.equal(await row('app_models_v2','catalog-model'),undefined)
})
test('exclusão do material é arquivada atomicamente, sem incluir empresa removida',async()=>{
 const material={id:123,company_id:'a',name:'Espuma',unit:'metro',price_cents:700}
 const before={companies:[{id:'a'}],materials:[material]}
 await trash.transaction(pool,c=>trash.captureStoreDeletes(c,before,{companies:[{id:'a'}],materials:[]}))
 assert.equal((await entry('legacy:materials','123')).snapshot.row.price_cents,700)
 await trash.transaction(pool,c=>trash.captureStoreDeletes(c,{companies:[{id:'b'}],materials:[{...material,id:456,company_id:'b'}]},{companies:[],materials:[]}))
 assert.equal(await entry('legacy:materials','456','b'),undefined)
})
test('adicional excluído é recuperado sem apagar alterações dos outros itens',async()=>{
 const old={items:[{id:'one',name:'Pé',category:'pe',unit:'unidade',price_cents:500},{id:'two',name:'Braço',category:'outro',unit:'unidade',price_cents:200}],albums:[],groups:[]}
 await catalog.saveCatalog('a',old,0)
 await catalog.saveCatalog('a',{...old,items:[{...old.items[1],price_cents:999}]},1)
 await restore(await entry('catalog:items','one'))
 const result=(await q("SELECT * FROM app_personalization_catalog_v2 WHERE company_id='a'")).rows[0]
 assert.equal(result.items.find(r=>r.id==='two').price_cents,999);assert.equal(result.items.find(r=>r.id==='one').price_cents,500)
 assert.equal(result.revision,3)
})
test('álbum e referência são recuperados juntos; tecido pode ser recuperado separadamente',async()=>{
 const old={items:[{id:'album-ref',name:'Álbum A',isAlbum:true,category:'tecido'}],albums:[{id:'album-a',nome:'Álbum A',itens:[{nome:'Linho',codigo:'01',valor_cents:1000},{nome:'Veludo',codigo:'02',valor_cents:2000}]}],groups:[]}
 await catalog.saveCatalog('album-company',old,0)
 await catalog.saveCatalog('album-company',{items:[],albums:[],groups:[]},1)
 const archived=(await q("SELECT * FROM app_trash_v1 WHERE company_id='album-company'")).rows
 assert.equal(archived.length,1);await restore(archived[0],'album-company')
 let result=(await q("SELECT * FROM app_personalization_catalog_v2 WHERE company_id='album-company'")).rows[0]
 assert.equal(result.items.length,1);assert.equal(result.albums[0].itens.length,2)
 const next=normalize(result);next.albums[0].itens.splice(0,1)
 await catalog.saveCatalog('album-company',next,result.revision)
 const item=(await q("SELECT * FROM app_trash_v1 WHERE company_id='album-company' AND kind='catalog:album-item'")).rows[0]
 await restore(item,'album-company')
 result=(await q("SELECT * FROM app_personalization_catalog_v2 WHERE company_id='album-company'")).rows[0]
 assert.equal(result.albums[0].itens.length,2)
})
test('exclusão do histórico permite recuperar visibilidade sem reabrir conta paga',async()=>{
 await q("INSERT INTO app_financial_entries_v2(id,company_id,tipo,status,valor,payload) VALUES('paid','a','pagar','pago',900,'{\"other\":123}')")
 await financial.removeEntryFromHistory('a','paid');const item=await entry('financial-history','paid')
 await financial.removeEntryFromHistory('a','paid');assert.equal((await entry('financial-history','paid')).id,item.id)
 await restore(item);const result=await row('app_financial_entries_v2','paid')
 assert.equal(result.status,'pago');assert.equal(result.payload.other,123);assert.equal(result.payload.history_removed_at,undefined)
})
test('cancelar agendamento preserva venda e permite recuperar sem ocupar vaga já usada',async()=>{
 await q("INSERT INTO app_agenda_blocos_v2(company_id,id,qtd_vagas) VALUES('a','one-slot',1)")
 await q("INSERT INTO app_agenda_orders_v2(company_id,id,bloco_id,source_quote_id,prod_date,ent_date) VALUES('a','schedule','one-slot','sale','2026-10-20','2026-10-25')")
 await agenda.updateOrder('a','schedule',{bloco_id:null,status:'pendente'})
 const item=await entry('agenda-unschedule','schedule');assert.ok(item);assert.ok(await row('app_quotes_v2','sale'))
 await q("INSERT INTO app_agenda_orders_v2(company_id,id,bloco_id) VALUES('a','new-occupant','one-slot')")
 await restore(item);assert.equal((await row('app_agenda_orders_v2','schedule')).bloco_id,null)
 assert.equal((await row('app_quotes_v2','sale')).payload_meta.agenda_status,'pendente')
})
test('recuperar agendamento alterado depois da exclusão falha sem sobrescrever',async()=>{
 await q("INSERT INTO app_agenda_orders_v2(company_id,id,bloco_id) VALUES('a','edited-schedule','one-slot')")
 await agenda.updateOrder('a','edited-schedule',{bloco_id:null})
 const item=await entry('agenda-unschedule','edited-schedule')
 await q("UPDATE app_agenda_orders_v2 SET cliente='Novo nome',updated_at=updated_at+INTERVAL '1 second' WHERE id='edited-schedule'")
 await assert.rejects(restore(item),e=>e.status===409)
 assert.equal((await row('app_agenda_orders_v2','edited-schedule')).cliente,'Novo nome')
})
test('bloco e seus pedidos são recuperados como conjunto',async()=>{
 await q("INSERT INTO app_agenda_blocos_v2(company_id,id,qtd_vagas) VALUES('a','block-restore',2)")
 await q("INSERT INTO app_agenda_orders_v2(company_id,id,bloco_id) VALUES('a','block-order','block-restore')")
 await agenda.deleteBlock('a','block-restore');assert.equal(await row('app_agenda_orders_v2','block-order'),undefined)
 await restore(await entry('block','block-restore'));assert.equal((await row('app_agenda_orders_v2','block-order')).bloco_id,'block-restore')
})
test('expiração ocorre em 30 dias por item e não permite recuperar item vencido',async()=>{
 const row={id:'old',company_id:'a',cliente:'Antigo'}
 await trash.archive(pool,'a','agenda','agenda','old',{row},new Date(Date.now()-30*86400000-1000).toISOString())
 const item=await entry('agenda','old');assert.ok(item);await assert.rejects(restore(item),e=>e.status===404)
 assert.ok(!(await trash.list('a','agenda')).items.some(r=>r.id===item.id))
 await trash.purgeExpired(pool);assert.equal(await entry('agenda','old'),undefined)
})
test('importação recuperada não reativa pedido, ignora financeiro e não duplica em retry',async()=>{
 const quote={id:'backup-order',company_id:'a',cliente:'Recuperado',status:'pedido',total_cents:10000}
 await q("INSERT INTO app_audit_logs_v2(id,company_id,action,message) VALUES('event','a','quote.delete','Orçamento removido: backup-order')")
 const bundle={format:'estofaria-recovery-bundle',version:1,company_id:'a',records:[{requested_id:quote.id,quote,models:[],model_items:[],agenda:[],financial:[{id:'do-not-insert'}]}]}
 assert.equal((await trash.transaction(pool,c=>trash.importRecovery(c,'a',bundle))).imported,1)
 assert.equal(await row('app_quotes_v2','backup-order'),undefined)
 assert.equal((await trash.transaction(pool,c=>trash.importRecovery(c,'a',bundle))).imported,0)
 await restore(await entry('quote','backup-order'))
 assert.equal((await row('app_quotes_v2','backup-order')).total_cents,10000)
 assert.equal(await row('app_financial_entries_v2','do-not-insert'),undefined)
 await assert.rejects(trash.transaction(pool,c=>trash.importRecovery(c,'b',bundle)),e=>e.status===400)
})
test('exclusão de empresa remove sua lixeira e preserva a outra',async()=>{
 await trash.deleteCompany(pool,'a');assert.equal((await q("SELECT count(*)::int n FROM app_trash_v1 WHERE company_id='a'")).rows[0].n,0)
 assert.ok((await entry('financial','private','b')))
})

// Optional local validation of a user-supplied recovery bundle; never commit customer fixtures.
test('arquivo de recuperação fornecido importa e recupera todos os pedidos sem duplicar financeiro',{skip:!process.env.RECOVERY_BUNDLE_PATH},async()=>{
 const bundle=JSON.parse(fs.readFileSync(process.env.RECOVERY_BUNDLE_PATH,'utf8')),company=bundle.company_id
 for(const event of bundle.deletion_events)await q('INSERT INTO app_audit_logs_v2(id,company_id,action,message,created_at) VALUES($1,$2,$3,$4,$5)',[event.id,company,event.action,event.message,event.created_at])
 const bills=bundle.records.flatMap(r=>r.financial||[])
 for(const f of bills)await q('INSERT INTO app_financial_entries_v2(company_id,id,tipo,status,valor,payload)VALUES($1,$2,$3,$4,$5,$6)',[company,f.id,f.tipo,f.status,f.valor,JSON.stringify(f.payload)])
 assert.equal((await trash.transaction(pool,c=>trash.importRecovery(c,company,bundle))).imported,bundle.records.length)
 assert.equal((await q('SELECT COUNT(*)::int n FROM app_quotes_v2 WHERE company_id=$1',[company])).rows[0].n,0)
 const archived=(await q('SELECT * FROM app_trash_v1 WHERE company_id=$1',[company])).rows
 for(const item of archived)await restore(item,company)
 const recovered=(await q('SELECT * FROM app_quotes_v2 WHERE company_id=$1',[company])).rows
 assert.equal(recovered.length,bundle.records.length)
 assert.equal(recovered.reduce((n,r)=>n+Number(r.total_cents),0),bundle.records.reduce((n,r)=>n+Number(r.quote.total_cents),0))
 assert.equal((await q('SELECT COUNT(*)::int n FROM app_financial_entries_v2 WHERE company_id=$1',[company])).rows[0].n,bills.length)
 assert.equal((await q('SELECT COUNT(*)::int n FROM app_trash_v1 WHERE company_id=$1',[company])).rows[0].n,0)
})
