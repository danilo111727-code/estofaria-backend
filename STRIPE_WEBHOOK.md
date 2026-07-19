# Configuração do Webhook Stripe — Estofaria Digital

Este guia cobre tudo que você precisa fazer **uma vez** no painel do Stripe e no Render para que o bloqueio/liberação de acesso por assinatura funcione em produção.

---

## Por que o webhook é obrigatório

O Stripe não liga de volta para o seu backend automaticamente — você precisa registrar um endpoint.  
Sem ele, o cadastro de cartão no checkout **nunca** vai liberar o acesso do usuário (`access_status` fica em `pending_payment` para sempre).

| Evento Stripe | O que acontece no sistema |
|---|---|
| `checkout.session.completed` | Cartão cadastrado → `access_status: active`, trial de 60 dias começa |
| `invoice.paid` | Cobrança mensal bem-sucedida → continua `active` |
| `invoice.payment_failed` | Falha na cobrança → `access_status: blocked` |
| `customer.subscription.updated` (past_due) | Assinatura atrasada → `access_status: blocked` |
| `customer.subscription.deleted` | Assinatura cancelada → `access_status: blocked` |

---

## Passo 1 — URL do seu backend

O endpoint que recebe os webhooks é:

```
https://SEU_APP.onrender.com/api/subscription/webhooks/stripe
```

Substitua `SEU_APP` pelo nome do seu serviço no Render.  
Exemplo: se a URL do backend é `https://estofaria-backend.onrender.com`, então:

```
https://estofaria-backend.onrender.com/api/subscription/webhooks/stripe
```

---

## Passo 2 — Criar o webhook no painel do Stripe

1. Acesse: **https://dashboard.stripe.com/webhooks**
2. Clique em **"Add endpoint"**
3. No campo **Endpoint URL**, cole a URL do passo 1
4. Em **"Select events to listen to"**, marque os 5 eventos:
   - `checkout.session.completed`
   - `invoice.paid`
   - `invoice.payment_failed`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
5. Clique em **"Add endpoint"**
6. Após criar, clique no endpoint recém-criado e depois em **"Reveal"** na seção **Signing secret**
7. Copie o valor — começa com `whsec_...`

> ⚠️ **Atenção:** use o painel **live** (não test) para produção.  
> A URL da chave live é `https://dashboard.stripe.com/webhooks` (sem `/test`).

---

## Passo 3 — Adicionar variáveis de ambiente no Render

Acesse o painel do Render → seu serviço de backend → **Environment** → **Environment Variables** e configure:

| Variável | Valor | Onde encontrar |
|---|---|---|
| `STRIPE_SECRET_KEY` | `sk_live_...` | Stripe → Developers → API keys |
| `STRIPE_PRICE_ID` | `price_...` | Stripe → Products → seu produto → ID do preço de R$ 149,00 |
| `STRIPE_WEBHOOK_SECRET` | `whsec_...` | Stripe → Webhooks → seu endpoint → Signing secret |

> Após salvar as variáveis, o Render reinicia o serviço automaticamente.

---

## Passo 4 — Verificar se está funcionando

Após configurar, você pode confirmar de duas formas:

### Opção A — Pelo painel do Stripe
1. Acesse **https://dashboard.stripe.com/webhooks**
2. Clique no endpoint
3. Na aba **"Recent deliveries"**, você vai ver os eventos entregues e o código de resposta (deve ser `200`)

### Opção B — Pelo endpoint de status do backend
```
GET https://SEU_APP.onrender.com/api/subscription/status
```

O campo `webhooks_ok: true` confirma que pelo menos um evento já foi recebido.  
Enquanto nenhum evento chegar, aparece `"Aguardando primeiro webhook"`.

---

## Passo 5 — Testar o fluxo completo (recomendado antes de ir ao ar)

1. Crie uma conta nova no sistema
2. Confirme que chegou em `/assinatura/` com o banner azul "Cadastre seu cartão"
3. Clique no botão de assinar — deve abrir o checkout do Stripe
4. Use o cartão de teste `4242 4242 4242 4242`, qualquer data futura, qualquer CVC
5. Após pagar, verifique se voltou para o sistema com acesso liberado
6. No painel do Stripe → Webhooks → seu endpoint → confirme que `checkout.session.completed` aparece com status `200`

> Para testar com cartão real em modo live, use um valor simbólico de R$ 0,01 primeiro  
> ou crie um cupom de 100% de desconto no Stripe para o período de trial.

---

## Checklist rápido

- [ ] Endpoint criado no Stripe com a URL correta do Render
- [ ] 5 eventos selecionados
- [ ] `STRIPE_SECRET_KEY` configurado no Render (chave `sk_live_`)
- [ ] `STRIPE_PRICE_ID` configurado no Render (preço de R$ 149,00)
- [ ] `STRIPE_WEBHOOK_SECRET` configurado no Render (valor `whsec_`)
- [ ] Render reiniciou o serviço após as variáveis
- [ ] Primeiro webhook aparece no painel do Stripe com status 200

---

## Troubleshooting

### Checkout abre mas ao voltar o acesso ainda está bloqueado
- Causa provável: `STRIPE_WEBHOOK_SECRET` errado ou não configurado
- O backend rejeita eventos sem assinatura válida
- Verifique se o `whsec_` copiado é do endpoint **live** e não do **test**

### O endpoint retorna 400 ou 500
- Verifique os logs do Render → seu serviço → **Logs**
- Procure por `"Stripe webhook error"` — o log mostra o motivo exato

### O evento aparece no Stripe mas `access_status` não muda
- Verifique se `STRIPE_SECRET_KEY` é `sk_live_` (não `sk_test_`)
- Chaves test e live não se misturam — um evento live com chave test é ignorado

### Stripe não consegue entregar (timeout, connection refused)
- O backend no Render pode estar no plano gratuito e hibernando
- Primeiro request após hibernação demora 30–60s — o Stripe tenta de novo automaticamente
- Para produção, considere o plano pago do Render para evitar hibernação
