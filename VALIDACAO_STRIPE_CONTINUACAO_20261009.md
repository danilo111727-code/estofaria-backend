# Continuação da validação Stripe — 09/10/2026

Branch exclusiva: `correcao-stripe-segura-teste-20261009`.
Base desta rodada: `e1aec2ae6423e96fe6b4fd02f8ab04ed323378b8`.

## Situação

A validação real em Stripe Sandbox continua bloqueada: a conexão Stripe disponibiliza somente a conta `estofariadigital.com.br`, com `livemode=true`. Não há chave test no ambiente local. Nenhuma operação específica dessa conta foi executada. A conexão em modo de teste deve ser disponibilizada antes de criar objetos fictícios no Sandbox.

Os testes locais finais passam: 72 testes, zero falhas e zero ignorados. São 51 cenários Stripe/backend de cobrança, sete testes do JavaScript real do frontend, 13 testes preexistentes e um teste do servidor completo. A progressão dos 60 dias foi simulada localmente; isso não substitui um Test Clock real.

**Não aprovado para deploy no teste oficial ou produção.** Não é possível confirmar o isolamento integral do ambiente pelas ferramentas disponíveis. Nenhum deploy foi executado e a branch dev não foi alterada.

## Falhas adicionais reproduzidas e corrigidas

1. O create-checkout era excluído do middleware transacional PostgreSQL. O teste comprovou que respondia HTTP 200 antes de persistir `stripe_customer_id` e `stripe_checkout_session_id`. A rota agora usa o mesmo commit transacional das demais mutações. A resposta só é liberada depois do commit. Erros de commit devolvem HTTP 503; a repetição recupera a sessão Stripe fictícia existente sem criar outra.
2. O frontend usa `/api/subscription/status`, mas a rota não existia nesta base do backend. Foi adicionado o alias `/status`, com autenticação e o mesmo payload da consulta existente. O servidor completo foi testado com `/api/billing/status` e `/api/subscription/status`.

A configuração do SDK passou a usar timeout de cinco segundos por chamada e zero retries automáticos, limitando chamadas dentro da transação. As repetições do aplicativo continuam protegidas por idempotência e recuperação de sessão. Foi mantido Stripe SDK 17.7.0, sem alteração de API principal.

## Testes desta rodada

- Persistência dos IDs antes da resposta de sucesso.
- Falha de commit do checkout, rollback e repetição sem segunda sessão.
- Falha de commit do webhook, ausência de confirmação de sucesso e reentrega do mesmo evento.
- Limite de timeout/retry do SDK.
- Trial local de 60 dias, transição para primeira fatura paga, próximo vencimento, continuidade de acesso e bloqueio de nova contratação duplicada.
- Expiração normal de JWT durante a passagem de 60 dias: o teste refaz a sessão para representar um novo login, preservando a regra de expiração existente.
- Alias de status solicitado pelo frontend.
- Reexecução de toda a suíte anterior.

O fake PostgreSQL foi aprimorado para aplicar gravações somente em COMMIT e descartá-las em ROLLBACK. Foram usados o middleware transacional real e respostas de banco simuladas; não foi utilizado PostgreSQL real.

## Compatibilidade com o frontend

Referência consultada: `danilo111727-code/estofaria-frontend`, commit `1e3c0c6a8de0721e24aa2b2ceed88f0772e5bdf3`.

O arquivo `test/fixtures/frontend-stripe-20261009.json` contém snapshots do código consultado e sua origem. Os testes executam esse JavaScript em Node VM, com DOM e rede simulados. Não representam testes visuais ou navegação em navegador. O Chromium local não estava instalado.

Resultados:

- O domínio `estofaria-frontend.pages.dev` e seus previews selecionam `https://estofaria-backend-dev.onrender.com`.
- O domínio de produção seleciona `https://estofaria-backend.onrender.com`.
- A camada HTTP preserva `status=409`, `payload.error=courtesy_ending`, a mensagem e `retry_at`.
- A função real de checkout exibe a mensagem sobre cortesia e não redireciona para pagamento. Não altera acesso por receber esse erro.
- O interceptor real persiste o plano antes do checkout e mantém os aceites legais.
- O retorno de pagamento pendente exibe a mensagem do backend e não entra no aplicativo.

Limite de UX: courtesy_ending é apresentado como aviso de erro genérico HTTP 409, embora o texto explique a cortesia. O frontend não formata nem exibe `retry_at` separadamente. Nenhum arquivo do repositório frontend foi alterado ou publicado nesta rodada.

