---
name: Deploy process — dois repos + estrutura do frontend
description: Backend e frontend em repos GitHub distintos; estrutura de pastas do frontend no repo é diferente da workspace local.
---

## Regras

### Repos
- **Backend (Render):** `danilo111727-code/estofaria-backend`, branch `main` → remote `backend-origin`
- **Frontend (Cloudflare Pages):** `danilo111727-code/estofaria-frontend`, branch `main` → remote `github`

### Estrutura do repo estofaria-frontend
Os módulos ficam na **raiz** do repo, não em `frontend/`:
- `assinatura/__content.html` ← arquivo real (não `frontend/assinatura/__content.html`)
- `assinatura/script.js`, `assinatura/style.css` etc.
- `app-shell.js` na raiz — controla o iframe shell com cache version `CV`
- Outros módulos: `painel/`, `agenda/`, `vendedor/`, `material/`, etc. — todos na raiz

**Why:** O workspace Replit tem uma pasta `frontend/` local que NÃO espelha o repo remoto. Editar `frontend/assinatura/` cria arquivos novos no repo, não edita os existentes em `assinatura/`.

### Cache do shell
`app-shell.js` usa `var CV = 'YYYYMMDD?'` para cache-bust dos iframes. Bumpar CV sempre que editar `__content.html`, `script.js` ou `style.css` de qualquer módulo.

**How to apply:**
1. Verificar sempre `git ls-tree github/main <modulo>/` antes de editar para confirmar o path real
2. Fazer checkout de branch a partir de `github/main`, editar arquivos na raiz (sem prefixo `frontend/`)
3. Bumpar `CV` em `app-shell.js`
4. Push para `github/main`

### Auto-deploy
- Cloudflare Pages: auto-deploy em push ao `github/main` (funciona bem)
- Render: auto-deploy frequentemente NÃO dispara — usar Manual Deploy no painel após push ao `backend-origin/main`

### Fluxo para backend
```bash
git remote add backend-origin "https://<PAT>@github.com/danilo111727-code/estofaria-backend.git"
git fetch backend-origin main
git checkout -b fix-xyz backend-origin/main
# editar arquivos (server.js está na raiz, src/ para rotas)
git push backend-origin fix-xyz:main
```
