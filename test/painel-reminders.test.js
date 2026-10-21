'use strict'
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
function load(agenda,quotes=[],models=[]){
 const module={exports:{}};
 const pool={query:async(sql,params)=>{assert.equal(params[0],'company-a');return {rows:sql.includes('app_quote_models_v2')?models:sql.includes('app_agenda_orders_v2')?agenda:quotes}}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/lib/dashboard-v2-db.js'),'utf8'),{module,Date,Intl,require:()=>({_pg:{pool}})});
 return module.exports;
}
const order=(extra={})=>({id:'a1',company_id:'company-a',bloco_id:'b1',cliente:'QA',descricao:'QA',ent_date:'2026-01-01',created_at:'2026-01-01T15:00:00Z',status:'pendente',payload:{valor:100},...extra});
const quote=(extra={})=>({id:'q1',company_id:'company-a',cliente:'QA',status:'pedido',total_cents:10000,created_at:'2026-01-01T15:00:00Z',payload_meta:{},...extra});
test('pedido de Vendas agendado aparece uma vez no lembrete',async()=>{
 const db=load([order({source_quote_id:'q1'})],[quote()]);const rows=await db.listReminderOrders('company-a');assert.equal(rows.length,1);assert.equal(rows[0].source_quote_id,'q1');assert.equal(rows[0].dashboard_reminder,true);
});
test('espelho de venda excluída e venda sem agenda não criam alertas',async()=>{
 assert.equal((await load([order({source_quote_id:'deleted'})],[quote()]).listReminderOrders('company-a')).length,0);
});
test('cancelar agendamento e entregar retiram apenas os lembretes',async()=>{
 for(const status of ['cancelado','entregue','indisponivel']){const db=load([order({source_quote_id:'q1',status})],[quote()]);assert.equal((await db.listReminderOrders('company-a')).length,0);if(status!=='indisponivel')assert.equal((await db.getSummary('company-a')).faturamento_ano_cents,10000);}
});
test('conciliação histórica não duplica lembretes e pedidos manuais continuam presentes',async()=>{
 const db=load([order()],[quote()]);assert.equal((await db.listReminderOrders('company-a')).length,1);
 assert.equal((await load([order()]).listReminderOrders('company-a')).length,1);
});
test('ranking exclui cancelados e inclui vendas sem agendamento pelos modelos da venda',async()=>{
 const db=load([order({id:'cancelled',status:'cancelado',payload:{valor:100,modelos:[{name:'Cancelado'}]}})],[quote()],[{quote_id:'q1',model_name:'Modelo vendido',extra:{}}]);
 const summary=await db.getSummary('company-a');assert.equal(summary.charts.top_models.length,1);assert.equal(summary.charts.top_models[0].name,'Modelo vendido');assert.equal(summary.charts.top_models[0].sales,1);
});
test('ranking concilia espelho e venda sem contar duas vezes, inclusive após entrega',async()=>{
 const db=load([order({source_quote_id:'q1',status:'entregue',payload:{valor:100,modelos:[{name:'Modelo vendido'}]}})],[quote()],[{quote_id:'q1',model_name:'Modelo vendido',extra:{}}]);
 const summary=await db.getSummary('company-a');assert.equal(summary.charts.top_models.length,1);assert.equal(summary.charts.top_models[0].sales,1);
});
test('ranking não duplica conciliação histórica',async()=>{
 const db=load([order({payload:{valor:100,modelos:[{name:'Modelo vendido'}]}})],[quote()],[{quote_id:'q1',model_name:'Modelo vendido',extra:{}}]);
 assert.equal((await db.getSummary('company-a')).charts.top_models[0].sales,1);
});
