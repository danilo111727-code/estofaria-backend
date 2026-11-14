'use strict'
const {test,before,after}=require('node:test')
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path')
let pg,pool,store,quotes,trash,summary,failPattern,admin,schema
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
before(async()=>{
 const url=process.env.ORDER_FINANCIAL_TEST_DATABASE_URL
 if(url){
  const {Pool}=require('pg');schema='order_receivables_'+require('crypto').randomBytes(6).toString('hex')
  admin=new Pool({connectionString:url});await admin.query('CREATE SCHEMA '+schema)
  pg=new Pool({connectionString:url,options:'-c search_path='+schema})
  pool={query:(...a)=>pg.query(...a),connect:async()=>{
   const c=await pg.connect();return {release:()=>c.release(),query:(s,p=[])=>{
    if(failPattern?.test(s)){failPattern=null;return c.query('SELECT 1/0')}
    return c.query(s,p)
   }}
  }}
 }else{
  const {PGlite}=require('@electric-sql/pglite');pg=new PGlite()
  const query=async(s,p=[])=>{const r=p.length?await pg.query(s,p):(await pg.exec(s)).at(-1);return {...r,rowCount:r.affectedRows??r.rows?.length??0}}
  pool={query,connect:async()=>({release(){},query:(s,p=[])=>{
   if(failPattern?.test(s)){failPattern=null;return query('SELECT 1/0')}
   return query(s,p)
  }})}
 }
 store={_pg:{pool},readStore:()=>({companies:[{id:'a'},{id:'b'}]})}
 quotes=load('lib/quotes-v2-db.js');trash=load('lib/trash-db.js');summary=load('lib/dashboard-v2-db.js')
 for(const file of ['lib/models-v2-db.js','lib/quotes-v2-db.js','lib/agenda-v2-db.js','lib/financial-v2-db.js'])await load(file).ensureSchema()
 await pool.query('CREATE TABLE app_audit_logs_v2(id text,company_id text,action text,message text,created_at timestamptz DEFAULT NOW())')
 await trash.ensureSchema(pool)
})
after(async()=>{if(admin){await pg.end();await admin.query('DROP SCHEMA '+schema+' CASCADE');await admin.end()}else await pg?.close()})
const q=(s,p=[])=>pool.query(s,p)
async function sale(id,{legacy=null}={}){
 await q("INSERT INTO app_quotes_v2(id,company_id,legacy_id,cliente,status,total_cents) VALUES($1,'a',$2,$1,'pedido',100000)",[id,legacy])
 await q("INSERT INTO app_agenda_orders_v2(id,company_id,cliente,source_quote_id,payload) VALUES($1,'a',$2,$2,'{\"valor\":1000}')",['agenda-'+id,id])
}
async function bill(id,ref,{company='a',status='pendente',tipo='receber',amount=100,source='order',payload={}}={}){
 await q('INSERT INTO app_financial_entries_v2(id,company_id,tipo,status,valor,payload)VALUES($1,$2,$3,$4,$5,$6::jsonb)',[id,company,tipo,status,amount,JSON.stringify({financial_source:source,...(ref?{quote_id:ref}:{}),...payload})])
}
async function one(table,id,company='a'){return (await q(`SELECT * FROM ${table} WHERE company_id=$1 AND id=$2`,[company,id])).rows[0]}
async function archived(id){return (await q("SELECT * FROM app_trash_v1 WHERE company_id='a' AND kind='quote' AND record_key=$1",[id])).rows[0]}
async function restore(item,company='a'){return trash.transaction(pool,c=>trash.restore(c,company,item.id))}
test('quatro pedidos excluídos deixam de inflar o saldo e preservam os três existentes',async()=>{
 // Valores fictícios; nenhum dado financeiro de cliente é incluído no código.
 const amounts=[125.25,200,320.5,454.25,111,222,333]
 for(let i=0;i<amounts.length;i++){await sale('fixture-'+i);await bill('balance-'+i,'fixture-'+i,{amount:amounts[i]})}
 const total=async()=>Number((await q("SELECT SUM(valor) AS total FROM app_financial_entries_v2 WHERE company_id='a' AND tipo='receber' AND status='pendente'")).rows[0].total)
 assert.equal(await total(),1766)
 for(let i=0;i<4;i++)assert.equal(await quotes.deleteQuote('a','fixture-'+i),true)
 assert.equal(await total(),666)
 assert.equal((await summary.getSummary('a')).pedidos,3)
 assert.equal((await summary.getSummary('a')).pedidos_ano,3)
 for(let i=0;i<4;i++){assert.equal(await one('app_quotes_v2','fixture-'+i),undefined);assert.equal(await one('app_agenda_orders_v2','agenda-fixture-'+i),undefined);assert.equal((await archived('fixture-'+i)).snapshot.financial.length,1)}
})
test('preserva recebido, contas a pagar, manuais, outro pedido e outra empresa',async()=>{
 await sale('preserve')
 await bill('remove-due','preserve')
 await bill('keep-received','preserve',{status:'recebido',payload:{parcela_index:1}})
 await bill('keep-payable','preserve',{tipo:'pagar'})
 await bill('keep-manual','preserve',{source:'manual'})
 await bill('keep-unlinked',null)
 await bill('keep-other','different')
 await bill('keep-foreign','preserve',{company:'b'})
 await quotes.deleteQuote('a','preserve')
 assert.equal(await one('app_financial_entries_v2','remove-due'),undefined)
 for(const id of ['keep-received','keep-payable','keep-manual','keep-unlinked','keep-other'])assert.ok(await one('app_financial_entries_v2',id))
 assert.ok(await one('app_financial_entries_v2','keep-foreign','b'))
 const receipt=await one('app_financial_entries_v2','keep-received');assert.equal(receipt.payload.order_deleted.quote_id,'preserve')
 for(const id of ['keep-payable','keep-manual','keep-unlinked','keep-other'])assert.equal((await one('app_financial_entries_v2',id)).payload.order_deleted,undefined)
 assert.equal((await one('app_financial_entries_v2','keep-foreign','b')).payload.order_deleted,undefined)
})
test('aceita vínculo legado e só pela Agenda; vínculo explícito de outro pedido prevalece',async()=>{
 await sale('aliases',{legacy:'legacy-alias'})
 await bill('legacy-balance',null,{payload:{source_quote_id:'legacy-alias'}})
 await bill('agenda-balance',null,{payload:{agenda_order_id:'agenda-aliases'}})
 await bill('conflicting-balance','different',{payload:{agenda_order_id:'agenda-aliases'}})
 await quotes.deleteQuote('a','aliases')
 assert.equal(await one('app_financial_entries_v2','legacy-balance'),undefined)
 assert.equal(await one('app_financial_entries_v2','agenda-balance'),undefined)
 assert.ok(await one('app_financial_entries_v2','conflicting-balance'))
})
test('pedido inexistente não apaga lançamento com referência órfã',async()=>{
 await bill('existing-orphan','does-not-exist')
 assert.equal(await quotes.deleteQuote('a','does-not-exist'),false)
 assert.ok(await one('app_financial_entries_v2','existing-orphan'))
})
for(const [id,pattern] of [['financial-failure',/DELETE FROM app_financial_entries_v2/],['quote-failure',/DELETE FROM app_quotes_v2/]]){
 test('falha SQL em '+id+' desfaz pedido, Agenda, saldo e lixeira juntos',async()=>{
  await sale(id);await bill('due-'+id,id);failPattern=pattern
  await assert.rejects(quotes.deleteQuote('a',id))
  assert.ok(await one('app_quotes_v2',id));assert.ok(await one('app_agenda_orders_v2','agenda-'+id));assert.ok(await one('app_financial_entries_v2','due-'+id));assert.equal(await archived(id),undefined)
 })
}
test('recupera o saldo com o pedido uma única vez, preservando valores recebidos',async()=>{
 await sale('restore-sale');await bill('restore-due','restore-sale',{payload:{parcela_index:2}});await bill('restore-received','restore-sale',{status:'recebido',payload:{parcela_index:1}})
 const before=await one('app_financial_entries_v2','restore-received')
 await quotes.deleteQuote('a','restore-sale');const item=await archived('restore-sale')
 const deleted=await one('app_financial_entries_v2','restore-received');assert.equal(deleted.payload.order_deleted.quote_id,'restore-sale');assert.equal(deleted.valor,before.valor);assert.equal(String(deleted.created_at),String(before.created_at));assert.equal(String(deleted.updated_at),String(before.updated_at));assert.equal(deleted.data_vencimento,before.data_vencimento)
 await restore(item)
 assert.ok(await one('app_quotes_v2','restore-sale'));assert.ok(await one('app_agenda_orders_v2','agenda-restore-sale'))
 assert.equal((await one('app_financial_entries_v2','restore-due')).status,'pendente')
 assert.equal((await one('app_financial_entries_v2','restore-received')).status,'recebido')
 assert.equal((await one('app_financial_entries_v2','restore-received')).payload.order_deleted,undefined)
 await assert.rejects(restore(item),e=>e.status===404)
 assert.equal(Number((await q("SELECT COUNT(*) AS n FROM app_financial_entries_v2 WHERE id='restore-due'")).rows[0].n),1)
})
test('saldo equivalente recriado impede recuperação duplicada e desfaz o pedido recuperado',async()=>{
 await sale('restore-conflict');await bill('conflict-original','restore-conflict')
 await quotes.deleteQuote('a','restore-conflict');const item=await archived('restore-conflict')
 await bill('conflict-recreated','restore-conflict')
 await assert.rejects(restore(item),e=>e.status===409)
 assert.equal(await one('app_quotes_v2','restore-conflict'),undefined);assert.equal(await one('app_agenda_orders_v2','agenda-restore-conflict'),undefined)
 assert.equal(await one('app_financial_entries_v2','conflict-original'),undefined);assert.ok(await one('app_financial_entries_v2','conflict-recreated'));assert.ok(await archived('restore-conflict'))
})
test('snapshot antigo sem contas continua recuperável e outra empresa não pode recuperar',async()=>{
 await sale('old-trash');await quotes.deleteQuote('a','old-trash');const item=await archived('old-trash')
 await q("UPDATE app_trash_v1 SET snapshot=snapshot-'financial' WHERE id=$1",[item.id])
 await assert.rejects(restore(item,'b'),e=>e.status===404);await restore(item)
 assert.ok(await one('app_quotes_v2','old-trash'))
})
test('lixeira conflitante impede excluir saldo sem arquivar sua cópia atual',async()=>{
 await sale('archive-conflict');await quotes.deleteQuote('a','archive-conflict')
 await sale('archive-conflict');await bill('archive-conflict-due','archive-conflict')
 await assert.rejects(quotes.deleteQuote('a','archive-conflict'),e=>e.status===409)
 assert.ok(await one('app_quotes_v2','archive-conflict'));assert.ok(await one('app_financial_entries_v2','archive-conflict-due'))
})
test('baixa concorrente confirmada antes da exclusão preserva o recebimento',{skip:!process.env.ORDER_FINANCIAL_TEST_DATABASE_URL},async()=>{
 await sale('concurrent');await bill('concurrent-due','concurrent')
 const c=await pg.connect();await c.query('BEGIN');await c.query("UPDATE app_financial_entries_v2 SET status='recebido' WHERE company_id='a' AND id='concurrent-due'")
 const deletion=quotes.deleteQuote('a','concurrent')
 await new Promise(resolve=>setTimeout(resolve,50));await c.query('COMMIT');c.release();await deletion
 assert.equal((await one('app_financial_entries_v2','concurrent-due')).status,'recebido')
 assert.equal((await archived('concurrent')).snapshot.financial.length,0)
 assert.equal((await one('app_financial_entries_v2','concurrent-due')).payload.order_deleted.quote_id,'concurrent')
})

test('falha de exclusão não deixa marca de pedido excluído no recebido',async()=>{
 await sale('marker-rollback');await bill('receipt-rollback','marker-rollback',{status:'recebido'})
 failPattern=/DELETE FROM app_quotes_v2/;await assert.rejects(quotes.deleteQuote('a','marker-rollback'))
 assert.equal((await one('app_financial_entries_v2','receipt-rollback')).payload.order_deleted,undefined)
 assert.ok(await one('app_quotes_v2','marker-rollback'))
})
test('novo ciclo de exclusão e recuperação retira e recoloca a identificação',async()=>{
 await sale('marker-cycle');await bill('receipt-cycle','marker-cycle',{status:'recebido'})
 for(let n=0;n<2;n++){
  await quotes.deleteQuote('a','marker-cycle')
  assert.equal((await one('app_financial_entries_v2','receipt-cycle')).payload.order_deleted.quote_id,'marker-cycle')
  await restore(await archived('marker-cycle'))
  assert.equal((await one('app_financial_entries_v2','receipt-cycle')).payload.order_deleted,undefined)
 }
})
