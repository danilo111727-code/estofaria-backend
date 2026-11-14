'use strict'

// Vínculos explícitos, com a mesma precedência na exclusão e recuperação.
// Nunca decide por nome do cliente ou valor do lançamento.
const QUOTE_REF = `COALESCE(NULLIF(payload->>'quote_id',''),NULLIF(payload->>'source_quote_id',''),
  NULLIF(payload->>'quoteId',''),NULLIF(payload->>'sourceQuoteId',''),
  NULLIF(payload->>'orcamento_id',''),NULLIF(payload->>'budget_id',''))`
const AGENDA_REF = `COALESCE(NULLIF(payload->>'agenda_order_id',''),NULLIF(payload->>'order_id',''))`

async function lockPending(client,companyId,quoteRefs,agendaIds){
  const result = await client.query(`SELECT * FROM app_financial_entries_v2
    WHERE company_id=$1 AND tipo='receber' AND status='pendente'
      AND payload->>'financial_source'='order'
      AND (${QUOTE_REF}=ANY($2::text[])
        OR (${QUOTE_REF} IS NULL AND ${AGENDA_REF}=ANY($3::text[])))
    ORDER BY id FOR UPDATE`,[companyId,quoteRefs,agendaIds])
  return result.rows
}

async function markReceivedDeleted(client,companyId,quoteId,quoteRefs,agendaIds){
  const result = await client.query(`UPDATE app_financial_entries_v2
    SET payload=jsonb_set(COALESCE(payload,'{}'::jsonb),'{order_deleted}',
      jsonb_build_object('quote_id',$2::text,'deleted_at',NOW()),true)
    WHERE company_id=$1 AND tipo='receber' AND status='recebido'
      AND payload->>'financial_source'='order'
      AND (${QUOTE_REF}=ANY($3::text[])
        OR (${QUOTE_REF} IS NULL AND ${AGENDA_REF}=ANY($4::text[])))
    RETURNING id`,[companyId,quoteId,quoteRefs,agendaIds])
  return result.rows.map(row=>row.id)
}

async function clearReceivedDeleted(client,companyId,quoteId,ids){
  if(!ids?.length)return
  await client.query(`UPDATE app_financial_entries_v2 SET payload=payload-'order_deleted'
    WHERE company_id=$1 AND id=ANY($2::text[])
      AND payload->'order_deleted'->>'quote_id'=$3`,[companyId,ids,quoteId])
}

module.exports = {QUOTE_REF,AGENDA_REF,lockPending,markReceivedDeleted,clearReceivedDeleted}
