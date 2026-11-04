const {test}=require('node:test'),assert=require('node:assert/strict')
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path')
function setup(){
  const rows=new Map(),calls=[]
  const copy=x=>JSON.parse(JSON.stringify(x))
  const client={release(){},async query(sql,args=[]){
    sql=sql.replace(/\s+/g,' ').trim();calls.push({sql,args})
    if(/^(BEGIN|COMMIT|ROLLBACK|SELECT pg_advisory)/.test(sql))return {rows:[]}
    if(sql.startsWith('SELECT * FROM app_agenda_blocos_v2'))return {rows:[{id:'block',company_id:args[0],qtd_vagas:10}]}
    if(sql.startsWith('SELECT COUNT(*)'))return {rows:[{count:rows.size}]}
    if(sql.startsWith('SELECT * FROM app_agenda_orders_v2')){
      const found=[...rows.values()].filter(r=>r.company_id===args[0] && (sql.includes('source_quote_id=$2')?r.source_quote_id===args[1]:r.id===args[1]))
      return {rows:copy(found)}
    }
    if(sql.startsWith('INSERT INTO app_agenda_orders_v2')||sql.startsWith('UPDATE app_agenda_orders_v2')){
      const payload=JSON.parse(args[12]),row={...payload,payload:copy(payload)}
      rows.set(payload.company_id+':'+payload.id,row);return {rows:[copy(row)]}
    }
    throw Error('Unexpected SQL: '+sql)
  }}
  const module={exports:{}}
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/lib/agenda-v2-db.js'),'utf8'),{
    module,console,require:n=>n==='./store'?{_pg:{pool:{connect:async()=>client,query:client.query.bind(client)}}}:
      n==='./trash-db'?{}:n==='./agenda-financial-dates'?{syncDeliveryReceivable:async()=>{}}:require(n)
  })
  return {db:module.exports,calls}
}
const models=[{id:'',name:'A',quote_image_key:'company/a'},{id:'',name:'B',quote_image_key:'company/b'},{id:'cat',name:'Catalog'}]
test('block creation and subsequent read preserve all photo references',async()=>{
  const {db}=setup(),result=await db.createBlockOrder('company','block',{id:'order',modelos:models})
  const read=await db.getOrder('company',result.row.id)
  assert.deepEqual(JSON.parse(JSON.stringify(read.modelos)),models)
})
test('editing models and reading back preserves references',async()=>{
  const {db}=setup();await db.createBlockOrder('company','block',{id:'order',modelos:models})
  const result=await db.updateOrder('company','order',{modelos:models})
  assert.deepEqual(JSON.parse(JSON.stringify(result.modelos)),models)
  assert.deepEqual(JSON.parse(JSON.stringify((await db.getOrder('company','order')).modelos)),models)
})
test('status and customer edits keep photos without resubmitting models',async()=>{
  const {db}=setup();await db.createBlockOrder('company','block',{id:'order',modelos:models})
  const result=await db.updateOrder('company','order',{cliente:'Changed',tecido_comprado:true})
  assert.deepEqual(JSON.parse(JSON.stringify(result.modelos)),models)
})
test('without photos and catalog-only models remain valid',async()=>{
  const {db}=setup()
  for(const modelos of [[],[{id:'',name:'No photo'}],[{id:'cat',name:'Catalog'}]]){
    const result=await db.createBlockOrder('company','block',{modelos})
    assert.deepEqual(JSON.parse(JSON.stringify(result.row.modelos)),modelos)
  }
})
test('generic order creation also preserves photo references',async()=>{
  const {db}=setup(),result=await db.createOrder('company',{id:'generic',modelos:models})
  assert.deepEqual(JSON.parse(JSON.stringify((await db.getOrder('company',result.id)).modelos)),models)
})
test('another company cannot read or edit the order',async()=>{
  const {db}=setup();await db.createBlockOrder('company','block',{id:'order',modelos:models})
  assert.equal(await db.getOrder('another','order'),null)
  assert.equal(await db.updateOrder('another','order',{modelos:[]}),null)
  assert.deepEqual(JSON.parse(JSON.stringify((await db.getOrder('company','order')).modelos)),models)
})
test('only image references are persisted, never inline image bytes',async()=>{
  const {db}=setup(),result=await db.createBlockOrder('company','block',{
    modelos:[{id:'',name:'A',quoteImageKey:'company/a',image_data_url:'data:image/png;base64,AAAA'}]
  })
  assert.deepEqual(JSON.parse(JSON.stringify(result.row.modelos)),[{id:'',name:'A',quote_image_key:'company/a'}])
})