## Evidências de ambiente — consultas somente de leitura

Workspace Render autorizado pelo usuário: `My Workspace` (`tea-d6vjiqea2pns73akeu0g`).

| Item | Teste oficial | Produção |
| --- | --- | --- |
| Serviço Render | estofaria-backend-dev | estofaria-backend |
| ID | srv-d808cd9j2pic73f3tikg | srv-d762rr7fte5s73cg997g |
| Branch configurada | dev | main |
| Deploy automático | Sim, por commit | Desativado |
| URL | https://estofaria-backend-dev.onrender.com | https://estofaria-backend.onrender.com |
| GET /api/health | ok=true; postgresql | ok=true; postgresql |
| GET /api/billing/public | trial_days=30 | trial_days=60 |
| stripe_mode público | Não informado | Não informado |

`dev` e `main` apontavam para `36fe22f4fbfa39fbf59062919433bce33c20b39d` na comparação realizada. A branch isolada contém os ajustes próprios, sem necessidade de levar outras alterações de teste.

A consulta de bancos Render mostrou um banco ativo, `estofaria-db`, e outro suspenso, `estofaria-products-exp`. Isso não comprova se dev e produção usam bancos, schemas ou usuários separados. As ferramentas de consulta de serviços não expõem as variáveis necessárias para comparar `DATABASE_URL`, schemas, segredos JWT, chaves Stripe, Price IDs ou segredos dos webhooks. Não foi acessada tabela de clientes para tentar inferir isolamento.

Os logs de teste consultados registravam erros PostgreSQL `ECONNABORTED` em 08/10. O healthcheck atual respondeu normalmente. A ocorrência anterior não foi diagnosticada nesta tarefa.

## Condições para continuar o teste real

1. Disponibilizar uma conexão Stripe Sandbox com livemode=false.
2. Verificar de forma segura as configurações do backend de teste, sem revelar segredos: banco/schema/usuário separado, chave Stripe de teste, preços de teste, webhook de teste, URLs de retorno de teste e segredos de sessão separados.
3. Resolver a divergência pública de 30/60 dias em uma configuração de teste comprovadamente isolada. O teste de cadastro local confirma que a regra do código concede 60 dias; a configuração pública continua incoerente no ambiente atual.
4. Criar apenas empresa, cliente, preço e assinatura fictícios novos. Usar Test Clock para avançar ao fim da cortesia e à finalização/pagamento da primeira fatura, validando valor e data.
5. Exercitar Checkout e retorno no frontend de teste, além da entrega real de webhook assinado. Replays locais assinados com um segredo fictício não contam como entrega real do Sandbox.
6. Verificar duplicidade, repetição de eventos, pagamento recusado, eventos antigos e recuperação após falhas de API/banco.
7. Apresentar a lista final de arquivos e evidências de isolamento e só então aguardar autorização de deploy.

## Riscos restantes

- Ciclo de cartão, trial, primeira cobrança e entrega real de webhooks não executado em Sandbox.
- Isolamento de credenciais, banco e webhooks não comprovado.
- Campo público trial_days do teste informa 30 dias.
- Novos checkouts nos últimos dois dias de cortesia continuam recusados temporariamente para impedir cobrança antecipada; a interface apresenta aviso genérico.
- O checkout agora ocupa a fila transacional durante chamadas Stripe. O limite de cinco segundos por chamada reduz o tempo de espera, mas a latência agregada e o impacto em outros módulos sob carga ainda precisam ser medidos.
- Concorrência entre múltiplas instâncias reais e queda do processo durante a operação não testadas. O teste oficial está configurado com uma instância.
- Clientes legados sem vínculo inequívoco e vínculos cancelados continuam exigindo suporte. Nenhuma assinatura existente foi migrada, cancelada ou alterada.
- O portal de cobrança existente retorna URL simulada do backend e não foi validado como portal Stripe real. A criação de Checkout e seu retorno são fluxos separados desse portal.
- O snapshot do frontend foi testado em VM; não houve revisão visual ou teste em iPhone/Android/notebook.

## Reproduzir os testes locais

```bash
npm ci --ignore-scripts --no-audit --no-fund
node --test test/*.test.js
node --check src/routes/billing.js
node --check src/lib/atomic-store.js
git diff --check
```

Nenhuma cobrança, dado de cartão, alteração de cliente real, alteração da main ou deploy fez parte desta rodada.
