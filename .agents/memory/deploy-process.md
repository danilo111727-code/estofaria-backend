---
name: Deploy process — dois repos + estrutura do frontend + regra de produção
description: Backend e frontend em repos GitHub distintos; estrutura de pastas do frontend no repo é diferente da workspace local; somente o usuário faz merge/deploy em produção.
---

## REGRA CRÍTICA — Deploy em produção
**O agente NUNCA deve fazer push direto para `github/main` (estofaria-frontend) nem para `backend-origin/main` (estofaria-backend).**
- Esses branches disparam auto-deploy em produção (Cloudflare Pages e Render).
- Somente o usuário tem permissão de fazer merge/deploy em produção.
- O agente deve sempre trabalhar em uma branch de feature (ex: `feat/fix-xyz`) e abrir PR ou avisar o usuário para ele fazer o merge.

**How to apply:**
1. `git checkout -b feat/<descricao>` a partir da base correta
2. Fazer edições, commitar
3. `git push github feat/<descricao>` (NÃO `:main`)
4. Informar o usuário para revisar e fazer merge em `main`

---

## Repos
- **Backend (Render):** `danilo111727-code/estofaria-backend`, branch `main` → remote `backend-origin`
- **Frontend (Cloudflare Pages):** `danilo111727-code/estofaria-frontend`, branch `main` → remote `github`

## Estrutura do repo estofaria-frontend
Os módulos ficam na **raiz** do repo, não em `frontend/`:
- `assinatura/__content.html` ← arquivo real (não `frontend/assinatura/__content.html`)
- `assinatura/script.js`, `assinatura/style.css` etc.
- `app-shell.js` na raiz — controla o iframe shell com cache version `CV`
- Outros módulos: `painel/`, `agenda/`, `vendedor/`, `material/`, etc. — todos na raiz

**Why:** O workspace Replit tem uma pasta `frontend/` local que NÃO espelha o repo remoto. Editar `frontend/assinatura/` cria arquivos novos no repo, não edita os existentes em `assinatura/`.

## Cache do shell
`app-shell.js` usa `var CV = 'YYYYMMDD?'` para cache-bust dos iframes. Bumpar CV sempre que editar `__content.html`, `script.js` ou `style.css` de qualquer módulo.

## fetchJson — ordem de preferência de mensagem de erro
`config.js` usa `data.message || data.error` (corrigido em a12342c). Sempre preferir `message` antes de `error` ao construir a mensagem da exceção.

## Auto-deploy
- Cloudflare Pages: auto-deploy em push ao `github/main`
- Render: auto-deploy frequentemente NÃO dispara após push — usar Manual Deploy no painel

## Fluxo para backend (feature branch)
```bash
git fetch backend-origin main
git checkout -b feat/xyz backend-origin/main
# editar arquivos
git push backend-origin feat/xyz   # NÃO :main
# avisar usuário para fazer merge
```
