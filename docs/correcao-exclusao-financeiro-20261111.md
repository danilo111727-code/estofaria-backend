# Exclusão de pedido e seus saldos pendentes — teste

Ao excluir um pedido, os recebimentos automáticos pendentes ligados explicitamente a ele são arquivados junto com o pedido e removidos na mesma transação que remove a Agenda e a venda. Falha em qualquer etapa desfaz tudo.

O vínculo considera a empresa, o identificador atual ou legado do pedido e, quando não há referência explícita ao pedido, seu identificador na Agenda. Não há correspondência por nome ou valor. Valores recebidos, contas a pagar, lançamentos manuais e registros de outra empresa são preservados. O bloqueio de linha protege a baixa concorrente que tenha sido confirmada antes da exclusão.

A recuperação pela lixeira repõe pedido, Agenda e saldos pendentes juntos. Identificador ou parcela equivalente já existente gera conflito e desfaz a recuperação, sem duplicar. Lixeiras antigas continuam compatíveis.

## Validação local

- 90 testes direcionados: 87 aprovados, zero falhas, três saltados (concorrência PostgreSQL, recorrência PostgreSQL e arquivo opcional de recuperação).
- A suíte completa foi comparada com a base dev 119a4f5: 15 falhas em ambas, sem novas falhas nesta alteração. Incluem testes que exigem PostgreSQL local não configurado e esquemas/mocks antigos de faturamento. Não representam aprovação global de produção.
- O workflow específico executa exclusão, recuperação, rollback e baixa concorrente em PostgreSQL 16 descartável, além das regressões financeiras e de Agenda. Nenhuma credencial real é utilizada.

## Escopo

Somente backend e branch dev. Não requer migração, alteração de variável ou dependência de execução. Produção e saldos órfãos históricos permanecem sem alteração; correção dos dados antigos deve ser tratada separadamente após conferência.
