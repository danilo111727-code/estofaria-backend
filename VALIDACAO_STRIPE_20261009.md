# Validação da integração Stripe — 09/10/2026

Repositório: `danilo111727-code/estofaria-backend`
Branch exclusiva: `correcao-stripe-segura-teste-20261009`
Commit inicial: `1a835f4972774497153f69a01a1b086c2810de0f`
Main observada: `36fe22f4fbfa39fbf59062919433bce33c20b39d`

## Resultado e alcance

A versão inicial falhou em 17 dos primeiros 29 testes Stripe. A rodada ampliada reproduziu mais quatro falhas, corrigidas antes da execução final. A suíte final contém 59 testes: 45 Stripe, 13 preexistentes e um teste do servidor completo. Todos passaram na execução final, sem testes ignorados.

As chamadas Stripe foram substituídas por respostas fictícias em memória. A autenticação JWT, o roteamento HTTP Express e a validação de assinatura dos webhooks pelo SDK Stripe são reais e locais. O teste do servidor completo inicia `server.js`, usa armazenamento temporário, cadastra uma empresa fictícia e verifica a cortesia. O fluxo PostgreSQL foi simulado através do middleware transacional existente; nenhum banco real foi acessado. Nenhuma chave Stripe real foi utilizada nos testes.

**Resultado: testes locais aprovados; publicação em produção não aprovada por esta validação.** Não houve deploy no teste oficial ou em produção. Não houve cobrança, cancelamento, alteração de dados de clientes reais ou mudança na main.

## Testes por objetivo

| Objetivo | Cenários executados | Resultado |
| --- | --- | --- |
| Duplicidade | Repetição; oito requisições simultâneas; assinatura vinculada; active/trialing/past_due/unpaid/incomplete/paused; paginação; recuperação de sessão aberta; sessão expirada; perda da resposta Stripe | Passou no processo local simulado |
| Cliente Stripe | Reutilização do ID; criação explícita com idempotência; persistência; recuperação por metadado company_id; cliente legado sem vínculo; ausência de vinculação automática por e-mail | Passou |
| IDs dos webhooks | Faturas antigas e modernas; IDs expandidos; conflito de metadados; verificação de assinatura; deduplicação; falha da API com resposta HTTP 500 para retry | Passou |
| Eventos antigos | Assinatura diferente ignorada; estado atual consultado na Stripe simulada; fatura antiga não reativa assinatura cancelada; checkout antigo não substitui assinatura atual | Passou |
| Cortesia e data | Cadastro real local com 60 dias; trial_end em timestamp absoluto; último dia sem cobrança antecipada; cortesia encerrada sem novo trial; cancelamento durante cortesia; next_charge_at em formatos antigo e novo | Passou |
| Backend e acesso | Rotas protegidas; isolamento por empresa; recuperação de cobrança para bloqueados; unpaid bloqueia; past_due preserva política existente; instalação limpa; inicialização; suítes anteriores; wrapper transacional PostgreSQL simulado | Passou |

## Correções

- Serialização por empresa no processo e chaves de idempotência para criação de cliente e checkout.
- Cliente explícito persistido antes da criação da sessão. E-mail é apenas pista de busca; só metadado da empresa comprova vínculo. Clientes legados ambíguos exigem suporte, evitando nova contratação potencialmente duplicada.
- Reutilização e recuperação de sessões abertas; sessões concluídas não abrem uma nova contratação; sessões expiradas usam outra geração de idempotência.
- Paginação completa de assinaturas, incluindo status paused na prevenção de duplicidade.
- Preservação da cortesia mesmo quando professional_courtesy_enabled não está presente, como ocorre no cadastro atual.
- trial_end calculado pela data absoluta cadastrada, arredondado ao segundo seguinte, sem antecipar a cobrança. Nos últimos 48 horas mais um minuto de margem, novos checkouts são temporariamente recusados com courtesy_ending e retry_at. Não há extensão artificial da cortesia. Este comportamento deve ser comunicado na interface.
- Identificação de assinatura em invoice.subscription e invoice.parent.subscription_details.subscription, aceitando string ou objeto expandido.
- Webhooks consultam o estado atual da assinatura para lidar com eventos fora de ordem. Não associam empresas apenas pelo cliente Stripe. Registros de evento e alteração são gravados juntos no fluxo transacional existente.
- Retorno do checkout verifica empresa, cliente e assinatura; não substitui vínculo atual por outra assinatura; pagamento pendente não confirma acesso pago.
- As rotas de cobrança montadas em /api/billing e /api/subscription permanecem acessíveis para recuperação de assinatura, mesmo com acesso bloqueado. Os demais módulos preservam a verificação de bloqueio.
- package-lock.json sincronizado com package.json. Não foi feita atualização da versão principal do SDK Stripe nem mudança de versão de API.

