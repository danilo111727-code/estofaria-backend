'use strict'
const express=require('express')
const crypto=require('crypto')
const {requireAuth}=require('../middleware/auth')
const {readStore}=require('../lib/store')
const {hasMasterAccess,hasPermission}=require('../lib/policies')
const db=require('../lib/models-v2-db')
const router=express.Router()
router.use(requireAuth)
function company(req){
 const id=String(req.user?.company_id||'')
 return (readStore().companies||[]).find(c=>String(c.id)===id)
}
function allowed(req,res,next){
 const c=company(req)
 if(!c||c.modalidade!=='cortinas')return res.status(403).json({message:'Acesso exclusivo a empresas de Cortinas.'})
 if(!hasMasterAccess(req.user)&&!['precificacao','catalogo','vendedor'].some(p=>hasPermission(req.user,p)))return res.status(403).json({message:'Sem permissão.'})
 req.curtainCompanyId=String(c.id);next()
}
async function pool(){
 const p=require('../lib/store')._pg?.pool
 if(!p)throw new Error('PostgreSQL indisponível')
 await p.query(`CREATE TABLE IF NOT EXISTS app_curtain_models (
 id TEXT PRIMARY KEY,company_id TEXT NOT NULL,name TEXT NOT NULL,
 width_m NUMERIC(10,3) NOT NULL,height_m NUMERIC(10,3) NOT NULL,
 width_step_cm INTEGER NOT NULL,height_step_cm INTEGER NOT NULL,
 width_step_cents BIGINT NOT NULL,height_step_cents BIGINT NOT NULL,
 cost_cents BIGINT NOT NULL,profit_cents BIGINT NOT NULL,
 materials JSONB NOT NULL DEFAULT '[]'::jsonb,
 description TEXT NOT NULL DEFAULT '',created_at TIMESTAMPTZ DEFAULT NOW(),updated_at TIMESTAMPTZ DEFAULT NOW()
 );CREATE INDEX IF NOT EXISTS idx_curtain_models_company ON app_curtain_models(company_id,updated_at DESC)`)
 return p
}
function number(v){const n=Number(v);return Number.isFinite(n)?n:0}
function normalize(b){
 return {name:String(b.name||'').trim().slice(0,180),width_m:number(b.width_m),height_m:number(b.height_m),
 width_step_cm:Math.round(number(b.width_step_cm)),height_step_cm:Math.round(number(b.height_step_cm)),
 width_step_cents:Math.round(number(b.width_step_cents)),height_step_cents:Math.round(number(b.height_step_cents)),
 cost_cents:Math.round(number(b.cost_cents)),profit_cents:Math.round(number(b.profit_cents)),
 materials:Array.isArray(b.materials)?b.materials:[],description:String(b.description||'').slice(0,500)}
}
function valid(b){return b.name&&b.width_m>0&&b.height_m>0&&b.width_step_cm>0&&b.height_step_cm>0&&b.width_step_cents>=0&&b.height_step_cents>=0&&b.cost_cents>=0&&b.profit_cents>=0}
router.get('/models',allowed,async(req,res,next)=>{try{const p=await pool();const r=await p.query('SELECT * FROM app_curtain_models WHERE company_id=$1 ORDER BY updated_at DESC LIMIT 200',[req.curtainCompanyId]);res.json({items:r.rows})}catch(e){next(e)}})
router.post('/models',allowed,async(req,res,next)=>{try{
 const b=normalize(req.body);if(!valid(b))return res.status(400).json({message:'Confira medidas e valores.'})
 const p=await pool(),id=crypto.randomUUID()
 const r=await p.query(`INSERT INTO app_curtain_models(id,company_id,name,width_m,height_m,width_step_cm,height_step_cm,width_step_cents,height_step_cents,cost_cents,profit_cents,materials,description) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13) RETURNING *`,[id,req.curtainCompanyId,b.name,b.width_m,b.height_m,b.width_step_cm,b.height_step_cm,b.width_step_cents,b.height_step_cents,b.cost_cents,b.profit_cents,JSON.stringify(b.materials),b.description])
 res.status(201).json(r.rows[0])
 }catch(e){next(e)}})
router.put('/models/:id',allowed,async(req,res,next)=>{try{
 const b=normalize(req.body);if(!valid(b))return res.status(400).json({message:'Confira medidas e valores.'})
 const p=await pool();const r=await p.query(`UPDATE app_curtain_models SET name=$3,width_m=$4,height_m=$5,width_step_cm=$6,height_step_cm=$7,width_step_cents=$8,height_step_cents=$9,cost_cents=$10,profit_cents=$11,materials=$12::jsonb,description=$13,updated_at=NOW() WHERE company_id=$1 AND id=$2 RETURNING *`,[req.curtainCompanyId,req.params.id,b.name,b.width_m,b.height_m,b.width_step_cm,b.height_step_cm,b.width_step_cents,b.height_step_cents,b.cost_cents,b.profit_cents,JSON.stringify(b.materials),b.description])
 if(!r.rowCount)return res.status(404).json({message:'Modelo não encontrado.'});res.json(r.rows[0])
 }catch(e){next(e)}})
router.delete('/models/:id',allowed,async(req,res,next)=>{try{const p=await pool();const r=await p.query('DELETE FROM app_curtain_models WHERE company_id=$1 AND id=$2 RETURNING id',[req.curtainCompanyId,req.params.id]);if(!r.rowCount)return res.status(404).json({message:'Modelo não encontrado.'});res.json({ok:true})}catch(e){next(e)}})
module.exports=router
