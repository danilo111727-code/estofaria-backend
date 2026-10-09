# Pacote Stripe para teste oficial — rascunho bloqueado

Origem exclusiva: `correcao-stripe-segura-teste-20261009`, no repositório `danilo111727-code/estofaria-backend`.

**Não publicar ainda.** O ciclo Sandbox não foi executado e o isolamento de banco, credenciais e webhooks não foi confirmado. Este documento registra o pacote concreto para revisão, sem autorizar transferência para dev, mudança de serviço ou deploy.

## Arquivos exatos diferentes da base main/dev observada

Arquivos que afetam o runtime:

1. `src/routes/billing.js`
2. `src/middleware/auth.js`
3. `src/lib/atomic-store.js`
4. `package-lock.json`

Testes, snapshots e documentação incluídos no commit:

5. `test/billing-stripe.test.js`
6. `test/server-smoke.test.js`
7. `test/frontend-stripe-contract.test.js`
8. `test/fixtures/frontend-stripe-20261009.json`
9. `VALIDACAO_STRIPE_20261009.md`
10. `VALIDACAO_STRIPE_CONTINUACAO_20261009.md`
11. `PACOTE_TESTE_STRIPE_20261009.md`

Nenhum arquivo do repositório `estofaria-frontend` será publicado por esse pacote. O snapshot é utilizado exclusivamente pelos testes. `npm start` executa `server.js`; não carrega os arquivos de teste ou os relatórios.

## Destino proposto após validação e autorização

- Serviço de teste: `estofaria-backend-dev` (`srv-d808cd9j2pic73f3tikg`).
- URL: `https://estofaria-backend-dev.onrender.com`.
- Serviço de produção excluído do pacote: `estofaria-backend` (`srv-d762rr7fte5s73cg997g`).
- A branch dev tem deploy automático. Enviar código para dev já constitui publicação e só será feito após autorização explícita.
- Antes de transferir o pacote, repetir a comparação com dev/main, verificar que não há mudanças externas e registrar o commit de retorno do teste. Não alterar main.

## Isolamento comprovado e pendente

Comprovado: serviço Render e hostname de teste distintos; frontend de teste aponta para o backend dev; dev e main configuradas separadamente; produção não tem deploy automático.

Pendente: banco/schema/usuário; segredos de sessão; chave e conta Stripe Sandbox; Price IDs e webhook de teste; URLs de retorno; configuração coerente de 60 dias.

**Serviços separados não são prova suficiente de isolamento de dados e pagamentos. Não solicitar aprovação de publicação enquanto essas condições permanecerem pendentes.**
