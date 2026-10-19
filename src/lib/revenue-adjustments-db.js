'use strict'

const store = require('./store')
let ready
function pool(){
  const value = store?._pg?.pool
  if(!value) throw new Error('PostgreSQL indisponível.')
  return value
}
function ensureSchema(){
  if(!ready) ready = pool().query(`CREATE TABLE IF NOT EXISTS app_revenue_adjustments_v1 (
    company_id TEXT NOT NULL,
    record_key TEXT NOT NULL,
    amount_cents BIGINT,
    removed BOOLEAN NOT NULL DEFAULT FALSE,
    version INTEGER NOT NULL DEFAULT 1,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY(company_id,record_key),
    CHECK(amount_cents IS NULL OR amount_cents BETWEEN 0 AND 999999999999)
  )`).catch(error=>{ready=null;throw error})
  return ready
}
async function list(companyId){
  await ensureSchema()
  const result=await pool().query('SELECT record_key,amount_cents,removed,version FROM app_revenue_adjustments_v1 WHERE company_id=$1',[String(companyId)])
  return new Map(result.rows.map(row=>[row.record_key,row]))
}
async function save(companyId,key,amount,removed,expectedVersion){
  await ensureSchema()
  const params=[String(companyId),key,amount,removed]
  const result=expectedVersion===0
    ? await pool().query(`INSERT INTO app_revenue_adjustments_v1
        (company_id,record_key,amount_cents,removed,version) VALUES($1,$2,$3,$4,1)
        ON CONFLICT(company_id,record_key) DO NOTHING RETURNING version`,params)
    : await pool().query(`UPDATE app_revenue_adjustments_v1 SET amount_cents=$3,removed=$4,
        version=version+1,updated_at=NOW() WHERE company_id=$1 AND record_key=$2 AND version=$5 RETURNING version`,
        [...params,expectedVersion])
  if(result.rows.length)return result.rows[0]
  const error=new Error('Este registro foi alterado em outra tela. Atualize e tente novamente.')
  error.status=409;throw error
}
async function deleteForCompany(client,companyId){
  // Participa da transação de exclusão da empresa, inclusive antes do primeiro uso do histórico.
  const exists=await client.query("SELECT to_regclass('app_revenue_adjustments_v1') AS table_name")
  if(!exists.rows[0]?.table_name)return 0
  const params=[String(companyId)]
  const result=await client.query('DELETE FROM app_revenue_adjustments_v1 WHERE company_id=$1 RETURNING record_key',params)
  const remaining=await client.query('SELECT COUNT(*)::int AS total FROM app_revenue_adjustments_v1 WHERE company_id=$1',params)
  if(Number(remaining.rows[0]?.total || 0)!==0)throw new Error('company_delete_verify_revenue_adjustments')
  return result.rows.length
}
module.exports={list,save,ensureSchema,deleteForCompany}
