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

module.exports = {QUOTE_REF,AGENDA_REF,lockPending}
