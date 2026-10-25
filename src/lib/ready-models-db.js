'use strict'
const {randomUUID}=require('crypto')
const trash=require('./trash-db')
const pool=()=>require('./store')._pg.pool
const invalid=message=>Object.assign(new Error(message),{status:400})
async function ensureSchema(){
 await pool().query(`CREATE TABLE IF NOT EXISTS app_ready_models_v1 (
  id TEXT PRIMARY KEY,company_id TEXT NOT NULL,name TEXT NOT NULL,
  price_cents BIGINT NOT NULL CHECK(price_cents>=0),quantity INTEGER NOT NULL CHECK(quantity>=0),
  width_meters NUMERIC(10,2) NOT NULL CHECK(width_meters>0),depth_meters NUMERIC(10,2),height_meters NUMERIC(10,2),
  fabric TEXT NOT NULL DEFAULT '',images JSONB NOT NULL DEFAULT '{}'::jsonb,
  revision INTEGER NOT NULL DEFAULT 1,active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
 );ALTER TABLE app_ready_models_v1 ADD COLUMN IF NOT EXISTS card_rate_percent SMALLINT NOT NULL DEFAULT 0 CHECK(card_rate_percent BETWEEN 0 AND 15);
 ALTER TABLE app_ready_models_v1 ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '';
 UPDATE app_ready_models_v1 SET description=fabric,fabric='' WHERE description='' AND fabric<>'';
 CREATE INDEX IF NOT EXISTS idx_ready_models_company ON app_ready_models_v1(company_id,active,created_at DESC);`)
}
function normalize(input){
 const name=String(input.name||'').trim(),description=String(input.description??input.fabric??'').trim(),fabric=''
 if(!name||name.length>180)throw invalid('Informe o nome do modelo, com até 180 caracteres.')
 if(description.length>1000)throw invalid('A descrição deve ter até 1.000 caracteres.')
 if(!Number.isSafeInteger(input.price_cents)||input.price_cents<0||input.price_cents>99999999999)throw invalid('Informe um valor válido.')
 if(!Number.isSafeInteger(input.quantity)||input.quantity<0||input.quantity>1000000)throw invalid('Informe uma quantidade inteira válida.')
 const rate=input.card_rate_percent===undefined?0:input.card_rate_percent
 if(!Number.isInteger(rate)||rate<0||rate>15)throw invalid('Selecione uma taxa do cartão entre 0% e 15%.')
 function dimension(key,required=false){
  const value=input[key];if(!required&&(value===null||value===undefined||value===''))return null
  if(typeof value!=='number'||!Number.isFinite(value)||value<=0||value>99999999.99||Math.abs(value*100-Math.round(value*100))>0.000001)throw invalid('Informe as medidas em metros, com até duas casas decimais.')
  return value
 }
 return {name,price_cents:input.price_cents,card_rate_percent:rate,quantity:input.quantity,width_meters:dimension('width_meters',true),depth_meters:dimension('depth_meters'),height_meters:dimension('height_meters'),fabric,description}
}
async function list(companyId,offset=0){
 const rows=(await pool().query('SELECT * FROM app_ready_models_v1 WHERE company_id=$1 AND active=TRUE ORDER BY created_at DESC,id DESC LIMIT 100 OFFSET $2',[companyId,offset])).rows
 return rows
}
async function get(companyId,id){return (await pool().query('SELECT * FROM app_ready_models_v1 WHERE company_id=$1 AND id=$2 AND active=TRUE',[companyId,id])).rows[0]||null}
async function save(companyId,id,input,images,revision){
 const n=normalize(input),values=[companyId,id,n.name,n.price_cents,n.quantity,n.width_meters,n.depth_meters,n.height_meters,n.fabric,JSON.stringify(images||{}),n.card_rate_percent,n.description]
 let result
 if(revision===null){
  result=await pool().query(`INSERT INTO app_ready_models_v1(company_id,id,name,price_cents,quantity,width_meters,depth_meters,height_meters,fabric,images,card_rate_percent,description)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12) RETURNING *`,values)
 }else{
  if(!Number.isSafeInteger(revision)||revision<1)throw invalid('Reabra o modelo antes de editar.')
  result=await pool().query(`UPDATE app_ready_models_v1 SET name=$3,price_cents=$4,quantity=$5,width_meters=$6,depth_meters=$7,height_meters=$8,fabric=$9,images=$10::jsonb,card_rate_percent=$11,description=$12,revision=revision+1,updated_at=NOW()
    WHERE company_id=$1 AND id=$2 AND active=TRUE AND revision=$13 RETURNING *`,values.concat(revision))
  if(!result.rows.length)throw Object.assign(new Error('Este modelo foi alterado ou excluído. Reabra-o antes de salvar.'),{status:409})
 }
 return result.rows[0]
}
async function remove(companyId,id,revision){
 if(!Number.isSafeInteger(revision)||revision<1)throw invalid('Reabra o modelo antes de excluir.')
 return trash.transaction(pool(),async client=>{
  const row=(await client.query('SELECT * FROM app_ready_models_v1 WHERE company_id=$1 AND id=$2 AND active=TRUE FOR UPDATE',[companyId,id])).rows[0]
  if(!row)return false
  if(row.revision!==revision)throw Object.assign(new Error('Este modelo mudou. Atualize a lista antes de excluir.'),{status:409})
  const archived=await trash.archive(client,companyId,'catalogo','ready-model',id,{row})
  if(!archived)throw Object.assign(new Error('Não foi possível enviar o modelo para a lixeira. Tente novamente.'),{status:503})
  await client.query('UPDATE app_ready_models_v1 SET active=FALSE,revision=revision+1,updated_at=NOW() WHERE company_id=$1 AND id=$2',[companyId,id])
  return true
 })
}
module.exports={ensureSchema,normalize,list,get,save,remove,newId:randomUUID}

