# Clientes cadastrados

Rotas em `/api/v2/customers`: busca/paginação (50 por página), cadastro, edição, exclusão lógica, histórico de compras.

- A empresa vem da sessão autenticada. Somente o administrador da plataforma pode selecionar outra empresa.
- Vendas pode buscar/cadastrar; Configuração pode editar/excluir. O histórico de compras fica em Configuração e não retorna CPF, endereço ou telefone.
- CPF e telefone normalizados geram aviso de duplicidade; um novo cadastro com o mesmo contato exige confirmação explícita. Nome não identifica uma pessoa.
- O orçamento guarda `payload.customer_id` e uma cópia dos dados de contato. O vínculo fica em tabela própria; editar/excluir o cadastro não altera os documentos anteriores.
- O histórico considera somente pedidos ativos com status `pedido`, excluindo cancelados. O agendamento da mesma venda não duplica a compra.
- A data é `data_pedido` informada ao confirmar, ou o dia da confirmação no horário de São Paulo. Alterar outros dados não muda essa data.
- Filtros de período são inclusivos, de início a fim. O histórico mostra data e valor de cada pedido.
- Cadastro excluído some da busca para novas vendas; os vínculos com os pedidos são preservados.
- Excluir/recuperar um pedido na Lixeira remove/restaura seu vínculo e sua data de compra.
- Pedidos antigos sem `customer_id` não são associados por aproximação ou nome. Não há importação automática de contatos históricos.

O startup cria apenas duas tabelas novas e índices, sem reescrever os pedidos. Na promoção, publicar primeiro o backend `main` e depois o frontend `main`. Validado previamente em `dev` e `teste-oficial`.

Validação específica: disponibilize `@electric-sql/pglite` e `express` no NODE_PATH e execute `node --test test/customers.test.js`.

A pedido do usuário, não há ranking nem bloco de clientes no Painel.
