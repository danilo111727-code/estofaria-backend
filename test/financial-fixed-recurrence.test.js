'use strict'
const {test,before,beforeEach,after}=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm')
const {randomUUID}=require('node:crypto')
const connection=process.env.FINANCIAL_TEST_DATABASE_URL
if(!connection){test('PostgreSQL isolado obrigatório para teste de recorrência',{skip:'Defina FINANCIAL_TEST_DATABASE_URL para o banco descartável local.'},()=>{});return}
const target=new URL(connection)
if(!['127.0.0.1','localhost'].includes(target.hostname)||target.pathname!=='/financial_fixed_test')throw Error('Os testes só executam no PostgreSQL local descartável financial_fixed_test.')
const {Pool}=require('pg')
const pool=new Pool({connectionString:connection,max:16})
let fault=null
const adapter={query:(...args)=>pool.query(...args),connect:async()=>{
 const client=await pool.connect()
 return {release:()=>client.release(),query:async(sql,args)=>{if(fault&&fault(String(sql),args)){fault=null;throw Error('injected database failure')}return client.query(sql,args)}}
}}
const context={module:{exports:{}},require:name=>name==='./store'?{_pg:{pool:adapter}}:name==='./trash-db'?{}:name==='./financial-fixed-recurrence'?require('../src/lib/financial-fixed-recurrence'):require(name)}
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/lib/financial-v2-db.js'),'utf8'),context)
const db=context.module.exports
const company='qa_fixed_company'
function fixed(overrides={}){return {tipo:'pagar',descricao:'QA conta fixa',fornecedor:'QA fornecedor',categoria:'QA',cliente:'',valor:100,dataVencimento:'2026-01-31',formaPagamento:'PIX',lancamento_tipo:'fixo',recorrencia_id:randomUUID(),...overrides}}
const list=()=>db.listEntries(company)
const pay=item=>db.updateEntry(company,item.id,{status:item.tipo==='receber'?'recebido':'pago'})
before(async()=>db.ensureSchema())
beforeEach(async()=>{fault=null;await pool.query('TRUNCATE app_financial_entries_v2')})
after(async()=>pool.end())
test('baixa e próxima mensalidade persistem juntas com dados preservados',async()=>{
 const item=await db.createEntry(company,fixed());const paid=await pay(item);const rows=await list();assert.equal(rows.length,2);assert.equal(paid.status,'pago')
 const next=rows.find(r=>r.id!==item.id);assert.equal(next.status,'pendente');assert.equal(next.dataVencimento,'2026-02-28');assert.equal(next.valor,100);assert.equal(next.fornecedor,'QA fornecedor');assert.equal(next.categoria,'QA');assert.equal(next.recorrencia_gerada_de,item.id);assert.equal(next.recorrencia_id,item.recorrencia_id)
})
test('recebimento fixo usa a mesma transação',async()=>{
 const item=await db.createEntry(company,fixed({tipo:'receber',cliente:'QA cliente'}));await pay(item);const rows=await list();assert.equal(rows.filter(r=>r.status==='recebido').length,1);assert.equal(rows.filter(r=>r.status==='pendente').length,1);assert.equal(rows.find(r=>r.id!==item.id).cliente,'QA cliente')
})
test('oito baixas simultâneas em conexões diferentes não duplicam a próxima conta',async()=>{
 const item=await db.createEntry(company,fixed());await Promise.all(Array.from({length:8},()=>pay(item)));const rows=await list();assert.equal(rows.length,2);assert.equal(rows.filter(r=>r.status==='pago').length,1)
})
test('POST repetido com mesmo grupo e vencimento é idempotente',async()=>{
 const body=fixed();const rows=await Promise.all(Array.from({length:8},()=>db.createEntry(company,body)));assert.equal(new Set(rows.map(r=>r.id)).size,1);assert.equal((await list()).length,1)
})
test('próxima conta criada pela versão anterior é reaproveitada',async()=>{
 const body=fixed();const item=await db.createEntry(company,body);const existing=await db.createEntry(company,{...body,dataVencimento:'2026-02-28'});const paid=await pay(item);assert.equal((await list()).length,2);assert.equal(paid.recorrencia_proxima_id,existing.id)
})
test('falha no INSERT da próxima competência desfaz a baixa',async()=>{
 const item=await db.createEntry(company,fixed());fault=sql=>sql.includes('INSERT INTO app_financial_entries_v2');await assert.rejects(pay(item),/injected/);const rows=await list();assert.equal(rows.length,1);assert.equal(rows[0].status,'pendente')
})
test('falha no UPDATE não cria próxima mensalidade',async()=>{
 const item=await db.createEntry(company,fixed());fault=sql=>sql.startsWith('UPDATE app_financial_entries_v2');await assert.rejects(pay(item),/injected/);assert.equal((await list()).length,1);assert.equal((await list())[0].status,'pendente')
})
test('repetir baixa após perder a resposta não avança outro mês',async()=>{
 const item=await db.createEntry(company,fixed());const first=await pay(item);const second=await pay(item);assert.equal(first.recorrencia_proxima_id,second.recorrencia_proxima_id);assert.equal((await list()).length,2)
})
test('dia 31 retorna em março depois de fevereiro',async()=>{
 const item=await db.createEntry(company,fixed());await pay(item);await pay((await list()).find(r=>r.status==='pendente'));assert.equal((await list()).find(r=>r.status==='pendente').dataVencimento,'2026-03-31')
})
test('ano bissexto e virada de ano',async()=>{
 const leap=await db.createEntry(company,fixed({dataVencimento:'2028-01-31'}));await pay(leap);assert.ok((await list()).some(r=>r.dataVencimento==='2028-02-29'))
 const year=await db.createEntry(company,fixed({dataVencimento:'2026-12-31'}));await pay(year);assert.ok((await list()).some(r=>r.dataVencimento==='2027-01-31'))
})
test('desfazer remove somente a próxima mensalidade ainda intocada',async()=>{
 const item=await db.createEntry(company,fixed());await pay(item);await db.updateEntry(company,item.id,{status:'pendente'});assert.equal((await list()).length,1);assert.equal((await list())[0].status,'pendente');await pay(item);assert.equal((await list()).length,2)
})
test('desfazer preserva próxima mensalidade editada e informa conflito',async()=>{
 const item=await db.createEntry(company,fixed());await pay(item);const next=(await list()).find(r=>r.id!==item.id);await db.updateEntry(company,next.id,{valor:150});await assert.rejects(db.updateEntry(company,item.id,{status:'pendente'}),e=>e.code==='fixed_undo_conflict');assert.equal((await list()).length,2);assert.equal((await db.getEntry(company,item.id)).status,'pago');assert.equal((await db.getEntry(company,next.id)).valor,150)
})
test('desfazer não apaga mensalidade já paga nem seus descendentes',async()=>{
 const item=await db.createEntry(company,fixed());await pay(item);const next=(await list()).find(r=>r.status==='pendente');await pay(next);await assert.rejects(db.updateEntry(company,item.id,{status:'pendente'}),e=>e.code==='fixed_undo_conflict');assert.equal((await list()).length,3)
})
test('conta fixa antiga sem recorrencia_id ganha identidade estável',async()=>{
 const id=randomUUID();await pool.query("INSERT INTO app_financial_entries_v2(company_id,id,tipo,valor,data_vencimento,payload) VALUES($1,$2,'pagar',100,'2026-01-31',$3::jsonb)",[company,id,JSON.stringify({lancamento_tipo:'fixo'})]);await db.updateEntry(company,id,{status:'pago'});await db.updateEntry(company,id,{status:'pago'});const rows=await list();assert.equal(rows.length,2);assert.ok(rows.every(r=>r.recorrencia_id==='fixo_'+id))
})
test('empresa diferente não altera nem cria mensalidade para registro alheio',async()=>{
 const item=await db.createEntry(company,fixed());assert.equal(await db.updateEntry('outra_empresa',item.id,{status:'pago'}),null);assert.equal((await list()).length,1);assert.equal((await list())[0].status,'pendente')
})
test('mesma recorrência em empresas distintas permanece isolada',async()=>{
 const body=fixed();const a=await db.createEntry(company,body),b=await db.createEntry('outra_empresa',body);await Promise.all([pay(a),db.updateEntry('outra_empresa',b.id,{status:'pago'})]);assert.equal((await list()).length,2);assert.equal((await db.listEntries('outra_empresa')).length,2)
})
test('lançamentos únicos e parcelas mantêm a gravação anterior sem gerar recorrência',async()=>{
 for(const kind of ['unico','parcelado']){const item=await db.createEntry(company,{...fixed(),lancamento_tipo:kind});await pay(item)}assert.equal((await list()).length,2);assert.ok((await list()).every(r=>r.status==='pago'))
})
test('data inválida bloqueia criação sem gravação parcial',async()=>{
 await assert.rejects(db.createEntry(company,fixed({dataVencimento:'2026-02-31'})),e=>e.code==='fixed_invalid_date');assert.equal((await list()).length,0)
})
test('status de tipo incompatível não conclui a conta',async()=>{
 const item=await db.createEntry(company,fixed());await assert.rejects(db.updateEntry(company,item.id,{status:'recebido'}),e=>e.code==='fixed_invalid_status');assert.equal((await list())[0].status,'pendente')
})
test('edição concorrente não perde valor nem reverte a baixa',async()=>{
 const item=await db.createEntry(company,fixed());await Promise.all([pay(item),db.updateEntry(company,item.id,{descricao:'QA editada'})]);const saved=await db.getEntry(company,item.id);assert.equal(saved.status,'pago');assert.equal(saved.descricao,'QA editada');assert.equal((await list()).length,2)
})
test('desfazer conta com próxima mensalidade legada não remove registro preexistente',async()=>{
 const body=fixed(),item=await db.createEntry(company,body);await db.createEntry(company,{...body,dataVencimento:'2026-02-28'});await pay(item);await assert.rejects(db.updateEntry(company,item.id,{status:'pendente'}),e=>e.code==='fixed_undo_conflict');assert.equal((await list()).length,2)
})
test('falha na exclusão do desfazer reverte também a reabertura',async()=>{
 const item=await db.createEntry(company,fixed());await pay(item);fault=sql=>sql.startsWith('DELETE FROM app_financial_entries_v2');await assert.rejects(db.updateEntry(company,item.id,{status:'pendente'}),/injected/);assert.equal((await list()).length,2);assert.equal((await db.getEntry(company,item.id)).status,'pago')
})
