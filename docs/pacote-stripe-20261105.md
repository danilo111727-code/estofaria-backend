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

## Validação ampliada de 05/11 — resultado e impedimentos

### Implantação e banco (somente leitura)
- Produção Render: deploy live dep-dblqcigae00c73df1vo0, commit e9fbd49b2dd89dff2fcc8b961b081c0f98446c52, uma instância, auto deploy desativado.
- Teste Render: deploy live dep-dblkgjrbc2fs739rsdd0, commit c168c79ae55fa0d872e3ce386550c18471bed14b, uma instância, branch dev com auto deploy.
- O pacote deste PR não está implantado em nenhum dos dois.
- Banco Render consultado: estofaria_db/public, kv_store main com 59 empresas e zero webhookEvents. Nenhuma empresa tem stripe_customer_id ou stripe_subscription_id preenchido.
- Três candidatos encontrados por e-mail (não prova suficiente para vinculação automática). Cortesia no app termina em 16, 16 e 23/11; os trials correspondentes no Stripe terminam em 12, 15 e 22/11. Um candidato está em Gestão no app e Individual no Stripe.
- Ferramentas Render disponíveis não oferecem leitura de variáveis de ambiente. Não foi comprovado se dev e produção usam bancos/schemas, JWT e credenciais Stripe separados. Nenhuma alteração de configuração foi realizada.

### Sandbox desta rodada
- Conta acct_1UQGxJ07cTYAJL7T, livemode=false, sem endpoint webhook configurado.
- Preços mensais BRL 89,90 / 149 / 399 conferidos.
- Clock QA clock_1UYQEL07cTYAJL7Tvhwira8h e cliente fictício cus_VZZO168UPZO7Ru.
- Assinatura sub_1UYQFT07cTYAJL7ThzMwtBzz criada trialing com diferença exata de 60 dias entre trial_start e trial_end.
- Trial encerrado explicitamente com trial_end=now: passou a active e gerou fatura in_1UYQFy07cTYAJL7Ts539xl17 paid, amount_paid=8990. Isso NÃO é avanço do Test Clock nem validação de renovação futura.
- Cancelamento no fim do período manteve active; cancelamento imediato retornou canceled.
- Recusa: cliente fictício separado cus_VZZQPk8WC2GpMG com cartão de teste que falha na cobrança. Assinatura sub_1UYQHn07cTYAJL7TH32HebHx ficou incomplete; fatura in_1UYQHn07cTYAJL7TqPJ0BvM1 open, amount_paid=0, amount_due=8990, attempt_count=1. Assinatura de teste encerrada após a coleta.
- Nenhuma dessas operações foi feita na conta live. Snapshot reduzido dos objetos fictícios em test/fixtures/stripe-sandbox-20261105.json; sem segredo, cartão ou URL de fatura.

### Validação local ampliada
- Sete testes executam trechos do frontend atual, identificados por SHA dos blobs no snapshot novo; mensagens de erro, roteamento de ambiente, plano e retorno pendente passaram.
- Quatro testes adicionais usam PGlite 0.3.14, motor PostgreSQL embarcado descartável. Executam SQL de kv_store, COMMIT e ROLLBACK, incluindo falha de commit, repetição e concorrência de checkout. Não equivalem ao serviço PostgreSQL do Render nem ao teste oficial.
- Os objetos reais de Sandbox são reproduzidos localmente. A assinatura dos eventos locais usa segredo fictício; a API de consulta Stripe é simulada nessa reprodução. Não houve entrega de webhook público.
- Regressão nova reproduzida: evento legado marcado ignored não podia ser reprocessado após correção explícita do vínculo. O teste falhou antes do ajuste. Corrigido para repetir eventos ignored, substituir seu registro após sucesso e continuar bloqueando duplicidade de eventos processados.
- Renovação futura permanece coberta por simulação local, não por avanço de clock nesta rodada.

### Parecer
Pacote apto à revisão e aos testes de integração, ainda NÃO aprovado para produção.
Faltam isolamento verificável e implantação autorizada no teste oficial; entrega real de webhook Sandbox e fluxo no navegador; decisão e reconciliação dos legados (incluindo plano e cortesia); captura do retorno e planejamento da reativação live.
A ausência de vínculo foi reproduzida com dados fictícios: receber HTTP 200 não é prova de liberar acesso, pois o evento pode ter sido ignorado.

