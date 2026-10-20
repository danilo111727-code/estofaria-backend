'use strict'
const {test,before,beforeEach,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),{randomUUID}=require('node:crypto')
const url=process.env.FINANCIAL_TEST_DATABASE_URL
if(!url)throw Error('FINANCIAL_TEST_DATABASE_URL obrigatório: PostgreSQL descartável local.')
const target=new URL(url)
if(!['localhost','127.0.0.1'].includes(target.hostname)||target.pathname!=='/financial_fixed_test')throw Error('Banco de testes deve ser local e descartável.')
const {Pool}=require('pg'),pool=new Pool({connectionString:url,max:16})
let fault=null
const adapter={query:(...args)=>pool.query(...args),connect:async()=>{const c=await pool.connect();return {release:()=>c.release(),query:async(sql,args)=>{if(fault&&fault(sql,args)){fault=null;throw Error('injected failure')}return c.query(sql,args)}}}}
const m={exports:{}}
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/lib/financial-v2-db.js'),'utf8'),{module:m,require:n=>n==='./store'?{_pg:{pool:adapter}}:n==='./trash-db'?{}:n.startsWith('./')?require('../src/lib/'+n):require(n)})
const db=m.exports,company='qa_installments'
const body=(patch={})=>({tipo:'pagar',descricao:'QA parcelamento',cliente:'QA',valor:100,dataVencimento:'2026-01-31',formaPagamento:'PIX',parcelas:3,grupo_id:'grp_'+randomUUID(),...patch})
const list=()=>db.listEntries(company)
before(async()=>db.ensureSchema())
beforeEach(async()=>{fault=null;await pool.query('TRUNCATE app_financial_entries_v2,app_financial_installment_requests_v2')})
after(async()=>pool.end())
test('todas as parcelas gravam juntas e a soma preserva centavos',async()=>{
 const result=await db.createInstallments(company,body());assert.equal(result.items.length,3);assert.deepEqual(result.items.map(i=>i.valor),[33.34,33.33,33.33]);assert.equal(result.items.reduce((s,i)=>s+Math.round(i.valor*100),0),10000);assert.ok(result.items.every(i=>i.status==='pendente'&&i.lancamento_tipo==='parcelado'));assert.equal(new Set(result.items.map(i=>i.grupo_id)).size,1)
})
test('dia 31 ajusta fevereiro e retorna em março',async()=>{
 const r=await db.createInstallments(company,body());assert.deepEqual(r.items.map(i=>i.dataVencimento),['2026-01-31','2026-02-28','2026-03-31'])
})
test('recebimentos preservam tipo, cliente e numeração',async()=>{
 const r=await db.createInstallments(company,body({tipo:'receber'}));assert.ok(r.items.every((i,n)=>i.tipo==='receber'&&i.cliente==='QA'&&i.parcela_atual===n+1&&i.parcelas_total===3))
})
test('100 parcelas mantêm valor total e IDs distintos',async()=>{
 const r=await db.createInstallments(company,body({parcelas:100,valor:1}));assert.equal(r.items.length,100);assert.equal(new Set(r.items.map(i=>i.id)).size,100);assert.ok(r.items.every(i=>i.valor===0.01))
})
test('falha na terceira parcela reverte parcelas anteriores e identificador',async()=>{
 let n=0;fault=sql=>sql.startsWith('INSERT INTO app_financial_entries_v2')&&++n===3
 const b=body();await assert.rejects(db.createInstallments(company,b),/injected/);assert.equal((await list()).length,0);assert.equal((await pool.query('SELECT * FROM app_financial_installment_requests_v2')).rows.length,0);assert.equal((await db.createInstallments(company,b)).items.length,3)
})
test('falha ao registrar confirmação reverte todas as parcelas',async()=>{
 fault=sql=>sql.startsWith('INSERT INTO app_financial_installment_requests_v2');await assert.rejects(db.createInstallments(company,body()),/injected/);assert.equal((await list()).length,0)
})
test('oito envios simultâneos retornam o mesmo grupo sem duplicação',async()=>{
 const b=body(),r=await Promise.all(Array.from({length:8},()=>db.createInstallments(company,b)));assert.equal((await list()).length,3);assert.equal(new Set(r.map(x=>x.items[0].id)).size,1);assert.equal(r.filter(x=>!x.replayed).length,1)
})
test('resposta perdida pode ser repetida mesmo após baixa de parcela',async()=>{
 const b=body(),first=await db.createInstallments(company,b);await db.updateEntry(company,first.items[0].id,{status:'pago'});const replay=await db.createInstallments(company,b);assert.equal(replay.replayed,true);assert.equal(replay.items[0].status,'pago');assert.equal((await list()).length,3)
})
test('mesmo identificador com outros valores é recusado',async()=>{
 const b=body();await db.createInstallments(company,b);await assert.rejects(db.createInstallments(company,{...b,valor:200}),e=>e.statusCode===409);assert.equal((await list()).length,3)
})
test('repetição não recria parcelas excluídas',async()=>{
 const b=body(),r=await db.createInstallments(company,b);await pool.query('DELETE FROM app_financial_entries_v2 WHERE company_id=$1 AND id=$2',[company,r.items[0].id]);await assert.rejects(db.createInstallments(company,b),e=>e.code==='installments_changed');assert.equal((await list()).length,2)
})
test('empresas distintas têm grupos e IDs isolados',async()=>{
 const b=body(),a=await db.createInstallments(company,b),other=await db.createInstallments('qa_other',b);assert.notEqual(a.items[0].id,other.items[0].id);assert.ok(a.items.every(i=>i.company_id===company));assert.equal((await list()).length,3)
})
test('entrada inválida não grava nenhuma parcela',async()=>{
 for(const change of [{valor:0.01},{valor:-10},{parcelas:101},{parcelas:2.5},{dataVencimento:'2026-02-30'},{grupo_id:'x'},{tipo:'outro'},{descricao:''}])await assert.rejects(db.createInstallments(company,body(change)),e=>e.statusCode===400)
 assert.equal((await list()).length,0)
})
test('grupos legados parciais não são completados ou duplicados silenciosamente',async()=>{
 const b=body();await db.createEntry(company,{...b,lancamento_tipo:'parcelado'});await assert.rejects(db.createInstallments(company,b),e=>e.statusCode===409);assert.equal((await list()).length,1)
})
