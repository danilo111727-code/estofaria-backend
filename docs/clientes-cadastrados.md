# Clientes cadastrados — teste

Rotas em `/api/v2/customers`: busca/paginação (50 por página), cadastro, edição, exclusão lógica, ranking e histórico de compras.

- A empresa vem da sessão autenticada. Somente o administrador da plataforma pode selecionar outra empresa.
- Vendas pode buscar/cadastrar; Configuração pode editar/excluir. Painel pode consultar ranking/histórico, sem receber CPF, endereço ou telefone pelo histórico.
- CPF e telefone normalizados geram aviso de duplicidade; um novo cadastro com o mesmo contato exige confirmação explícita. Nome não identifica uma pessoa.
- O orçamento guarda `payload.customer_id` e uma cópia dos dados de contato. O vínculo fica em tabela própria; editar/excluir o cadastro não altera os documentos anteriores.
- Ranking soma `total_cents` somente de pedidos ativos com status `pedido`, excluindo cancelados. Não soma outra vez o agendamento da mesma venda.
- A data é `data_pedido` informada ao confirmar, ou o dia da confirmação no horário de São Paulo. Alterar outros dados não muda essa data.
- Filtros de período são inclusivos, de início a fim. A lista mostra a última compra e o histórico mostra data e valor de cada pedido.
- Cadastro excluído some da busca para novas vendas; seu histórico continua disponível no ranking.
- Excluir/recuperar um pedido na Lixeira remove/restaura seu vínculo e sua data de compra.
- Pedidos antigos sem `customer_id` não são associados por aproximação ou nome. Não há importação automática de contatos históricos.

O startup cria apenas duas tabelas novas e índices, sem reescrever os pedidos. Publicar primeiro o backend `dev` e depois o frontend `teste-oficial`. Produção permanece manual.

Validação específica: disponibilize `@electric-sql/pglite` e `express` no NODE_PATH e execute `node --test test/customers.test.js`.
