---
name: Gate de assinatura — fluxo completo
description: Como o bloqueio de acesso por assinatura funciona no Estofaria SaaS (backend + frontend).
---

**Fluxo correto (backend `adf2f62`+):**
1. Registro cria empresa com `access_status: 'pending_payment'`, `financial_status: 'pending'`, SEM `trial_ends_at` ou `next_charge_at`.
2. `requireAuth` (middleware) tem lista HARD_BLOCKED: `['blocked','suspended','disabled','pending_payment']` → retorna **402** para esses status em rotas não-isentas.
3. Rotas isentas de subscription check: `SUBSCRIPTION_EXEMPT_PATHS = ['/billing', '/subscription', '/assinatura', '/me', '/logout', '/team']` — mas atenção: `req.path` é relativo ao router mount point, então `/api/subscription/` tem `req.path = '/'` que NÃO é isento.
4. Webhook `checkout.session.completed` → seta `access_status: 'active'`, `financial_status: 'trialing'`, `trial_ends_at`.

**Fluxo frontend (auth-guard.js):**
1. Fetch interceptor captura qualquer 402 de qualquer rota → redireciona para `/assinatura/?bloqueado=1`.
2. Verificação adicional em `validateAuth()`: se `/api/subscription/` retorna **402**, seta `accessBlocked=true` e retorna imediatamente (não deixa `data-auth-ok` ser setado).
3. Se `/api/subscription/` retorna 200: verifica `access_status` — bloqueia qualquer valor fora de `['active','trialing','manual_grace','courtesy_active','trial_active']`.

**Causa raiz do bug original (pré-`adf2f62`):**
- `buildSubscriptionPayload` retornava `company.access_status || 'active'` → novo usuário sem `access_status` recebia `'active'`.
- auth-guard antigo só bloqueava `'blocked'`.

**Why:** Dupla defesa: backend retorna 402 E frontend verifica access_status. Se backend falhar, frontend cobre; se frontend tiver bug, backend bloqueia.
