'use strict'
const {randomUUID}=require('crypto')
const store=require('./store')
const pool=()=>{if(!store._pg?.pool)throw new Error('postgres_required');return store._pg.pool}
function fail(message,status=400,extra={}){return Object.assign(new Error(message),{status,...extra})}
const digits=value=>String(value || '').replace(/\D/g,'')
const clean=(value,max)=>String(value || '').trim().slice(0,max)
function normalize(input){
  const row={name:clean(input.name,160),cpf:digits(input.cpf),phone:digits(input.phone),address:clean(input.address,500)}
  if(!row.name)throw fail('Informe o nome do cliente.')
  if(row.cpf && row.cpf.length!==11)throw fail('Informe os 11 dígitos do CPF ou deixe em branco.')
  if(row.phone && ![10,11].includes(row.phone.length))throw fail('Informe o telefone com DDD ou deixe em branco.')
  return row
}
function dateOnly(value){
  if(typeof value!=='string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))throw fail('Data da compra inválida.')
  const d=new Date(value+'T12:00:00Z')
  if(Number.isNaN(+d)||d.toISOString().slice(0,10)!==value)throw fail('Data da compra inválida.')
  return value
}
function today(){return new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())}
function period(query={}){
  const start=query.start?dateOnly(query.start):null,end=query.end?dateOnly(query.end):null
  if(start&&end&&start>end)throw fail('O início do período deve ser anterior ao fim.')
  return [start,end]
}
async function ensureSchema(){
  await pool().query(`CREATE TABLE IF NOT EXISTS app_customers_v1 (
    company_id TEXT NOT NULL,id TEXT NOT NULL,name TEXT NOT NULL,cpf TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT '',address TEXT NOT NULL DEFAULT '',active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY(company_id,id));
    CREATE INDEX IF NOT EXISTS idx_customers_company_name ON app_customers_v1(company_id,lower(name)) WHERE active=TRUE;
    CREATE INDEX IF NOT EXISTS idx_customers_company_cpf ON app_customers_v1(company_id,cpf) WHERE active=TRUE AND cpf<>'';
    CREATE INDEX IF NOT EXISTS idx_customers_company_phone ON app_customers_v1(company_id,phone) WHERE active=TRUE AND phone<>'';
    CREATE UNIQUE INDEX IF NOT EXISTS ux_customer_quote_company ON app_quotes_v2(company_id,id);
    CREATE TABLE IF NOT EXISTS app_customer_quotes_v1 (
      company_id TEXT NOT NULL,quote_id TEXT NOT NULL,
      customer_id TEXT NOT NULL,purchase_date DATE,PRIMARY KEY(company_id,quote_id),
      FOREIGN KEY(company_id,customer_id) REFERENCES app_customers_v1(company_id,id),
      FOREIGN KEY(company_id,quote_id) REFERENCES app_quotes_v2(company_id,id) ON DELETE CASCADE);
    CREATE INDEX IF NOT EXISTS idx_customer_quotes_customer_date ON app_customer_quotes_v1(company_id,customer_id,purchase_date DESC);`)
}
async function list(companyId,query={}){
  const search=clean(query.search,160),n=digits(search),offset=Math.max(0,Math.min(Number(query.offset)||0,1000000))
  const result=await pool().query(`SELECT c.*,COUNT(*) OVER()::int AS result_count FROM app_customers_v1 c
    WHERE c.company_id=$1 AND c.active=TRUE AND ($2='' OR strpos(lower(c.name),lower($2))>0
      OR ($3<>'' AND (strpos(c.phone,$3)>0 OR strpos(c.cpf,$3)>0)))
    ORDER BY lower(c.name),c.id LIMIT 50 OFFSET $4`,[companyId,search,n,offset])
  return {items:result.rows,total:result.rows[0]?.result_count || 0,offset}
}
async function get(companyId,id){return (await pool().query('SELECT * FROM app_customers_v1 WHERE company_id=$1 AND id=$2',[companyId,id])).rows[0] || null}
async function save(companyId,id,input={}){
  const row=normalize(input),client=await pool().connect()
  try{
    await client.query('BEGIN')
    // Serializa cadastro/edição por empresa para que dois cliques não burlem o aviso.
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['customers:'+companyId])
    if(id){const old=await client.query('SELECT id FROM app_customers_v1 WHERE company_id=$1 AND id=$2 AND active=TRUE FOR UPDATE',[companyId,id]);if(!old.rows.length)throw fail('Cliente não encontrado.',404)}
    const duplicates=await client.query(`SELECT id,name FROM app_customers_v1 WHERE company_id=$1 AND active=TRUE
      AND id<>$2 AND (($3<>'' AND cpf=$3) OR ($4<>'' AND phone=$4)) ORDER BY name LIMIT 10`,[companyId,id || '',row.cpf,row.phone])
    if(duplicates.rows.length && input.allow_duplicate!==true)throw fail('Já existe cliente com esse CPF ou telefone. Confira antes de cadastrar novamente.',409,{duplicates:duplicates.rows})
    const customerId=id || randomUUID()
    const result=id?await client.query(`UPDATE app_customers_v1 SET name=$3,cpf=$4,phone=$5,address=$6,updated_at=NOW()
      WHERE company_id=$1 AND id=$2 AND active=TRUE RETURNING *`,[companyId,customerId,row.name,row.cpf,row.phone,row.address]):
      await client.query(`INSERT INTO app_customers_v1(company_id,id,name,cpf,phone,address) VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,[companyId,customerId,row.name,row.cpf,row.phone,row.address])
    await client.query('COMMIT');return result.rows[0]
  }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error}finally{client.release()}
}
async function remove(companyId,id){return (await pool().query('UPDATE app_customers_v1 SET active=FALSE,updated_at=NOW() WHERE company_id=$1 AND id=$2 AND active=TRUE RETURNING id',[companyId,id])).rowCount>0}
async function syncQuote(client,companyId,quoteId,status,payload={},previousStatus=''){
  if(!Object.prototype.hasOwnProperty.call(payload,'customer_id'))return
  // Sidecar: snapshots e documentos do orçamento não são alterados pelo cadastro.
  if(Object.prototype.hasOwnProperty.call(payload,'customer_id')){
    if(!payload.customer_id){
      if(previousStatus && previousStatus!=='orcamento')return
      await client.query('DELETE FROM app_customer_quotes_v1 WHERE company_id=$1 AND quote_id=$2',[companyId,quoteId]);return
    }
    const found=await client.query('SELECT id,active FROM app_customers_v1 WHERE company_id=$1 AND id=$2',[companyId,String(payload.customer_id)])
    if(!found.rows[0])throw fail('Cliente não encontrado nesta empresa. Selecione o cliente novamente.')
    // Um cadastro excluído pode continuar vinculado ao pedido já existente.
    const linked=await client.query('SELECT customer_id FROM app_customer_quotes_v1 WHERE company_id=$1 AND quote_id=$2',[companyId,quoteId])
    if(!found.rows[0].active && linked.rows[0]?.customer_id!==String(payload.customer_id))throw fail('Este cliente foi excluído. Selecione outro cadastro.')
    await client.query(`INSERT INTO app_customer_quotes_v1(company_id,quote_id,customer_id) VALUES($1,$2,$3)
      ON CONFLICT(company_id,quote_id) DO UPDATE SET customer_id=EXCLUDED.customer_id`,[companyId,quoteId,String(payload.customer_id)])
  }
  if(status==='pedido'){
    const explicit=payload.data_pedido?dateOnly(payload.data_pedido):null
    await client.query(`UPDATE app_customer_quotes_v1 SET purchase_date=COALESCE($3::date,purchase_date,$4::date)
      WHERE company_id=$1 AND quote_id=$2`,[companyId,quoteId,explicit,today()])
  }
}
// Somente pedidos confirmados do Vendedor; a Agenda não duplica a mesma compra.
const PURCHASES=`FROM app_customer_quotes_v1 l JOIN app_quotes_v2 q ON q.company_id=l.company_id AND q.id=l.quote_id
  WHERE l.company_id=$1 AND q.active=TRUE AND q.status='pedido' AND l.purchase_date IS NOT NULL
    AND lower(COALESCE(q.payload_meta->>'agenda_status','')) NOT IN ('cancelado','cancelada','canceled','cancelled')
    AND lower(COALESCE(q.payload_meta->>'delivery_status','')) NOT IN ('cancelado','cancelada','canceled','cancelled')
    AND ($2::date IS NULL OR l.purchase_date >= $2::date) AND ($3::date IS NULL OR l.purchase_date <= $3::date)`
async function purchases(companyId,id,query={}){
  const customer=await get(companyId,id);if(!customer)throw fail('Cliente não encontrado.',404)
  const [start,end]=period(query),offset=Math.max(0,Math.min(Number(query.offset)||0,1000000))
  const rows=await pool().query(`SELECT q.id,q.cliente,q.total_cents::text,
    to_char(l.purchase_date,'YYYY-MM-DD') AS date,COUNT(*) OVER()::int AS result_count
    ${PURCHASES} AND l.customer_id=$4 ORDER BY l.purchase_date DESC,q.created_at DESC,q.id LIMIT 50 OFFSET $5`,[companyId,start,end,id,offset])
  return {customer:{id:customer.id,name:customer.name,active:customer.active},items:rows.rows,total:rows.rows[0]?.result_count || 0,offset,start,end}
}
module.exports={ensureSchema,list,get,save,remove,syncQuote,purchases,normalize,dateOnly,period}
