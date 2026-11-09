'use strict'
const {randomBytes}=require('crypto')
const pool=()=>require('./store')._pg.pool
const slug=()=>randomBytes(12).toString('hex')
async function ensureSchema(){
 await pool().query("CREATE TABLE IF NOT EXISTS app_portfolio_v1("+
   "company_id TEXT PRIMARY KEY,"+
   "slug TEXT NOT NULL UNIQUE,"+
   "name TEXT NOT NULL DEFAULT '',"+
   "description TEXT NOT NULL DEFAULT '',"+
   "whatsapp TEXT NOT NULL DEFAULT '',"+
   "show_prices BOOLEAN NOT NULL DEFAULT TRUE,"+
   "custom_ids JSONB NOT NULL DEFAULT '[]'::jsonb,"+
   "ready_ids JSONB NOT NULL DEFAULT '[]'::jsonb,"+
   "direct_models JSONB NOT NULL DEFAULT '[]'::jsonb,"+
   "published BOOLEAN NOT NULL DEFAULT FALSE,"+
   "revision INTEGER NOT NULL DEFAULT 1,"+
   "created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),"+
   "updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())")
 await pool().query("ALTER TABLE app_portfolio_v1 ADD COLUMN IF NOT EXISTS direct_models JSONB NOT NULL DEFAULT '[]'::jsonb")
}
async function ensure(companyId){
 const response=await pool().query("INSERT INTO app_portfolio_v1(company_id,slug) VALUES($1,$2) ON CONFLICT (company_id) DO UPDATE SET company_id=EXCLUDED.company_id RETURNING *",[companyId,slug()])
 return response.rows[0]
}
async function get(companyId){return(await pool().query('SELECT * FROM app_portfolio_v1 WHERE company_id=$1',[companyId])).rows[0]||null}
async function bySlug(publicSlug){return(await pool().query('SELECT * FROM app_portfolio_v1 WHERE slug=$1 AND published=TRUE',[publicSlug])).rows[0]||null}
async function update(companyId,details,revision){
 const result=await pool().query("UPDATE app_portfolio_v1 SET "+
  "name=$2,description=$3,whatsapp=$4,show_prices=$5,custom_ids=$6::jsonb,ready_ids=$7::jsonb,direct_models=$9::jsonb,revision=revision+1,updated_at=NOW() "+
  "WHERE company_id=$1 AND revision=$8 RETURNING *",[
   companyId,details.name,details.description,details.whatsapp,details.show_prices,
   JSON.stringify(details.custom_ids),JSON.stringify(details.ready_ids),revision,JSON.stringify(details.direct_models)
  ])
 return result.rows[0]||null
}
async function publish(companyId,published,revision){
 const result=await pool().query("UPDATE app_portfolio_v1 SET published=$2,revision=revision+1,updated_at=NOW() "+
  "WHERE company_id=$1 AND revision=$3 RETURNING *",[companyId,published,revision])
 return result.rows[0]||null
}
module.exports={ensureSchema,ensure,get,bySlug,update,publish}
