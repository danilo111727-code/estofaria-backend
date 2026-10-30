'use strict'
const express=require('express')
const {requireAuth}=require('../middleware/auth')
const {hasMasterAccess,hasPermission}=require('../lib/policies')
const store=require('../lib/store')
const atomic=require('../lib/atomic-store')
const trash=require('../lib/trash-db')
const orphans=require('../lib/orphan-agenda-db')
const router=express.Router()
const permissions={materiais:'material',catalogo:'precificacao',adicionais:'itens-personalizacao',vendas:'vendedor',agenda:'agenda',financeiro:'financeiro'}
router.use('/trash',requireAuth,(req,res,next)=>{
  if(!hasPermission(req.user,'configuracao'))return res.status(403).json({message:'Sem acesso à lixeira.'})
  const companyId=String(hasMasterAccess(req.user)?req.query.company_id||req.body?.company_id||req.user.company_id||'':req.user.company_id||'').trim()
  if(!companyId)return res.status(400).json({message:'Selecione uma empresa para consultar a lixeira.'})
  if(!(store.readStore().companies||[]).some(c=>String(c.id)===companyId))return res.status(404).json({message:'Empresa não encontrada.'})
  req.trashCompanyId=companyId;next()
})
function can(req,category){return permissions[category]&&hasPermission(req.user,permissions[category])}
function fail(err,res,next){
  if(err.code==='23505')return res.status(409).json({message:'Já existe um registro com este identificador. Nenhum dado foi sobrescrito.'})
  if(err.status)return res.status(err.status).json({message:err.message})
  next(err)
}
router.get('/trash',async(req,res,next)=>{
  try{
    const category=req.query.category||null
    if(category&&!can(req,category))return res.status(403).json({message:'Sem acesso a esta categoria.'})
    const offset=Math.max(0,Math.min(100000,Math.floor(Number(req.query.offset)||0)))
    const data=await trash.list(req.trashCompanyId,category,offset)
    if(data.categories)data.categories=data.categories.filter(c=>can(req,c.key))
    res.json({...data,can_import_recovery:hasMasterAccess(req.user),can_manage_orphans:can(req,'agenda')})
  }catch(e){fail(e,res,next)}
})
router.get('/trash/orphans',async(req,res,next)=>{
  try{
    if(!can(req,'agenda'))return res.status(403).json({message:'Sem acesso aos registros da Agenda.'})
    const offset=Math.max(0,Math.min(100000,Math.floor(Number(req.query.offset)||0)))
    res.json(await orphans.list(req.trashCompanyId,offset))
  }catch(e){fail(e,res,next)}
})
router.post('/trash/orphans/:id/exclude',async(req,res,next)=>{
  try{
    if(!can(req,'agenda'))return res.status(403).json({message:'Sem permissão para excluir registros da Agenda.'})
    const client=atomic.getTransactionClient();if(!client)throw Object.assign(new Error('A exclusão requer armazenamento transacional.'),{status:503})
    const result=await orphans.exclude(client,req.trashCompanyId,req.params.id,req.body?.expected_updated_at)
    const current=store.readStore()
    store.upsertAudit(current,{company_id:req.trashCompanyId,action:'trash.orphan.exclude',message:'Pendência órfã removida do Painel: '+req.params.id,actor_name:req.user.name||req.user.email,actor_email:req.user.email,source:'trash-api'})
    store.writeStore(current);atomic.markTransactionDirty();res.json(result)
  }catch(e){fail(e,res,next)}
})
router.post('/trash/:id/restore',async(req,res,next)=>{
  try{
    const client=atomic.getTransactionClient();if(!client)throw Object.assign(new Error('A recuperação requer armazenamento transacional.'),{status:503})
    const found=(await client.query('SELECT category FROM app_trash_v1 WHERE company_id=$1 AND id=$2',[req.trashCompanyId,req.params.id])).rows[0]
    if(!found)return res.status(404).json({message:'Item não encontrado ou já recuperado.'})
    if(!can(req,found.category))return res.status(403).json({message:'Sem permissão para recuperar este item.'})
    const result=await trash.restore(client,req.trashCompanyId,req.params.id,{restoreLegacy:async(s,companyId)=>{
      const collections=new Set(['materials','quotes','agendaOrders','financialEntries','models','personalizationItems'])
      if(!collections.has(s.collection)||String(s.row?.company_id)!==companyId)throw new Error('invalid_restore_scope')
      const current=store.readStore(),rows=current[s.collection]||[]
      if(rows.some(r=>String(r.company_id)===companyId&&String(r.id)===String(s.row.id)))throw Object.assign(new Error('Este registro já existe. Nenhum dado foi sobrescrito.'),{status:409})
      current[s.collection]=rows.concat(s.row);store.writeStore(current)
    }})
    const current=store.readStore()
    store.upsertAudit(current,{company_id:req.trashCompanyId,action:'trash.restore',message:'Registro recuperado da lixeira: '+result.title,actor_name:req.user.name||req.user.email,actor_email:req.user.email,source:'trash-api'})
    store.writeStore(current);atomic.markTransactionDirty();res.json(result)
  }catch(e){fail(e,res,next)}
})
router.post('/trash/import-recovery',async(req,res,next)=>{
  try{
    if(!hasMasterAccess(req.user))return res.status(403).json({message:'Importação restrita ao administrador da plataforma.'})
    const client=atomic.getTransactionClient();if(!client)throw Object.assign(new Error('Armazenamento transacional indisponível.'),{status:503})
    const result=await trash.importRecovery(client,req.trashCompanyId,req.body.bundle)
    const current=store.readStore();store.upsertAudit(current,{company_id:req.trashCompanyId,action:'trash.import',message:result.imported+' registros importados de recuperação',actor_name:req.user.name||req.user.email,actor_email:req.user.email,source:'trash-api'});store.writeStore(current)
    atomic.markTransactionDirty();res.json(result)
  }catch(e){fail(e,res,next)}
})
module.exports=router
