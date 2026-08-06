---
name: Render deploy não auto-deploya
description: O Render não faz redeploy automático mesmo com push no GitHub — requer ação manual no dashboard.
---

**Regra:** Após qualquer push para `backend-origin/main`, verificar se o Render realmente deployou antes de testar.

**Como confirmar:** `GET https://estofaria-backend.onrender.com/api/health` → campo `version`. Se não mudou, o deploy ainda não aconteceu.

**Como forçar:** Entrar no dashboard do Render → serviço `estofaria-backend` → botão "Manual Deploy" ou "Trigger Deploy".

**Why:** Auto-deploy do Render pode falhar silenciosamente ou estar desabilitado. Múltiplos pushes (adf2f62, bb0cb16, 264d19f) não triggeriaram redeploy automático na sessão de 2026-08-06.

**How to apply:** Sempre que o usuário reportar que o backend ainda exibe comportamento antigo, verificar o health endpoint primeiro antes de alterar código.
