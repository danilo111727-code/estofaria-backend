# Pacote Stripe — 05/11/2026

Status: preparação para revisão. Sem deploy, merge, reativação de webhook ou cobrança real.

Base de produção observada no GitHub: e9fbd49b2dd89dff2fcc8b961b081c0f98446c52.
Correção recuperada: dd0ddf2d1a69817c56827668cd3fdee562368d84, branch correcao-stripe-segura-teste-20261009.
Branch deste pacote: correcao-stripe-segura-teste-20261105.
A versão antiga estava 27 commits atrás e 4 à frente; apenas três arquivos de runtime foram adaptados por patch. Não substituir o servidor inteiro por aquela versão.

## Diagnóstico confirmado no Stripe live
- Endpoint /api/subscription/webhooks/stripe desativado, inclusive na nova consulta desta rodada.
- Dez assinaturas no histórico: três trialing e sete canceled. As duplicadas antigas observadas estão canceladas.
- Dez faturas de cortesia de valor zero. Isso não comprova recebimento de dinheiro.
- Próximos términos de trial: 12, 15 e 22/11/2026, valor mensal R$ 89,90.
- As assinaturas legadas consultadas não têm metadata.company_id. O vínculo deve ser conferido com o banco da aplicação; e-mail sozinho não autoriza vincular clientes.

## Mudanças de runtime
- src/routes/billing.js: reutiliza cliente e sessão aberta; bloqueia nova assinatura quando já existe uma; usa chaves de idempotência; preserva término da cortesia; valida empresa e cliente no retorno; reconcilia webhook com estado atual da assinatura; ignora eventos antigos de outra assinatura; confirma persistência antes de responder sucesso; timeout de rede limitado.
- src/middleware/auth.js: permite recuperar cobrança mesmo com acesso bloqueado, mantendo autenticação.
- src/lib/atomic-store.js: chamadas de rede Stripe fora da fila global, com persistência explícita.
- Complemento desta rodada: invoice.paid de R$ 0 reconcilia assinatura, mas não preenche last_payment_at como se houvesse entrada de dinheiro.

Dependências, telas de fabricação/reforma, agenda e regras de sessão preservadas.
Não importar package-lock ou snapshots antigos de frontend.

## Validação local
Resultado desta rodada: 61 testes de cobrança/servidor e 55 de regressão passaram, zero falhas e zero ignorados nessas duas execuções. git diff --check aprovado.
Comandos:
- npm ci --ignore-scripts --no-audit --no-fund
- node --test test/billing-stripe.test.js test/server-smoke.test.js
- node --test test/dashboard-v2-reconciliation.test.js test/quote-order-lifecycle.test.js test/quote-agenda-reconciliation.test.js

Stripe e persistência PostgreSQL nos testes de cobrança são simulados; servidor HTTP, JWT e assinatura de webhook são locais reais. Smoke usa diretório temporário e elimina credenciais herdadas. Nada usa banco de clientes ou dinheiro real.
O histórico de 14/10 registra 78 testes e Test Clock no Sandbox; não é resultado reexecutado nesta rodada.
Uma tentativa ampliada incluiu testes financeiros que exigem FINANCIAL_TEST_DATABASE_URL: ficaram bloqueados pela ausência de PostgreSQL descartável. Isso não é aprovação desses testes; não houve uso de banco real para contornar a exigência.

## Antes de publicar no teste oficial
1. Confirmar serviço, banco/schema, credenciais JWT, Stripe Sandbox, Price IDs, segredo e URLs de retorno isolados da produção.
2. Configurar endpoint de webhook Sandbox e os eventos suportados:
   checkout.session.completed, checkout.session.async_payment_succeeded, invoice.paid, invoice.payment_failed,
   customer.subscription.created, customer.subscription.updated, customer.subscription.deleted.
3. Revisar o frontend atual para mensagens de courtesy_ending, customer_link_required e subscription_already_linked.
4. Testar no navegador: selecionar plano, contratar, repetir clique, retorno, recusa, recuperação, cancelamento e renovação com Test Clock.
5. Conferir no banco os vínculos das três assinaturas legadas e existência de um único processo escritor. Lock por empresa é local ao processo; não é garantia de coordenação entre múltiplas instâncias.

## Antes de produção
- Validar deploy e assinatura do webhook em teste; obter autorização de publicação.
- Registrar SHA realmente implantado no Render e backup do banco antes de qualquer reconciliação de legados.
- Reativar webhook live somente depois de confirmar backend, segredo e vínculos; verificar entregas/respostas e reconciliar estado atual dos clientes.
- Monitorar primeira cobrança e próxima renovação. Zero-value invoice não é evidência de cobrança.
- Não cancelar ou recriar automaticamente assinaturas legadas.

## Retorno
Não há migração de schema neste pacote. Antes do deploy, registrar o commit efetivamente implantado e manter esse commit disponível para redeploy. A base de código observada é e9fbd49; não se presume que seja o SHA em execução no Render.
Reverter somente os arquivos deste pacote, preservando mudanças posteriores. Não reativar/recriar cobranças ao reverter; estado financeiro deve ser conciliado separadamente.
