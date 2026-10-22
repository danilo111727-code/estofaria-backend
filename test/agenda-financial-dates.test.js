'use strict'
const {test,before,beforeEach,after}=require('node:test')
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path')
const {PGlite}=require('@electric-sql/pglite')
let pg,db,failFinancial=false
function load(file,dependencies){
  const m={exports:{}}
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/lib',file),'utf8'),{
    module:m,require:n=>n in dependencies?dependencies[n]:require(n),Date,console
  })
  return m.exports
}
before(async()=>{
  pg=new PGlite()
  const pool={query:async(sql,args=[])=>{
    if(failFinancial && sql.includes('UPDATE app_financial_entries_v2')) throw Error('financial failure')
    return args.length?pg.query(sql,args):(await pg.exec(sql)).at(-1)
  },connect:async()=>({...pool,release(){}})}
  db=load('agenda-v2-db.js',{'./store':{_pg:{pool}},'./trash-db':{},'./agenda-financial-dates':require('../src/lib/agenda-financial-dates')})
  await db.ensureSchema()
  await pg.exec(`CREATE TABLE app_financial_entries_v2(
    company_id text,id text,tipo text DEFAULT 'receber',status text DEFAULT 'pendente',
    data_vencimento text DEFAULT '',valor numeric DEFAULT 123.45,
    payload jsonb DEFAULT '{}',updated_at timestamptz DEFAULT now(),PRIMARY KEY(company_id,id))`)
})
beforeEach(async()=>{
  failFinancial=false
  await pg.exec('TRUNCATE app_financial_entries_v2,app_agenda_orders_v2,app_agenda_blocos_v2')
  await db.createBlock('a',{id:'block',data_producao:'2026-10-20',data_entrega:'2026-10-30',qtd_vagas:5})
  await db.createOrder('a',{id:'order',bloco_id:'block',ent_date:'2026-10-30',prod_date:'2026-10-20',source_quote_id:'quote',valor:500})
})
after(async()=>pg?.close())
const entry=async(id,payload={agenda_order_id:'order'},date='2026-10-30',status='pendente',company='a',tipo='receber')=>
  pg.query('INSERT INTO app_financial_entries_v2(company_id,id,payload,data_vencimento,status,tipo) VALUES($1,$2,$3::jsonb,$4,$5,$6)',[company,id,JSON.stringify(payload),date,status,tipo])