## Etapa 1 — conferência autenticada do Render concluída

Esta seção substitui a pendência anterior de leitura das configurações, sem alterar valores ou disparar deploy.

- Acesso autenticado confirmado ao workspace autorizado My Workspace.
- Teste: estofaria-backend-dev, branch dev, último deploy c168c79.
- Produção: estofaria-backend, branch main, último deploy e9fbd49.
- Bancos diferentes: teste aponta para Neon, produção para PostgreSQL do Render. Hosts e nomes dos bancos diferem. Nenhuma credencial de banco é registrada aqui.
- JWT_SECRET configurado nos dois serviços e diferente, comparado sem registrar o conteúdo.
- Chave Stripe do teste classificada como test; não foi copiada nem usada fora do painel.
- REQUIRE_STRIPE_TEST_MODE configurado como true no teste; a presença da variável não comprova, sozinha, que o código a aplica. Os arquivos server.js e src/routes/billing.js do commit dev consultado não referenciam essa variável.
- FRONTEND_URL do teste aponta para estofaria-frontend.pages.dev.
- Preços configurados em dev: Gestão price_1UAnx90mQhGFYwYVNFWRGBBA e Individual price_1UEJuD0mQhGFYwYVTMgWQdiW. Consulta de cada ID na conta Estofaria Digital Teste acct_1UQGxJ07cTYAJL7T retornou No such price. Portanto, não pertencem ao Sandbox usado nesta validação. Isso não prova que sejam inválidos em outra conta de teste; a conta correspondente à chave do serviço ainda precisa ser alinhada ao Sandbox escolhido.
- Não há STRIPE_PRICE_ID_EMPRESARIAL nem STRIPE_WEBHOOK_SECRET entre as variáveis do serviço dev. Não há grupos de ambiente vinculados nem arquivos secretos listados.
- A conferência usou leitura pontual e resultados derivados; valores secretos não foram salvos no repositório.
- A etapa 1 de acesso e conferência terminou. Para a etapa 2, falta alinhar chave/conta, preços dos três planos e webhook do ambiente de teste, antes da implantação e teste integrado.
- Nenhum valor foi editado, nenhum deploy foi feito e nenhuma assinatura live foi alterada.

## Etapa 2 — configuração parcial pelo plugin Stripe (06/11/2026)

- Conexão confirmada com Estofaria Digital Teste (acct_1UQGxJ07cTYAJL7T, livemode=false).
- Os três preços mensais ativos foram conferidos no Sandbox.
- Endpoint de teste criado: we_1UYdY507cTYAJL7T6Y2pw9Aq, URL https://estofaria-backend-dev.onrender.com/api/subscription/webhooks/stripe, API version 2025-02-24.acacia, sete eventos previstos no pacote.
- Endpoint colocado e conferido como disabled, aguardando alinhamento da chave e implantação do pacote.
- Render estofaria-backend-dev atualizado por merge de variáveis: preços Individual/Gestão/Empresarial do Sandbox e STRIPE_WEBHOOK_SECRET deste endpoint. Segredo transmitido diretamente entre as ferramentas, sem registro neste documento.
- A atualização das variáveis pelo conector disparou automaticamente atualização do serviço de teste, deploy dep-dbmkafom7kps73bk1aj0, ainda com commit c168c79. Isso não implanta o pacote do PR #17.
- STRIPE_SECRET_KEY não foi substituída: o plugin não disponibiliza chaves de API; falta concluir login no painel para obter/configurar a chave da conta Sandbox escolhida.
- Portanto, os preços e o segredo novos NÃO bastam para declarar o teste operacional: a chave/conta pode continuar divergente. Não executar contratação até alinhá-la.
- Nenhuma configuração ou assinatura de produção foi alterada.
- Pendem: chave Sandbox, implantação da correção, ativação do endpoint de teste e comprovação do fluxo integrado. Não aprovado para produção.
