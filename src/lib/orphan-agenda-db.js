'use strict'

const dashboard = require('./dashboard-v2-db')
const trash = require('./trash-db')
const pool = () => require('./store')._pg.pool
const conflict = () => Object.assign(new Error('Este registro mudou ou já possui um vínculo válido. Atualize a lista antes de excluir.'), {status:409})

// Somente registros que compõem os pedidos ativos do Painel e não possuem
// bloco nem venda válida. Pedidos aguardando agendamento no Vendedor não são órfãos.
async function candidates(companyId, client = pool()) {
  const [orders, blocks, quotes] = await Promise.all([
    dashboard.listDashboardOrders(companyId, client),
    client.query('SELECT id FROM app_agenda_blocos_v2 WHERE company_id=$1', [companyId]),
    client.query('SELECT id,legacy_id FROM app_quotes_v2 WHERE company_id=$1 AND active=TRUE', [companyId])
  ])
  const blockIds = new Set(blocks.rows.map(row => String(row.id)))
  const quoteIds = new Set(quotes.rows.flatMap(row => [row.id, row.legacy_id].filter(Boolean).map(String)))
  return dashboard.activeOrders(orders).filter(order =>
    order.financial_order !== true &&
    !blockIds.has(String(order.bloco_id || '')) &&
    !quoteIds.has(dashboard.extractQuoteRef(order))
  )
}

async function list(companyId, offset = 0) {
  const rows = await candidates(companyId)
  rows.sort((a,b) => String(b.created_at || '').localeCompare(String(a.created_at || '')) || String(a.id).localeCompare(String(b.id)))
  return {total:rows.length,offset,limit:50,items:rows.slice(offset,offset+50).map(row => ({
    id:row.id, title:row.cliente || 'Sem cliente', description:row.descricao || '',
    created_at:row.created_at, updated_at:row.updated_at,
    amount_cents:dashboard.revenueCents(row),
    reason:'Sem vínculo com um período de produção ou uma venda ativa.'
  }))}
}

async function exclude(client, companyId, id, expectedUpdatedAt) {
  const row = (await client.query('SELECT * FROM app_agenda_orders_v2 WHERE company_id=$1 AND id=$2 FOR UPDATE', [companyId,id])).rows[0]
  if(!row) throw Object.assign(new Error('Registro não encontrado.'), {status:404})
  if(!expectedUpdatedAt || new Date(row.updated_at).getTime() !== new Date(expectedUpdatedAt).getTime()) throw conflict()
  if(!(await candidates(companyId, client)).some(order => String(order.id) === String(id))) throw conflict()
  // Exclusão da pendência, sem apagar a base do faturamento nem tocar em contas.
  // O snapshot e a alteração são confirmados na mesma transação da requisição.
  const result = await client.query(`UPDATE app_agenda_orders_v2
    SET payload=COALESCE(payload,'{}'::jsonb) || jsonb_build_object('orphan_removed_at',NOW()),updated_at=NOW()
    WHERE company_id=$1 AND id=$2 RETURNING updated_at`, [companyId,id])
  const trashId = await trash.archive(client, companyId, 'agenda', 'agenda-orphan', id, {
    row, expected_updated_at:result.rows[0].updated_at
  })
  if(!trashId) throw Object.assign(new Error('Não foi possível garantir a recuperação pela lixeira. Nenhum registro foi excluído.'), {status:409})
  return {ok:true,trash_id:trashId}
}

module.exports = {list,exclude,candidates}