const row=async(id,company='a')=>(await pg.query('SELECT * FROM app_financial_entries_v2 WHERE company_id=$1 AND id=$2',[company,id])).rows[0]
const move=()=>db.updateBlock('a','block',{data_entrega:'2026-11-05'})
test('bloco atualiza saldo vinculado e preserva valor e campos financeiros',async()=>{
  await entry('balance',{agenda_order_id:'order',formaPagamento:'PIX',extra:'preservar'})
  await move();const r=await row('balance')
  assert.equal(r.data_vencimento,'2026-11-05');assert.equal(r.payload.dataVencimento,'2026-11-05')
  assert.equal(Number(r.valor),123.45);assert.equal(r.status,'pendente');assert.equal(r.payload.extra,'preservar')
  assert.equal((await db.getOrder('a','order')).ent_date,'2026-11-05')
})
test('alteração individual também sincroniza o saldo sem criar outra conta',async()=>{
  await entry('balance');await db.updateOrder('a','order',{ent_date:'2026-12-02'})
  assert.equal((await row('balance')).data_vencimento,'2026-12-02')
  assert.equal((await pg.query('SELECT count(*)::int n FROM app_financial_entries_v2')).rows[0].n,1)
})
test('conta somente com vínculo explícito ao orçamento também acompanha a entrega',async()=>{
  await entry('quote-only',{quote_id:'quote',financial_source:'order'});await move()
  assert.equal((await row('quote-only')).data_vencimento,'2026-11-05')
})
test('aliases de vínculo são aceitos',async()=>{
  await entry('camel',{agendaOrderId:'order'});await entry('source',{sourceQuoteId:'quote'});await move()
  for(const id of ['camel','source'])assert.equal((await row(id)).data_vencimento,'2026-11-05')
})
test('contas recebidas e pagas permanecem exatamente iguais',async()=>{
  await entry('received',undefined,undefined,'recebido');await entry('paid',undefined,undefined,'pago')
  const before=await Promise.all(['received','paid'].map(id=>row(id)));await move()
  assert.deepEqual(await Promise.all(['received','paid'].map(id=>row(id))),before)
})
test('vencimento negociado separadamente não é substituído',async()=>{
  await entry('custom',undefined,'2026-12-15');const before=await row('custom');await move()
  assert.deepEqual(await row('custom'),before)
})
test('parcelamentos, grupos e contas fixas não são remarcados',async()=>{
  const variants=[{lancamento_tipo:'parcelado'},{parcelas_total:3},{grupo_id:'group'},{lancamento_tipo:'fixo'},{recorrencia_id:'fixed'},{recorrencia_tipo:'fixo'}]
  for(let i=0;i<variants.length;i++)await entry('skip'+i,{agenda_order_id:'order',...variants[i]})
  await move();for(let i=0;i<variants.length;i++)assert.equal((await row('skip'+i)).data_vencimento,'2026-10-30')
})
test('não modifica outra empresa, contas a pagar ou contas sem vínculo',async()=>{
  await entry('other',undefined,undefined,undefined,'b');await entry('expense',undefined,undefined,undefined,'a','pagar')
  await entry('unlinked',{cliente:'Cliente',valor:500});await entry('wrong',{agenda_order_id:'different',quote_id:'quote'})
  await move()
  for(const id of ['expense','unlinked','wrong'])assert.equal((await row(id)).data_vencimento,'2026-10-30')
  assert.equal((await row('other','b')).data_vencimento,'2026-10-30')
})
test('ID do orçamento não é confundido com ID da Agenda',async()=>{
  await entry('collision',{quote_id:'order'});await move()
  assert.equal((await row('collision')).data_vencimento,'2026-10-30')
})
test('conta aguardando data ganha vencimento e status de agendamento',async()=>{
  await entry('waiting',{agenda_order_id:'order',agenda_status:'pendente'},'');await move()
  const r=await row('waiting');assert.equal(r.data_vencimento,'2026-11-05');assert.equal(r.payload.agenda_status,'agendado')
})
test('alterar só a produção não toca no financeiro',async()=>{
  await entry('balance');const before=await row('balance')
  await db.updateBlock('a','block',{data_producao:'2026-10-21'});assert.deepEqual(await row('balance'),before)
})
test('pedido entregue não tem histórico financeiro remarcado',async()=>{
  await db.updateOrder('a','order',{status:'entregue'});await entry('balance');const before=await row('balance')
  await move();assert.deepEqual(await row('balance'),before)
})
test('falha financeira reverte bloco, pedidos e contas juntos',async()=>{
  await entry('balance');failFinancial=true
  await assert.rejects(move(),/financial failure/);failFinancial=false
  assert.equal((await db.getBlock('a','block')).data_entrega,'2026-10-30')
  assert.equal((await db.getOrder('a','order')).ent_date,'2026-10-30')
  assert.equal((await row('balance')).data_vencimento,'2026-10-30')
})
test('falha financeira na edição individual reverte o pedido',async()=>{
  await entry('balance');failFinancial=true
  await assert.rejects(db.updateOrder('a','order',{ent_date:'2026-11-05'}),/financial failure/);failFinancial=false
  assert.equal((await db.getOrder('a','order')).ent_date,'2026-10-30')
})
test('bloco somente entrega preserva ausência de início da produção',async()=>{
  await db.createBlock('a',{id:'delivery',data_entrega:'2026-11-10'})
  await db.createOrder('a',{id:'delivery-order',bloco_id:'delivery',ent_date:'2026-11-10'})
  await entry('balance',{agenda_order_id:'delivery-order'},'2026-11-10')
  const block=await db.updateBlock('a','delivery',{data_entrega:'2026-11-20'})
  assert.equal(block.data_producao,'');assert.equal((await row('balance')).data_vencimento,'2026-11-20')
})
