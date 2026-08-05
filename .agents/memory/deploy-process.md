---
name: Deploy process — dois repos + dois ambientes Cloudflare + regra de promoção
description: Backend e frontend em repos GitHub distintos; dois projetos Cloudflare Pages separados (teste e produção); somente o usuário promove para produção; teste e produção compartilham o mesmo backend e banco.
---

## REGRA CRÍTICA — Ambientes

### Frontend
| Ambiente | Cloudflare Pages project | URL | Conexão GitHub |
|---|---|---|---|
| **Teste** | `estofaria-frontend` | `https://estofaria-frontend.pages.dev` | ✅ Conectado → auto-deploy em push |
| **Produção** | `estofaria-digital` | `https://estofariadigital.com.br` | ❌ NÃO conectado — deploy manual pelo usuário |

**O agente sempre faz push para o remote `github` (repo `estofaria-frontend`) → vai automaticamente para o ambiente de teste.**
**Nunca interagir com o projeto `estofaria-digital` (produção). O usuário promove manualmente depois de validar no teste.**

### Backend — ATENÇÃO
- **Teste e Produção usam o MESMO backend e o MESMO banco de dados.**
- URL: `https://estofaria-backend.onrender.com`
- Repo: `https://github.com/danilo111727-code/estofaria-backend` → remote local `backend-origin`
- Qualquer alteração de dados via backend afeta teste e produção ao mesmo tempo.
- Ter cuidado redobrado ao alterar dados, rotas ou lógica de negócio no backend.

---

## Estrutura do repo estofaria-frontend (remote `github`)
Os módulos ficam na **raiz** do repo, não em `frontend/`:
- `assinatura/__content.html` ← arquivo real
- `assinatura/script.js`, `assinatura/style.css`
- `app-shell.js` na raiz — cache version `CV`
- Outros módulos: `painel/`, `agenda/`, `vendedor/`, `material/`, etc. — todos na raiz

**Why:** O workspace Replit tem uma pasta `frontend/` local que NÃO espelha o repo remoto. Editar `frontend/assinatura/` cria arquivos novos no repo em vez de editar os existentes em `assinatura/`.

## Cache do shell
Bumpar `CV` em `app-shell.js` sempre que editar `__content.html`, `script.js` ou `style.css` de qualquer módulo, para forçar reload do iframe.

## fetchJson — mensagem de erro (corrigido)
`config.js` usa `data.message || data.error` — prefere o texto humano ao código de erro.

## Auto-deploy no Render
Frequentemente NÃO dispara automaticamente após push — usar Manual Deploy no painel do Render se necessário.
