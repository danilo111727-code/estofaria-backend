'use strict'

const {randomUUID} = require('crypto')
const {reconcileCompanyAgendaInTransaction} = require('./quote-agenda-reconciliation')

// A mesma precedência dos vínculos lidos pelo painel; nunca usa nome ou valor.
const AGENDA_QUOTE_REF = `COALESCE(
  NULLIF(source_quote_id,''),NULLIF(payload->>'source_quote_id',''),
  NULLIF(payload->>'sourceQuoteId',''),NULLIF(payload->>'quote_id',''),
  NULLIF(payload->>'quoteId',''),NULLIF(payload->>'orcamento_id',''),
  NULLIF(payload->>'budget_id',''),
  substring(concat_ws(' ',tecido,descricao,payload->>'observacao',payload->>'observacoes',payload->>'obs',payload->>'notes')
    FROM '(?i)quote\\s*:\\s*([a-zA-Z0-9_-]+)')
)`

function refs(quote){
  return [...new Set([quote.id,quote.legacy_id].filter(Boolean).map(String))]
}

async function deleteQuoteWithAgenda(pool,companyId,id,reconciliationHelpers=require('./dashboard-v2-db')){
  const client = await pool.connect()
  try{
    await client.query('BEGIN')
    // Confirma o vínculo antes de excluir, sem depender da última abertura do Histórico.
    // Todos os candidatos participam da desambiguação; só o alvo pode ser atualizado.
    await reconcileCompanyAgendaInTransaction(client,companyId,reconciliationHelpers,{quoteId:id})
    const found = await client.query(
      'SELECT id,legacy_id FROM app_quotes_v2 WHERE company_id=$1 AND id=$2 FOR UPDATE',
      [companyId,id]
    )
    if(!found.rows[0]){
      await client.query('ROLLBACK')
      return false
    }
    await client.query(`DELETE FROM app_agenda_orders_v2
      WHERE company_id=$1 AND ${AGENDA_QUOTE_REF}=ANY($2::text[])`,[companyId,refs(found.rows[0])])
    await client.query('DELETE FROM app_quotes_v2 WHERE company_id=$1 AND id=$2 RETURNING id',[companyId,id])
    await client.query('COMMIT')
    return true
  }catch(error){
    await client.query('ROLLBACK').catch(()=>{})
    throw error
  }finally{ client.release() }
}

function conflict(){
  const error = new Error('Este pedido já possui agendamento ou entrega. Confira a Agenda antes de alterar para pronta entrega.')
  error.code = 'ready_delivery_conflict'
  return error
}

function today(){
  const parts = new Intl.DateTimeFormat('en-CA',{
    timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'
  }).formatToParts(new Date())
  const get = type => parts.find(part=>part.type===type).value
  return `${get('year')}-${get('month')}-${get('day')}`
}

