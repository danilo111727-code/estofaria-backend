'use strict'
const {randomUUID} = require('crypto')
let enabled = false
const CATEGORIES = ['materiais','catalogo','adicionais','vendas','agenda','financeiro']
const TABLES = new Set(['app_quotes_v2','app_quote_models_v2','app_quote_model_items_v2','app_agenda_orders_v2','app_agenda_blocos_v2','app_financial_entries_v2'])
const text = x => String(x ?? '')
const clone = x => JSON.parse(JSON.stringify(x))
const pool = () => require('./store')._pg.pool
function conflict(message){ return Object.assign(new Error(message),{status:409,code:'restore_conflict'}) }
async function ensureSchema(db=pool()){
  await db.query(`CREATE TABLE IF NOT EXISTS app_trash_v1 (
    id TEXT PRIMARY KEY, company_id TEXT NOT NULL, category TEXT NOT NULL,
    kind TEXT NOT NULL, record_key TEXT NOT NULL, title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '', amount_cents BIGINT,
    snapshot JSONB NOT NULL, deleted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW()+INTERVAL '30 days'),
    UNIQUE(company_id,kind,record_key), CHECK(category IN ('materiais','catalogo','adicionais','vendas','agenda','financeiro'))
  ); CREATE INDEX IF NOT EXISTS idx_trash_company_expiry ON app_trash_v1(company_id,expires_at);
  CREATE INDEX IF NOT EXISTS idx_trash_expiry ON app_trash_v1(expires_at);
  CREATE TABLE IF NOT EXISTS app_trash_object_cleanup_v1 (
    company_id TEXT NOT NULL, object_key TEXT NOT NULL, PRIMARY KEY(company_id,object_key)
  );`)
  enabled=true
}
async function archive(client,companyId,category,kind,key,snapshot,deletedAt=null){
  if(!enabled) return null
  if(!companyId || !CATEGORIES.includes(category)) throw new Error('invalid_trash_record')
  const row=snapshot.row || snapshot.quote || snapshot
  const title=text(row.cliente || row.name || row.nome || row.descricao || (kind==='block'?'Bloco da Agenda':'Registro excluído')).slice(0,300)
  const amount=row.total_cents ?? row.price_cents ?? (row.valor===undefined?null:Math.round(Number(row.valor)*100))
  const description=kind==='quote'?(snapshot.models||[]).map(m=>m.model_name).filter(Boolean).join(' · '):text(row.description || row.descricao || row.unit || row.unidade)
  const result=await client.query(`INSERT INTO app_trash_v1
    (id,company_id,category,kind,record_key,title,description,amount_cents,snapshot,deleted_at,expires_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,COALESCE($10::timestamptz,NOW()),COALESCE($10::timestamptz,NOW())+INTERVAL '30 days')
    ON CONFLICT(company_id,kind,record_key) DO UPDATE SET
      id=EXCLUDED.id,snapshot=EXCLUDED.snapshot,title=EXCLUDED.title,description=EXCLUDED.description,
      amount_cents=EXCLUDED.amount_cents,deleted_at=EXCLUDED.deleted_at,expires_at=EXCLUDED.expires_at
      WHERE app_trash_v1.expires_at<=NOW() RETURNING id`,
    [randomUUID(),text(companyId),category,kind,text(key),title,description.slice(0,1000),amount,JSON.stringify(snapshot),deletedAt])
  return result.rows[0]?.id || null
}
async function transaction(db,work){
  const client=await db.connect()
  try{await client.query('BEGIN');const result=await work(client);await client.query('COMMIT');return result}
  catch(e){await client.query('ROLLBACK').catch(()=>{});throw e}finally{client.release()}
}
async function archiveQuote(client,companyId,id,agendaRef){
  if(!enabled)return
  const result=await client.query('SELECT * FROM app_quotes_v2 WHERE company_id=$1 AND id=$2 FOR UPDATE',[companyId,id])
  const quote=result.rows[0];if(!quote)return
  const models=(await client.query('SELECT * FROM app_quote_models_v2 WHERE company_id=$1 AND quote_id=$2 ORDER BY sort_order',[companyId,id])).rows
  const model_items=(await client.query('SELECT i.* FROM app_quote_model_items_v2 i JOIN app_quote_models_v2 m ON m.id=i.quote_model_id AND m.company_id=i.company_id WHERE m.company_id=$1 AND m.quote_id=$2',[companyId,id])).rows
  const agenda=(await client.query(`SELECT * FROM app_agenda_orders_v2 WHERE company_id=$1 AND ${agendaRef}=ANY($2::text[]) FOR UPDATE`,[companyId,[quote.id,quote.legacy_id].filter(Boolean)])).rows
  const customer_link=quote.payload_meta?.customer_id
    ? (await client.query('SELECT * FROM app_customer_quotes_v1 WHERE company_id=$1 AND quote_id=$2',[companyId,id])).rows[0] || null
    : null
  await archive(client,companyId,'vendas','quote',id,{quote,models,model_items,agenda,...(customer_link?{customer_link}:{})})
}
async function deleteRow(db,table,companyId,id,category,kind){
  return transaction(db,async client=>{
    const row=(await client.query(`SELECT * FROM ${table} WHERE company_id=$1 AND id=$2 FOR UPDATE`,[companyId,id])).rows[0]
    if(!row)return false
    await archive(client,companyId,category,kind,id,{row})
    await client.query(`DELETE FROM ${table} WHERE company_id=$1 AND id=$2`,[companyId,id])
    return true
  })
}
async function hideHistory(db,table,companyId,id,category,kind,statuses){
  return transaction(db,async client=>{
    const row=(await client.query(`SELECT * FROM ${table} WHERE company_id=$1 AND id=$2 AND LOWER(status)=ANY($3::text[]) FOR UPDATE`,[companyId,id,statuses])).rows[0]
    if(!row)return false
    if(row.payload?.history_removed_at)return true
    await archive(client,companyId,category,kind,id,{row})
    await client.query(`UPDATE ${table} SET payload=jsonb_set(COALESCE(payload,'{}'::jsonb),'{history_removed_at}',to_jsonb(NOW()),true) WHERE company_id=$1 AND id=$2`,[companyId,id])
    return true
  })
}
async function captureStoreDeletes(client,before,after){
  if(!enabled)return
  const companies=new Set((after.companies||[]).map(c=>text(c.id)))
  for(const [collection,category] of Object.entries({materials:'materiais',quotes:'vendas',agendaOrders:'agenda',financialEntries:'financeiro',models:'catalogo',personalizationItems:'adicionais'})){
    const kept=new Set((after[collection]||[]).map(r=>text(r.company_id)+':'+text(r.id)))
    for(const row of before[collection]||[]){
      if(!companies.has(text(row.company_id)) || kept.has(text(row.company_id)+':'+text(row.id)))continue
      await archive(client,row.company_id,category,'legacy:'+collection,row.id,{row,collection})
    }
  }
}
const nameKey=r=>text(r?.name || r?.nome).trim().toLocaleLowerCase('pt-BR')
async function captureCatalogDeletes(client,companyId,before,after){
  if(!enabled)return
  for(const collection of ['albums','groups','items']){
    const old=before[collection]||[],next=after[collection]||[]
    for(const row of old){
      const exists=next.find(n=>text(n.id)===text(row.id))
      if(!exists){
        // Álbuns/grupos e a referência na lista de itens são um único registro recuperável.
        if(collection==='items' && (row.isAlbum||row.isGrupo)){
          const parentCollection=row.isAlbum?'albums':'groups'
          if((before[parentCollection]||[]).some(p=>nameKey(p)===nameKey(row)) && !(after[parentCollection]||[]).some(p=>nameKey(p)===nameKey(row)))continue
        }
        const companions=collection==='items'?[]:(before.items||[]).filter(i=>(collection==='albums'?i.isAlbum:i.isGrupo)&&nameKey(i)===nameKey(row))
        await archive(client,companyId,'adicionais','catalog:'+collection,row.id,{row,collection,companions})
      }else if(collection==='albums' && (exists.itens||[]).length<(row.itens||[]).length){
        const key=i=>text(i.codigo)+'|'+nameKey(i)
        const keys=new Set((exists.itens||[]).map(key))
        for(const item of row.itens||[])if(!keys.has(key(item)))await archive(client,companyId,'adicionais','catalog:album-item',text(row.id)+':'+key(item),{row:item,collection:'album-item',album_id:row.id,album_name:row.nome})
      }
    }
  }
}
async function list(companyId,category=null,offset=0){
  const db=pool(),counts=(await db.query(`SELECT category,COUNT(*)::int AS count FROM app_trash_v1 WHERE company_id=$1 AND expires_at>NOW() GROUP BY category`,[companyId])).rows
  if(!category)return {categories:CATEGORIES.map(key=>({key,count:counts.find(c=>c.category===key)?.count||0})),retention_days:30}
  const items=(await db.query(`SELECT id,category,kind,title,description,amount_cents,deleted_at,expires_at,snapshot->'quote'->>'status' AS original_status,
    GREATEST(1,CEIL(EXTRACT(EPOCH FROM(expires_at-NOW()))/86400))::int AS days_remaining
    FROM app_trash_v1 WHERE company_id=$1 AND category=$2 AND expires_at>NOW()
    ORDER BY deleted_at DESC,id DESC LIMIT 50 OFFSET $3`,[companyId,category,offset])).rows
  return {items,total:counts.find(c=>c.category===category)?.count||0,offset,limit:50}
}
async function insertRow(client,table,row,companyId,{omitId=false}={}){
  if(!TABLES.has(table) || text(row.company_id)!==text(companyId))throw new Error('invalid_restore_scope')
  const columns=(await client.query(`SELECT column_name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name=$1 ORDER BY ordinal_position`,[table])).rows.map(x=>x.column_name).filter(k=>Object.hasOwn(row,k)&&(!omitId||k!=='id'))
  if(!columns.length)throw new Error('invalid_restore_row')
  const names=columns.map(c=>'"'+c+'"').join(',')
  await client.query(`INSERT INTO ${table} (${names}) SELECT ${names} FROM jsonb_populate_record(NULL::${table},$1::jsonb)`,[JSON.stringify(row)])
}
function quoteRef(row){return row.source_quote_id||row.payload?.source_quote_id||row.payload?.sourceQuoteId||row.payload?.quote_id||row.payload?.quoteId||row.payload?.orcamento_id||row.payload?.budget_id||''}
async function prepareAgenda(client,companyId,raw,{restoringQuote=false}={}){
  const row=clone(raw),ref=quoteRef(row)
  if(ref && !restoringQuote){
    const found=await client.query('SELECT id FROM app_quotes_v2 WHERE company_id=$1 AND (id=$2 OR legacy_id=$2) AND active=TRUE',[companyId,ref])
    if(!found.rows.length)throw conflict('Recupere primeiro o pedido em Orçamentos e Vendas.')
  }
  if(row.bloco_id && ['entregue','cancelado','indisponivel'].includes(row.status)){row.bloco_id=null;row.payload={...(row.payload||{}),bloco_id:null,agenda_bloco_id:null}}
  if(row.bloco_id){
    const block=(await client.query('SELECT * FROM app_agenda_blocos_v2 WHERE company_id=$1 AND id=$2 FOR UPDATE',[companyId,row.bloco_id])).rows[0]
    const count=block?Number((await client.query("SELECT COUNT(*)::int AS n FROM app_agenda_orders_v2 WHERE company_id=$1 AND bloco_id=$2 AND status NOT IN ('entregue','cancelado','indisponivel')",[companyId,row.bloco_id])).rows[0].n):0
    if(!block || count>=Number(block.qtd_vagas)){
      row.bloco_id=null;row.prod_date='';row.ent_date=''
      row.payload={...(row.payload||{}),bloco_id:null,prod_date:'',ent_date:'',agenda_bloco_id:null,agenda_status:'pendente',data_producao:'',data_entrega:''}
    }
  }
  return row
}
async function syncQuoteAgenda(client,companyId,row){
  const ref=quoteRef(row);if(!ref)return
  await client.query(`UPDATE app_quotes_v2 SET payload_meta=payload_meta || $3::jsonb,updated_at=NOW()
    WHERE company_id=$1 AND (id=$2 OR legacy_id=$2)`,[companyId,ref,JSON.stringify({agenda_order_id:row.id,agenda_bloco_id:row.bloco_id||null,agenda_status:row.status==='entregue'?'pronta_entrega':row.bloco_id?'agendado':'pendente',data_producao:row.prod_date||'',data_entrega:row.ent_date||''})])
}
async function restore(client,companyId,id,{restoreLegacy}={}){
  const found=await client.query('SELECT * FROM app_trash_v1 WHERE company_id=$1 AND id=$2 AND expires_at>NOW() FOR UPDATE',[companyId,id])
  const item=found.rows[0];if(!item)throw Object.assign(new Error('Item não encontrado ou prazo de recuperação encerrado.'),{status:404})
  const s=item.snapshot
  if(item.kind==='quote'){
    if(text(s.quote?.company_id)!==text(companyId))throw new Error('invalid_restore_scope')
    await insertRow(client,'app_quotes_v2',s.quote,companyId)
    if(s.customer_link && text(s.customer_link.company_id)===text(companyId)){
      await client.query('INSERT INTO app_customer_quotes_v1(company_id,quote_id,customer_id,purchase_date) VALUES($1,$2,$3,$4)',[companyId,s.quote.id,s.customer_link.customer_id,s.customer_link.purchase_date])
    }
    for(const m of s.models||[])await insertRow(client,'app_quote_models_v2',m,companyId)
    for(const m of s.model_items||[])await insertRow(client,'app_quote_model_items_v2',m,companyId,{omitId:true})
    for(const raw of s.agenda||[]){
      const row=await prepareAgenda(client,companyId,raw,{restoringQuote:true})
      await insertRow(client,'app_agenda_orders_v2',row,companyId);await syncQuoteAgenda(client,companyId,row)
    }
  }else if(item.kind==='model'){
    const r=await client.query('UPDATE app_models_v2 SET active=TRUE,updated_at=NOW() WHERE company_id=$1 AND id=$2 AND active=FALSE RETURNING id',[companyId,item.record_key])
    if(!r.rows.length)throw conflict('Este modelo já está ativo ou não está mais disponível.')
  }else if(item.kind==='ready-model'){
    const r=await client.query('UPDATE app_ready_models_v1 SET active=TRUE,revision=revision+1,updated_at=NOW() WHERE company_id=$1 AND id=$2 AND active=FALSE RETURNING id',[companyId,item.record_key])
    if(!r.rows.length)throw conflict('Este modelo já está ativo ou não está mais disponível.')
  }else if(item.kind==='financial'){
    const payload=s.row.payload||{},quoteId=text(payload.quote_id||payload.source_quote_id),agendaId=text(payload.agenda_order_id||payload.order_id)
    if(quoteId||agendaId){
      const linked=(await client.query(`SELECT payload FROM app_financial_entries_v2 WHERE company_id=$1 AND tipo=$2
        AND (($3<>'' AND COALESCE(payload->>'quote_id',payload->>'source_quote_id','')=$3)
          OR ($4<>'' AND COALESCE(payload->>'agenda_order_id',payload->>'order_id','')=$4))`,[companyId,s.row.tipo,quoteId,agendaId])).rows
      const installment=p=>text(p.parcela_index??p.parcela_numero??p.parcela??p.installment_index??'')
      if(linked.some(r=>text(r.payload?.financial_source)===text(payload.financial_source)&&installment(r.payload||{})===installment(payload)))throw conflict('Já existe um lançamento financeiro vinculado a este pedido. Nenhuma conta foi duplicada.')
    }
    await insertRow(client,'app_financial_entries_v2',s.row,companyId)
  }
  else if(item.kind==='agenda'){
    const row=await prepareAgenda(client,companyId,s.row)
    await insertRow(client,'app_agenda_orders_v2',row,companyId);await syncQuoteAgenda(client,companyId,row)
  }else if(item.kind==='agenda-unschedule'){
    const current=(await client.query('SELECT * FROM app_agenda_orders_v2 WHERE company_id=$1 AND id=$2 FOR UPDATE',[companyId,item.record_key])).rows[0]
    if(!current || new Date(current.updated_at).getTime()!==new Date(s.expected_updated_at).getTime())throw conflict('Este agendamento foi alterado depois da exclusão. Confira o pedido na Agenda antes de recuperar.')
    const row=await prepareAgenda(client,companyId,s.row)
    await client.query('UPDATE app_agenda_orders_v2 SET bloco_id=$3,descricao=$4,prod_date=$5,ent_date=$6,status=$7,payload=$8::jsonb,updated_at=NOW() WHERE company_id=$1 AND id=$2',[companyId,item.record_key,row.bloco_id,row.descricao,row.prod_date,row.ent_date,row.status,JSON.stringify(row.payload)])
    await syncQuoteAgenda(client,companyId,row)
  }else if(item.kind==='block'){
    await insertRow(client,'app_agenda_blocos_v2',s.row,companyId)
    for(const raw of s.orders||[]){const row=await prepareAgenda(client,companyId,raw);await insertRow(client,'app_agenda_orders_v2',row,companyId);await syncQuoteAgenda(client,companyId,row)}
  }else if(['agenda-history','financial-history'].includes(item.kind)){
    const table=item.kind==='agenda-history'?'app_agenda_orders_v2':'app_financial_entries_v2'
    const r=await client.query(`UPDATE ${table} SET payload=payload-'history_removed_at' WHERE company_id=$1 AND id=$2 RETURNING id`,[companyId,item.record_key])
    if(!r.rows.length)throw conflict('Recupere primeiro o registro original.')
  }else if(item.kind.startsWith('legacy:')){
    if(!restoreLegacy)throw new Error('legacy_restore_unavailable')
    await restoreLegacy(s,companyId)
  }else if(item.kind.startsWith('catalog:'))await restoreCatalog(client,companyId,s)
  else throw new Error('unsupported_trash_kind')
  await client.query('DELETE FROM app_trash_v1 WHERE company_id=$1 AND id=$2',[companyId,id])
  return {ok:true,category:item.category,title:item.title}
}
async function restoreCatalog(client,companyId,s){
  const current=(await client.query('SELECT * FROM app_personalization_catalog_v2 WHERE company_id=$1 FOR UPDATE',[companyId])).rows[0]
  if(!current)throw conflict('O catálogo de adicionais não está disponível.')
  function add(collection,row){
    if((current[collection]||[]).some(r=>text(r.id)===text(row.id)||nameKey(r)===nameKey(row)))throw conflict('Já existe um item com este nome ou identificador. Nenhum dado foi sobrescrito.')
    current[collection]=(current[collection]||[]).concat(row)
  }
  if(s.collection==='album-item'){
    const album=(current.albums||[]).find(a=>text(a.id)===text(s.album_id))
    if(!album)throw conflict('Recupere primeiro o álbum de tecido.')
    if((album.itens||[]).some(i=>text(i.codigo)===text(s.row.codigo)&&nameKey(i)===nameKey(s.row)))throw conflict('Este tecido já está no álbum.')
    album.itens=(album.itens||[]).concat(s.row)
  }else{
    if(!['items','albums','groups'].includes(s.collection))throw new Error('invalid_catalog_collection')
    add(s.collection,s.row)
    for(const row of s.companions||[])if(!(current.items||[]).some(r=>text(r.id)===text(row.id)||nameKey(r)===nameKey(row)))add('items',row)
  }
  await client.query('UPDATE app_personalization_catalog_v2 SET items=$2::jsonb,albums=$3::jsonb,groups=$4::jsonb,revision=revision+1,updated_at=NOW() WHERE company_id=$1',[companyId,JSON.stringify(current.items),JSON.stringify(current.albums),JSON.stringify(current.groups)])
}
function objectKeys(snapshot){
  const keys=new Set()
  function walk(x){if(!x||typeof x!=='object')return;for(const[k,v]of Object.entries(x)){if(['quote_image_key','object_key'].includes(k)&&typeof v==='string')keys.add(v);else if(typeof v==='object')walk(v)}}
  walk(snapshot);return [...keys]
}
async function purgeExpired(db=pool()){
  if(!enabled)return
  await transaction(db,async client=>{
    const rows=(await client.query('SELECT * FROM app_trash_v1 WHERE expires_at<=NOW() ORDER BY expires_at LIMIT 100 FOR UPDATE SKIP LOCKED')).rows
    for(const item of rows){
      for(const key of objectKeys(item.snapshot))if(key.startsWith('companies/'+item.company_id+'/')&&!key.includes('..')){
        await client.query('INSERT INTO app_trash_object_cleanup_v1(company_id,object_key) VALUES($1,$2) ON CONFLICT DO NOTHING',[item.company_id,key])
      }
      if(item.kind==='quote' && (await client.query("SELECT to_regclass('app_revenue_adjustments_v1') AS name")).rows[0]?.name){
        await client.query("DELETE FROM app_revenue_adjustments_v1 WHERE company_id=$1 AND record_key=$2 AND NOT EXISTS(SELECT 1 FROM app_quotes_v2 WHERE company_id=$1 AND id=$3)",[item.company_id,'quote:'+item.record_key,item.record_key])
      }
      if(item.kind==='model')await client.query('DELETE FROM app_models_v2 WHERE company_id=$1 AND id=$2 AND active=FALSE',[item.company_id,item.record_key])
      if(item.kind==='ready-model')await client.query('DELETE FROM app_ready_models_v1 WHERE company_id=$1 AND id=$2 AND active=FALSE',[item.company_id,item.record_key])
      await client.query('DELETE FROM app_trash_v1 WHERE company_id=$1 AND id=$2',[item.company_id,item.id])
    }
  })
  const r2=require('./r2-storage');if(!r2.isConfigured())return
  const queued=(await db.query('SELECT company_id,object_key FROM app_trash_object_cleanup_v1 LIMIT 100')).rows
  for(const row of queued){
    // Nunca apaga uma imagem ainda referenciada por outro registro ativo ou pela lixeira.
    const used=await db.query(`SELECT EXISTS(SELECT 1 FROM app_quote_models_v2 WHERE company_id=$1 AND extra->>'quote_image_key'=$2)
      OR EXISTS(SELECT 1 FROM app_model_images_v2 WHERE company_id=$1 AND object_key=$2)
      OR EXISTS(SELECT 1 FROM app_ready_models_v1 WHERE company_id=$1 AND images::text LIKE '%'||$2||'%')
      OR EXISTS(SELECT 1 FROM app_trash_v1 WHERE company_id=$1 AND snapshot::text LIKE '%'||$2||'%') AS used`,[row.company_id,row.object_key])
    if(!used.rows[0].used)await r2.deleteObject(row.object_key)
    await db.query('DELETE FROM app_trash_object_cleanup_v1 WHERE company_id=$1 AND object_key=$2',[row.company_id,row.object_key])
  }
}
function startCleanup(){
  let running=false
  const run=async()=>{if(running)return;running=true;try{await purgeExpired()}catch(e){console.error('[trash] Falha na limpeza automática:',e.message)}finally{running=false}}
  run();const timer=setInterval(run,60000);timer.unref();return timer
}
async function deleteCompany(client,companyId){
  const exists=await client.query("SELECT to_regclass('app_trash_v1') AS name")
  if(!exists.rows[0]?.name)return
  await client.query('DELETE FROM app_trash_v1 WHERE company_id=$1',[companyId])
  await client.query('DELETE FROM app_trash_object_cleanup_v1 WHERE company_id=$1',[companyId])
}
async function importRecovery(client,companyId,bundle){
  if(bundle?.format!=='estofaria-recovery-bundle'||bundle.version!==1||bundle.company_id!==companyId||!Array.isArray(bundle.records)||bundle.records.length>100)throw Object.assign(new Error('Arquivo de recuperação inválido para esta empresa.'),{status:400})
  let imported=0
  for(const r of bundle.records){
    const id=text(r.requested_id)
    if(!r.quote || r.quote.id!==id || r.quote.company_id!==companyId)throw Object.assign(new Error('Pedido inválido no arquivo.'),{status:400})
    if((r.models||[]).some(m=>m.company_id!==companyId||m.quote_id!==id)||(r.model_items||[]).some(i=>i.company_id!==companyId||!(r.models||[]).some(m=>m.id===i.quote_model_id))||(r.agenda||[]).some(a=>a.company_id!==companyId))throw Object.assign(new Error('Vínculos inválidos no arquivo.'),{status:400})
    const event=(await client.query("SELECT created_at FROM app_audit_logs_v2 WHERE company_id=$1 AND action='quote.delete' AND message=$2 ORDER BY created_at DESC LIMIT 1",[companyId,'Orçamento removido: '+id])).rows[0]
    if(!event || Date.now()-new Date(event.created_at).getTime()>=30*86400000)throw conflict('Exclusão não encontrada ou prazo de 30 dias encerrado.')
    if((await client.query('SELECT id FROM app_quotes_v2 WHERE id=$1',[id])).rows.length)throw conflict('Um dos pedidos já existe. Nenhum dado foi importado.')
    const saved=await archive(client,companyId,'vendas','quote',id,{quote:r.quote,models:r.models||[],model_items:r.model_items||[],agenda:r.agenda||[],recovered_from_backup:true},event.created_at)
    if(saved)imported++
  }
  return {ok:true,imported}
}
module.exports={CATEGORIES,ensureSchema,archive,archiveQuote,deleteRow,hideHistory,captureStoreDeletes,captureCatalogDeletes,list,restore,transaction,purgeExpired,startCleanup,deleteCompany,importRecovery,objectKeys}

