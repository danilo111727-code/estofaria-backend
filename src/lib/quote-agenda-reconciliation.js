'use strict'

async function reconcileCompanyAgenda(pool,companyId,helpers){
  const {rowToOrder,extractQuoteRef,reconcileHistoricalAgenda,billableOrders} = helpers
  const client = await pool.connect()
  try{
    await client.query('BEGIN')
    // Usa todos os pedidos da empresa para preservar a proteção contra ambiguidade.
    // A ordem dos bloqueios é sempre Vendedor -> Agenda, como na exclusão/pronta entrega.
    const quotes = await client.query(`SELECT * FROM app_quotes_v2
      WHERE company_id=$1 AND active=TRUE AND LOWER(COALESCE(status,''))='pedido'
      ORDER BY id FOR UPDATE`,[companyId])
    if(!quotes.rows.length){
      await client.query('COMMIT')
      return {linked:0,scheduled:0,unscheduled:0}
    }
    const agenda = await client.query(`SELECT * FROM app_agenda_orders_v2
      WHERE company_id=$1 ORDER BY id FOR UPDATE`,[companyId])
    const orders = agenda.rows.map(rowToOrder)
    const manual = orders.filter(order=>!extractQuoteRef(order))
    const vendors = quotes.rows.map(quote=>({
      cliente:quote.cliente,total_cents:Number(quote.total_cents),
      source_quote_id:quote.id,reconciliation_created_at:quote.created_at
    }))
    const inferred = new Map(reconcileHistoricalAgenda(manual,vendors)
      .filter(order=>order.historical_reconciliation_quote_id)
      .map(order=>[String(order.historical_reconciliation_quote_id),order]))
    const eligible = order => Boolean(order?.bloco_id) && billableOrders([order]).length === 1
    let linked=0,scheduled=0,unscheduled=0
    for(const quote of quotes.rows){
      const payload=quote.payload_meta || {}
      if(payload.vendido_pronta_entrega === true || payload.agenda_status === 'pronta_entrega') continue
      const references=new Set([quote.id,quote.legacy_id].filter(Boolean).map(String))
      const existing=orders.filter(order=>references.has(extractQuoteRef(order)))
      let order=null,linkNow=false
      if(existing.length){
        if(existing.length !== 1) continue
        const current=existing[0]
        const removed=!current.bloco_id || ['cancelado','indisponivel'].includes(String(current.status || '').toLowerCase())
        if(removed && current.status !== 'entregue' && payload.agenda_status === 'agendado'){
          const next={...payload,agenda_status:'pendente',agenda_bloco_id:null,agenda_order_id:current.id}
          await client.query(`UPDATE app_quotes_v2 SET payload_meta=$3::jsonb,updated_at=NOW()
            WHERE company_id=$1 AND id=$2`,[companyId,quote.id,JSON.stringify(next)])
          unscheduled++
        }
        if(!eligible(current)) continue
        order=existing[0]
      }else{
        const candidate=inferred.get(String(quote.id))
        if(!candidate) continue
        // A marca financeira é de saída; a elegibilidade vem do registro original.
        order=orders.find(item=>String(item.id)===String(candidate.id))
        if(!eligible(order)) continue
        linkNow=true
      }
      if(linkNow){
        await client.query(`UPDATE app_agenda_orders_v2 SET source_quote_id=$3,
          payload=jsonb_set(COALESCE(payload,'{}'::jsonb),'{source_quote_id}',to_jsonb($3::text),true)
          WHERE company_id=$1 AND id=$2`,[companyId,order.id,quote.id])
        linked++
      }
      if(payload.agenda_status !== 'agendado' || String(payload.agenda_order_id || '') !== String(order.id) ||
         String(payload.agenda_bloco_id || '') !== String(order.bloco_id)){
        const next={...payload,agenda_status:'agendado',agenda_order_id:order.id,agenda_bloco_id:order.bloco_id}
        await client.query(`UPDATE app_quotes_v2 SET payload_meta=$3::jsonb,updated_at=NOW()
          WHERE company_id=$1 AND id=$2`,[companyId,quote.id,JSON.stringify(next)])
        scheduled++
      }
    }
    await client.query('COMMIT')
    return {linked,scheduled,unscheduled}
  }catch(error){
    await client.query('ROLLBACK').catch(()=>{})
    throw error
  }finally{client.release()}
}

module.exports = {reconcileCompanyAgenda}
