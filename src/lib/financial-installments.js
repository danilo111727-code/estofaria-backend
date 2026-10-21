'use strict'
const {createHash}=require('crypto')
const TABLE='app_financial_entries_v2',REQUESTS='app_financial_installment_requests_v2'
function problem(code,message,statusCode=400){return Object.assign(new Error(message),{code,statusCode})}
function clean(v){return String(v??'').trim()}
function normalize(input){
 const tipo=clean(input.tipo),descricao=clean(input.descricao),date=clean(input.dataVencimento)
 const n=Number(input.parcelas),value=Number(input.valor),cents=Math.round(value*100),requestId=clean(input.grupo_id)
 if(!['pagar','receber'].includes(tipo)||!descricao||descricao.length>1000)throw problem('installments_invalid','Informe o tipo e a descrição do lançamento.')
 if(!Number.isInteger(n)||n<2||n>100)throw problem('installments_invalid','Informe de 2 a 100 parcelas.')
 if(!Number.isFinite(value)||!Number.isSafeInteger(cents)||cents<n||cents>99999999999999)throw problem('installments_invalid','O valor deve permitir pelo menos R$ 0,01 por parcela.')
 const d=new Date(date+'T12:00:00Z')
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(d.getTime())||d.toISOString().slice(0,10)!==date)throw problem('installments_invalid','Informe um vencimento válido.')
 if(!/^[a-zA-Z0-9_-]{8,100}$/.test(requestId))throw problem('installments_invalid','Identificador do parcelamento inválido. Atualize a página.')
 const fields={tipo,descricao,cliente:clean(input.cliente),fornecedor:clean(input.fornecedor),categoria:clean(input.categoria),formaPagamento:clean(input.formaPagamento),dataVencimento:date,centavos:cents,parcelas:n}
 return {requestId,fields,hash:createHash('sha256').update(JSON.stringify(fields)).digest('hex')}
}
function monthDate(date,offset){
 const [y,m,day]=date.split('-').map(Number),d=new Date(Date.UTC(y,m-1+offset,1,12))
 d.setUTCDate(Math.min(day,new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate()))
 const result=d.toISOString().slice(0,10)
 if(!/^\d{4}-\d{2}-\d{2}$/.test(result))throw problem('installments_invalid','Vencimento fora do intervalo suportado.')
 return result
}
async function createInstallments(pool,companyId,input,fromRow){
 const {requestId,fields:f,hash}=normalize(input),client=await pool.connect()
 try{
  await client.query('BEGIN')
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))',[companyId,'installments:'+requestId])
  const previous=await client.query(`SELECT * FROM ${REQUESTS} WHERE company_id=$1 AND request_id=$2`,[companyId,requestId])
  if(previous.rows.length){
   const p=previous.rows[0]
   if(p.request_hash!==hash)throw problem('installments_conflict','Este parcelamento já foi enviado com outros dados. Atualize a página.',409)
   const existing=await client.query(`SELECT * FROM ${TABLE} WHERE company_id=$1 AND id=ANY($2::text[])`,[companyId,p.entry_ids])
   if(existing.rows.length!==f.parcelas)throw problem('installments_changed','Este parcelamento já foi criado e depois alterado ou excluído. Atualize a página.',409)
   const byId=new Map(existing.rows.map(r=>[r.id,r]))
   await client.query('COMMIT')
   return {items:p.entry_ids.map(id=>fromRow(byId.get(id))),replayed:true}
  }
  // Não reaproveitar grupos antigos parcialmente gravados por outra versão.
  const legacy=await client.query(`SELECT id FROM ${TABLE} WHERE company_id=$1 AND payload->>'grupo_id'=$2 LIMIT 1`,[companyId,requestId])
  if(legacy.rows.length)throw problem('installments_conflict','Já existe um lançamento com este grupo. Atualize a página.',409)
  const items=[],ids=[],base=Math.floor(f.centavos/f.parcelas),rest=f.centavos%f.parcelas
  for(let i=0;i<f.parcelas;i++){
   const id='parc_'+createHash('sha256').update(JSON.stringify([companyId,requestId,i])).digest('hex').slice(0,40)
   const item={tipo:f.tipo,descricao:`${f.descricao} (${i+1}/${f.parcelas})`,cliente:f.cliente,fornecedor:f.fornecedor,categoria:f.categoria,formaPagamento:f.formaPagamento,valor:(base+(i<rest?1:0))/100,dataVencimento:monthDate(f.dataVencimento,i),status:'pendente',lancamento_tipo:'parcelado',grupo_id:requestId,parcela_atual:i+1,parcelas_total:f.parcelas}
   const r=await client.query(`INSERT INTO ${TABLE}(company_id,id,tipo,descricao,cliente,fornecedor,valor,data_vencimento,status,forma_pagamento,categoria,payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'pendente',$9,$10,$11::jsonb) RETURNING *`,[companyId,id,item.tipo,item.descricao,item.cliente,item.fornecedor,item.valor,item.dataVencimento,item.formaPagamento,item.categoria,JSON.stringify(item)])
   ids.push(id);items.push(fromRow(r.rows[0]))
  }
  await client.query(`INSERT INTO ${REQUESTS}(company_id,request_id,request_hash,entry_ids) VALUES($1,$2,$3,$4::jsonb)`,[companyId,requestId,hash,JSON.stringify(ids)])
  await client.query('COMMIT')
  return {items,replayed:false}
 }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error}finally{client.release()}
}
module.exports={createInstallments}
