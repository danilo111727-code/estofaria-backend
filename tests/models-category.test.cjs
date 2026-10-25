const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm'),path=require('path');
function fixture(){
 const calls=[],rows=new Map();
 const query=async(sql,params=[])=>{
  calls.push({sql,params});
  const refs=[...sql.matchAll(/\$(\d+)/g)].map(x=>Number(x[1]));
  if(refs.length)assert.equal(Math.max(...refs),params.length,'SQL parameter count');
  if(sql.includes('INSERT INTO app_models_v2')){
   const cols=sql.match(/app_models_v2\s*\(([\s\S]*?)\)\s*VALUES/)[1].split(',').map(x=>x.trim());
   const vals=sql.match(/VALUES\s*\(([\s\S]*?)\)\s*(?:ON CONFLICT|$)/)[1].split(',').map(x=>x.trim());
   assert.equal(cols.length,vals.length,'columns match values');
   const row={};cols.forEach((col,i)=>{const ref=vals[i].match(/\$(\d+)/);row[col]=ref?params[Number(ref[1])-1]:null;});
   row.materials=[];rows.set(row.id,row);
  }
  if(sql.includes('UPDATE app_models_v2') && sql.includes('SET name')){
   const row=rows.get(params[1]);if(!row||row.company_id!==params[0])return {rows:[]};
   for(const m of sql.matchAll(/(\w+)\s*=\s*\$(\d+)/g))row[m[1]]=params[Number(m[2])-1];
   return {rows:[{id:row.id}]};
  }
  if(sql.includes('SELECT m.*')){const row=rows.get(params[1]);return {rows:row&&row.company_id===params[0]?[row]:[]};}
  return {rows:[]};
 };
 const pool={query,connect:async()=>({query,release(){}})};
 const module={exports:{}};
 const source=fs.readFileSync(path.join(__dirname,'../src/lib/models-v2-db.js'),'utf8');
 vm.runInNewContext(source,{module,require:n=>n==='./store'?{_pg:{pool}}:n==='./trash-db'?{}:require(n)});
 return {db:module.exports,calls,rows};
}

test('category persists on create, rename, partial update and remains company scoped',async()=>{
 const {db}=fixture();await db.ensureSchema();
 const a=await db.createModel('company-A',{name:'Maui',category:'Poltrona',base_meters:2,total_cost_cents:10000,target_profit_cents:5000,sale_price_cents:15000});
 assert.equal(a.category,'Poltrona');
 const b=await db.updateModel('company-A',a.id,{name:'Nova Maui'});
 assert.equal(b.category,'Poltrona');assert.equal(b.sale_price_cents,15000);
 assert.equal(await db.updateModel('company-B',a.id,{category:'Box'}),null);
 const c=await db.updateModel('company-A',a.id,{category:'Puff'});assert.equal(c.category,'Puff');
});
test('legacy models stay uncategorized; invalid category is rejected',async()=>{
 const {db}=fixture();const a=await db.createModel('company-A',{name:'Antigo',base_meters:2});
 assert.equal(a.category,'');
 assert.throws(()=>db.normalizeModelInput({name:'Teste',category:'<script>'}));
});
test('legacy upsert SQL remains valid with category',async()=>{
 const {db}=fixture();const a=await db.upsertMigratedModel('company-A','legacy-1',{name:'Antigo',base_meters:2,category:'Sofá fixo'});
 assert.equal(a.category,'Sofá fixo');
});
