// Integration coverage: execute the real history operation and trash archive in PostgreSQL.
'use strict'
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path')
const {PGlite}=require('@electric-sql/pglite')
let pg,pool,db,trash,fail=false
function load(file,requires){const m={exports:{}};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/lib',file),'utf8'),{module:m,require:n=>n in requires?requires[n]:require(n),console,Date,Intl});return m.exports}
before(async()=>{
 pg=new PGlite();pool={query:async(s,p=[])=>{if(fail&&s.startsWith('UPDATE app_agenda_orders_v2'))throw Error('database unavailable');return p.length?pg.query(s,p):(await pg.exec(s)).at(-1)},connect:async()=>({...pool,release(){}})}
 trash=load('trash-db.js',{'./store':{_pg:{pool}}});await trash.ensureSchema(pool)
 db=load('agenda-v2-db.js',{'./store':{_pg:{pool}},'./trash-db':trash});await db.ensureSchema()
 await pg.exec("INSERT INTO app_agenda_orders_v2(company_id,id,status,payload) VALUES('a','record','entregue','{\"valor\":123}'),('a','active','pendente','{}'),('a','failure','entregue','{}')")
})
after(async()=>pg?.close())
test('Excluir do histórico preserva todos os campos e arquiva o estado anterior',async()=>{
 const before=(await pg.query("SELECT * FROM app_agenda_orders_v2 WHERE company_id='a' AND id='record'")).rows[0]
 assert.equal(await db.removeOrderFromHistory('a','record'),true)
 const after=(await pg.query("SELECT * FROM app_agenda_orders_v2 WHERE company_id='a' AND id='record'")).rows[0]
 assert.ok(after.payload.history_removed_at);delete after.payload.history_removed_at;assert.deepEqual(after,before)
 const item=(await pg.query("SELECT * FROM app_trash_v1 WHERE company_id='a' AND kind='agenda-history'")).rows[0]
 assert.equal(item.snapshot.row.status,'entregue')
 await db.removeOrderFromHistory('a','record');assert.equal((await pg.query("SELECT count(*)::int n FROM app_trash_v1")).rows[0].n,1)
})
test('Registro ausente, ativo ou de outra empresa não é removido do histórico',async()=>{
 assert.equal(await db.removeOrderFromHistory('b','record'),false);assert.equal(await db.removeOrderFromHistory('a','absent'),false);assert.equal(await db.removeOrderFromHistory('a','active'),false)
})
test('Falha depois do arquivamento desfaz toda a alteração',async()=>{
 fail=true;try{await assert.rejects(db.removeOrderFromHistory('a','failure'),/database unavailable/)}finally{fail=false}
 assert.equal((await pg.query("SELECT payload FROM app_agenda_orders_v2 WHERE id='failure'")).rows[0].payload.history_removed_at,undefined)
 assert.equal((await pg.query("SELECT count(*)::int n FROM app_trash_v1 WHERE record_key='failure'")).rows[0].n,0)
})
