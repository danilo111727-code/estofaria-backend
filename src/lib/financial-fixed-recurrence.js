'use strict'
const {randomUUID,createHash}=require('crypto')
const TABLE='app_financial_entries_v2'
const fixedType=item=>String(item?.lancamento_tipo || item?.recorrencia_tipo || '').toLowerCase()==='fixo'
const seriesId=item=>String(item.recorrencia_id || ('fixo_'+item.id))
function problem(code,message,statusCode=409){return Object.assign(new Error(message),{code,statusCode})}
function dateParts(value){
  const raw=String(value || '').slice(0,10)
  if(!/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw problem('fixed_invalid_date','Informe um vencimento válido para esta conta fixa.',400)
  const d=new Date(raw+'T12:00:00Z')
  if(!Number.isFinite(d.getTime()) || d.toISOString().slice(0,10)!==raw) throw problem('fixed_invalid_date','Informe um vencimento válido para esta conta fixa.',400)
  return raw.split('-').map(Number)
}
function nextDate(value,anchor){
  const [year,month]=dateParts(value)
  const d=new Date(Date.UTC(year,month,1,12)),last=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate()
  d.setUTCDate(Math.min(anchor,last))
  return d.toISOString().slice(0,10)
}
function generatedId(companyId,tipo,series,due){return 'fixo_'+createHash('sha256').update(JSON.stringify([companyId,tipo,series,due])).digest('hex').slice(0,40)}
async function lock(client,companyId,tipo,series){
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))',[String(companyId),JSON.stringify([tipo,series])])
}
async function transaction(pool,action){
  const client=await pool.connect()
  try{await client.query('BEGIN');const result=await action(client);await client.query('COMMIT');return result}
  catch(error){await client.query('ROLLBACK').catch(()=>{});throw error}
  finally{client.release()}
}
function editable(current,patch){
  const next={...current}
  for(const key of ['descricao','cliente','fornecedor','formaPagamento','categoria'])if(patch[key]!==undefined)next[key]=String(patch[key]??'').trim()
  if(patch.valor!==undefined){const v=Number(patch.valor);if(!Number.isFinite(v)||v<=0)throw problem('fixed_invalid_value','Informe um valor maior que zero.',400);next.valor=v}
  if(patch.dataVencimento!==undefined){dateParts(patch.dataVencimento);next.dataVencimento=String(patch.dataVencimento).slice(0,10);if(next.dataVencimento!==current.dataVencimento)next.recorrencia_dia=Number(next.dataVencimento.slice(8,10))}
  if(patch.status!==undefined){const value=String(patch.status).toLowerCase();if(!['pendente',current.tipo==='receber'?'recebido':'pago'].includes(value))throw problem('fixed_invalid_status','Status incompatível com esta conta fixa.',400);next.status=value}
  return next
}
function payloadFor(item){
  const payload={...item}
  for(const key of ['id','company_id','created_at','updated_at'])delete payload[key]
  return payload
}
async function persist(client,companyId,item){
  const r=await client.query(`UPDATE ${TABLE} SET descricao=$3,cliente=$4,fornecedor=$5,valor=$6,data_vencimento=$7,status=$8,
    forma_pagamento=$9,categoria=$10,payload=$11::jsonb,updated_at=NOW() WHERE company_id=$1 AND id=$2 RETURNING *`,
    [companyId,item.id,item.descricao||'',item.cliente||'',item.fornecedor||'',item.valor,item.dataVencimento||'',item.status,item.formaPagamento||'',item.categoria||'',JSON.stringify(payloadFor(item))])
  return r.rows[0]
}
async function insert(client,companyId,item){
  const r=await client.query(`INSERT INTO ${TABLE} (company_id,id,tipo,descricao,cliente,fornecedor,valor,data_vencimento,status,forma_pagamento,categoria,payload,created_at,updated_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pendente',$9,$10,$11::jsonb,NOW(),NOW()) RETURNING *`,
    [companyId,item.id,item.tipo,item.descricao||'',item.cliente||'',item.fornecedor||'',item.valor,item.dataVencimento,item.formaPagamento||'',item.categoria||'',JSON.stringify(payloadFor(item))])
  return r.rows[0]
}
async function seriesRows(client,companyId,tipo,series){
  const r=await client.query(`SELECT *, (created_at = updated_at) AS fixed_untouched FROM ${TABLE} WHERE company_id=$1 AND tipo=$2 AND payload->>'recorrencia_id'=$3 ORDER BY data_vencimento,id FOR UPDATE`,[companyId,tipo,series])
  return r.rows
}
async function createFixedEntry(pool,companyId,input,fromRow){
  const item={...input,id:randomUUID(),status:'pendente',lancamento_tipo:'fixo'}
  item.recorrencia_id=String(input.recorrencia_id||('fixo_'+item.id))
  dateParts(item.dataVencimento)
  item.dataVencimento=String(item.dataVencimento).slice(0,10)
  if(!Number.isFinite(Number(item.valor))||Number(item.valor)<=0)throw problem('fixed_invalid_value','Informe um valor maior que zero.',400)
  item.recorrencia_dia=Number(String(item.dataVencimento).slice(8,10))
  // O mesmo grupo/vencimento também é idempotente para clientes antigos.
  return transaction(pool,async client=>{
    await lock(client,companyId,item.tipo,item.recorrencia_id)
    const rows=await seriesRows(client,companyId,item.tipo,item.recorrencia_id)
    const existing=rows.find(row=>row.data_vencimento===item.dataVencimento)
    return fromRow(existing || await insert(client,companyId,item))
  })
}
async function updateFixedEntry(pool,companyId,id,patch,initial,fromRow){
  const series=seriesId(initial)
  return transaction(pool,async client=>{
    await lock(client,companyId,initial.tipo,series)
    const result=await client.query(`SELECT * FROM ${TABLE} WHERE company_id=$1 AND id=$2 FOR UPDATE`,[companyId,id])
    if(!result.rows[0])return null
    const current=fromRow(result.rows[0])
    if(!fixedType(current)||seriesId(current)!==series)throw problem('fixed_changed','A conta foi alterada. Atualize a página e tente novamente.')
    const next=editable(current,patch),done=current.tipo==='receber'?'recebido':'pago'
    next.lancamento_tipo='fixo';next.recorrencia_id=series
    const rows=await seriesRows(client,companyId,current.tipo,series)
    const anchor=Number(next.recorrencia_dia)||Math.max(...[current,...rows.map(fromRow)].map(item=>Number(String(item.dataVencimento||'').slice(8,10))||1))
    next.recorrencia_dia=anchor
    if(next.status===done && current.status!==done){
      const due=nextDate(next.dataVencimento,anchor)
      const existing=rows.find(row=>row.data_vencimento===due)
      const childId=existing?.id || generatedId(companyId,current.tipo,series,due)
      next.recorrencia_proxima_id=childId
      await persist(client,companyId,next)
      if(!existing)await insert(client,companyId,{
        id:childId,tipo:next.tipo,descricao:next.descricao,cliente:next.cliente,fornecedor:next.fornecedor,valor:next.valor,
        dataVencimento:due,formaPagamento:next.formaPagamento,categoria:next.categoria,lancamento_tipo:'fixo',
        recorrencia_id:series,recorrencia_dia:anchor,recorrencia_gerada_de:id
      })
    }else if(next.status==='pendente' && current.status===done){
      const child=rows.find(row=>row.id===current.recorrencia_proxima_id || row.data_vencimento===nextDate(current.dataVencimento,anchor))
      if(child){
        const untouched=child.payload?.recorrencia_gerada_de===id && child.status==='pendente' &&
          child.fixed_untouched===true && !child.payload?.recorrencia_proxima_id
        if(!untouched)throw problem('fixed_undo_conflict','Não é possível desfazer: a próxima mensalidade já foi alterada ou concluída.')
        await client.query(`DELETE FROM ${TABLE} WHERE company_id=$1 AND id=$2`,[companyId,child.id])
      }
      delete next.recorrencia_proxima_id
      await persist(client,companyId,next)
    }else{
      // Repetir a mesma baixa nunca avança mais de uma competência.
      if(JSON.stringify(payloadFor(current))!==JSON.stringify(payloadFor(next)))await persist(client,companyId,next)
    }
    const saved=await client.query(`SELECT * FROM ${TABLE} WHERE company_id=$1 AND id=$2`,[companyId,id])
    return fromRow(saved.rows[0])
  })
}
module.exports={fixedType,createFixedEntry,updateFixedEntry,nextDate}
