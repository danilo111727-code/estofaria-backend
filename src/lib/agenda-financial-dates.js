'use strict'

const text = value => value == null ? '' : String(value).trim()

// Only the open balance that still follows delivery is moved. A different due
// date is an explicit financial decision; installments and settled history stay.
async function syncDeliveryReceivable(client, companyId, before, after){
  const oldDate = text(before.ent_date)
  const newDate = text(after.ent_date)
  const terminal = status => ['entregue','cancelado','indisponivel'].includes(text(status).toLowerCase())
  if(!text(before.id) || !newDate || oldDate === newDate || terminal(before.status) || terminal(after.status)) return

  const quoteRef = text(before.source_quote_id || before.sourceQuoteId || before.quote_id || before.quoteId)
  await client.query(`
    UPDATE app_financial_entries_v2
    SET data_vencimento=$4,
        payload=COALESCE(payload,'{}'::jsonb) || jsonb_build_object(
          'dataVencimento',$4::text,'agenda_status','agendado'),
        updated_at=NOW()
    WHERE company_id=$1 AND tipo='receber' AND status='pendente'
      AND (data_vencimento=$3 OR data_vencimento='')
      AND LOWER(COALESCE(NULLIF(payload->>'lancamento_tipo',''),'unico'))='unico'
      AND LOWER(COALESCE(payload->>'recorrencia_tipo',''))<>'fixo'
      AND COALESCE(payload->>'recorrencia_id','')=''
      AND COALESCE(payload->>'grupo_id','')=''
      AND COALESCE(payload->>'parcelas_total','1') IN ('','1')
      AND (
        COALESCE(NULLIF(payload->>'agenda_order_id',''),NULLIF(payload->>'agendaOrderId',''),'')=$2
        OR (
          COALESCE(NULLIF(payload->>'agenda_order_id',''),NULLIF(payload->>'agendaOrderId',''),'')=''
          AND $5<>'' AND $5 IN (
            payload->>'quote_id',payload->>'quoteId',
            payload->>'source_quote_id',payload->>'sourceQuoteId'
          )
        )
      )
  `,[text(companyId),text(before.id),oldDate,newDate,quoteRef])
}

module.exports = {syncDeliveryReceivable}