## Execução reproduzível

```bash
npm ci --ignore-scripts --no-audit --no-fund
node --test test/*.test.js
node --check src/routes/billing.js
node --check src/middleware/auth.js
git diff --check
```

Ambiente utilizado: Node.js 24.19.0; Stripe SDK 17.7.0; Express 4.22.2. A suíte Stripe substitui armazenamento e cliente Stripe por fixtures. O teste de inicialização limpa as variáveis de conexão a serviços antes de iniciar o subprocesso. Não apontar uma execução manual do servidor para dados de produção.

## Arquivos alterados nesta revisão

1. `src/routes/billing.js`: checkout, vínculo, cortesia, IDs, confirmação e reconciliação de webhooks.
2. `src/middleware/auth.js`: acesso às rotas de recuperação de cobrança.
3. `package-lock.json`: correção da instalação reproduzível.
4. `test/billing-stripe.test.js`: 45 testes Stripe, incluindo integração simulada com o wrapper PostgreSQL.
5. `test/server-smoke.test.js`: inicialização, cadastro, 60 dias, consulta autenticada e rejeição de webhook sem configuração nos dois aliases.
6. `VALIDACAO_STRIPE_20261009.md`: este relatório.

## Limitações e riscos restantes

- Não foi validado o ciclo real de autorização de cartão, trial, geração da primeira fatura e cobrança em um sandbox Stripe com Test Clock. As simulações verificam os parâmetros e o comportamento do backend, não comprovam a configuração da conta Stripe nem o momento efetivo da cobrança. É necessário verificar preços, meios de pagamento, webhooks, versão dos eventos e datas em sandbox antes de publicação.
- O lock da empresa é local ao processo. A idempotência Stripe protege retries, mas não constitui uma garantia transacional entre múltiplas instâncias com configurações diferentes. O store existente usa snapshots e gravações diferidas para create-checkout; não foi reestruturado. Foram testados commit do webhook e flush da sessão com PostgreSQL simulado, mas não queda do processo, indisponibilidade de banco real ou concorrência entre instâncias.
- Clientes legados sem ID salvo e com metadados ausentes ou ambíguos exigem conferência do vínculo. A correção não reorganiza nem migra assinaturas reais. Se o e-mail foi alterado e não há nenhum identificador persistido, a busca por e-mail não consegue descobrir um cliente antigo.
- Uma empresa que ainda tenha stripe_subscription_id cancelado permanece impedida de contratar pelo endpoint create-checkout. A opção segura desta revisão é exigir suporte para regularização do vínculo, sem substituir automaticamente a assinatura nem cancelar qualquer coisa.
- O checkout temporariamente recusado no final da cortesia deve ser verificado na interface do teste oficial, incluindo a apresentação do erro courtesy_ending. A integração do frontend e o comportamento de navegação não foram testados em navegador nesta revisão.
- Reconciliação de webhooks requer disponibilidade da API Stripe. Falhas retornam HTTP 500 sem marcar evento como processado, permitindo retry. Esta consulta acrescenta latência e usa a fila transacional já existente no backend PostgreSQL; o impacto sob carga não foi medido.
- A política existente de past_due continua permitindo acesso; não foi alterada nesta revisão. Este resultado não representa uma mudança na regra comercial de inadimplência.

## Referências consultadas

- Stripe: https://docs.stripe.com/webhooks — entrega fora de ordem e deduplicação.
- Stripe: https://docs.stripe.com/billing/invoices/subscription — formatos antigos e novos do vínculo de assinatura na fatura.
- Stripe: https://docs.stripe.com/payments/checkout/abandoned-carts — sessões abertas, expiração e recuperação.