async function markReadyDelivery(pool,companyId,id,input={}){
  const client = await pool.connect()
  try{
    await client.query('BEGIN')
    const found = await client.query(
      'SELECT * FROM app_quotes_v2 WHERE company_id=$1 AND id=$2 AND active=TRUE FOR UPDATE',
      [companyId,id]
    )
    const quote = found.rows[0]
    if(!quote){
      await client.query('ROLLBACK')
      return null
    }
    if(!['orcamento','pedido'].includes(String(quote.status || '').toLowerCase())) throw conflict()
    const linked = await client.query(`SELECT * FROM app_agenda_orders_v2
      WHERE company_id=$1 AND ${AGENDA_QUOTE_REF}=ANY($2::text[]) FOR UPDATE`,[companyId,refs(quote)])
    // O bloqueio do pedido serializa cliques repetidos; reaproveita o mesmo registro.
    if(linked.rows.length > 1) throw conflict()
    const existing = linked.rows[0]
    const wasReady = existing?.payload?.vendido_pronta_entrega === true && existing.status === 'entregue'
    if(existing && !wasReady && (existing.bloco_id || existing.status === 'entregue')) throw conflict()
    if(!wasReady && String(quote.payload_meta?.agenda_status || '').toLowerCase() === 'agendado') throw conflict()

    const incoming = input.payload && typeof input.payload === 'object' && !Array.isArray(input.payload)
      ? {...input.payload} : {}
    delete incoming.modelos
    const total = input.total_cents === undefined ? Number(quote.total_cents) : Number(input.total_cents)
    if(!Number.isFinite(total) || total < 0) throw new Error('Valor do pedido inválido.')
    const totalCents = Math.round(total)
    const deliveryDate = wasReady ? existing.ent_date : String(input.delivery_date || today())
    const parsed = new Date(`${deliveryDate}T12:00:00Z`)
    if(!/^\d{4}-\d{2}-\d{2}$/.test(deliveryDate) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0,10) !== deliveryDate){
      throw new Error('Data da pronta entrega inválida.')
    }
    const deliveredAt = wasReady ? (existing.payload.delivered_at || existing.updated_at) : new Date().toISOString()
    const agendaId = existing?.id || randomUUID()
    const payload = {
      ...(quote.payload_meta || {}),...incoming,
      agenda_status:'pronta_entrega',vendido_pronta_entrega:true,
      delivery_status:'entregue',delivered_at:deliveredAt,
      data_entrega:deliveryDate,agenda_bloco_id:null,agenda_order_id:agendaId,
      total_cents:totalCents,total:totalCents/100
    }
    const modelResult = await client.query(
      'SELECT model_id,model_name FROM app_quote_models_v2 WHERE company_id=$1 AND quote_id=$2 ORDER BY sort_order',
      [companyId,id]
    )
    const modelos = modelResult.rows.map(model=>({id:String(model.model_id || ''),name:model.model_name}))
    const descricao = modelos.map(model=>model.name).filter(Boolean).join(' + ') || 'Vendido à pronta entrega'
    const agendaPayload = {
      ...(existing?.payload || {}),id:agendaId,company_id:companyId,
      cliente:quote.cliente,descricao,modelos,bloco_id:null,prod_date:'',ent_date:deliveryDate,
      status:'entregue',source_quote_id:id,vendido_pronta_entrega:true,delivered_at:deliveredAt,
      valor:totalCents/100,valor_total:totalCents/100,total_cents:totalCents,
      saldo_restante:Number(payload.saldo_restante || 0),valor_entrada:Number(payload.valor_entrada || 0)
    }
    if(existing){
      await client.query(`UPDATE app_agenda_orders_v2 SET
        bloco_id=NULL,cliente=$3,descricao=$4,prod_date='',ent_date=$5,status='entregue',source_quote_id=$6,
        payload=$7::jsonb,updated_at=NOW() WHERE company_id=$1 AND id=$2`,
      [companyId,agendaId,quote.cliente,descricao,deliveryDate,id,JSON.stringify(agendaPayload)])
    }else{
      await client.query(`INSERT INTO app_agenda_orders_v2
        (company_id,id,bloco_id,cliente,descricao,prod_date,ent_date,status,tecido,qtd,tecido_comprado,source_quote_id,payload,created_at,updated_at)
        VALUES ($1,$2,NULL,$3,$4,'',$5,'entregue','',1,FALSE,$6,$7::jsonb,NOW(),NOW())`,
      [companyId,agendaId,quote.cliente,descricao,deliveryDate,id,JSON.stringify(agendaPayload)])
    }
    await client.query(`UPDATE app_quotes_v2 SET status='pedido',total_cents=$3,payload_meta=$4::jsonb,updated_at=NOW()
      WHERE company_id=$1 AND id=$2`,[companyId,id,totalCents,JSON.stringify(payload)])
    await client.query('COMMIT')
    return {id,agendaId}
  }catch(error){
    await client.query('ROLLBACK').catch(()=>{})
    throw error
  }finally{ client.release() }
}

module.exports = {deleteQuoteWithAgenda,markReadyDelivery}
