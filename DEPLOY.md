# Guia de Deploy — Estofaria Digital Frontend

## ⚠️ Regra mais importante

**Nunca faça push direto para `main` sem intenção de deploiar.**  
O GitHub Actions dispara deploy de produção automaticamente em qualquer push ao `main`.

> **TODO:** Edite `.github/workflows/deploy.yml` no GitHub.com e remova o bloco `push: branches: [main]`, deixando apenas `workflow_dispatch`. Isso garante que o deploy só acontece quando você executar manualmente — sem surpresas.

---

## Processo correto de deploy

### 1. Desenvolver e commitar no `dev`
```bash
git checkout dev
# ... faz as alterações ...
git add -A
git commit -m "descricao da melhoria"
git push origin dev
```
Isso gera um preview no Cloudflare Pages para testar sem afetar produção.

### 2. Antes de deploiar para produção — verificar
```bash
bash scripts/pre-deploy-check.sh
```
O script verifica:
- Se existem arquivos modificados sem commit (que seriam perdidos no próximo deploy via GitHub Actions)
- Se a pasta `frontend/` está sincronizada
- Se o HEAD local está igual ao origin

### 3. Sincronizar frontend/ se necessário
```bash
bash scripts/sync-frontend.sh
git add frontend/
git commit -m "chore: sync frontend/"
git push origin dev
```

### 4. Mergar dev → main (sem deploiar ainda)
```bash
git checkout main
git merge dev --no-ff
git push origin main
```

### 5. Deploiar para produção via wrangler
```bash
npx wrangler@3 pages deploy . --project-name=estofaria-digital --branch=main --commit-dirty=true
```

---

## Por que esse processo existe

### Problema: melhorias sumindo a cada deploy

Causa raiz identificada (19/07/2026):

| # | Causa | Consequência |
|---|-------|--------------|
| 1 | GitHub Actions dispara deploy em push ao `main` | Qualquer commit meu ou seu no `main` sobrescreve produção |
| 2 | Melhorias feitas via wrangler sem commit prévio | `--commit-dirty=true` deploya arquivos locais; GitHub Actions deploya só o git — na próxima vez, tudo que não foi commitado some |
| 3 | Pasta `frontend/` com arquivos duplicados desatualizados | `frontend/agenda/script.js` estava 2 dias atrás do `agenda/script.js` |

### Solução permanente para cada causa

| Causa | Solução |
|-------|---------|
| Auto-deploy no push | Remover `push: branches: [main]` do workflow (fazer no GitHub.com) |
| Melhorias sem commit | Sempre commitar ANTES de deploiar; rodar `pre-deploy-check.sh` |
| frontend/ desatualizado | Rodar `sync-frontend.sh` antes de qualquer deploy |

---

## Estrutura de branches

| Branch | Propósito |
|--------|-----------|
| `dev` | Desenvolvimento. Push aqui gera preview no Cloudflare Pages. |
| `main` | Produção. Só merga aqui quando pronto para ir ao ar. |
| `stable-pages` | Snapshot histórico de maio/2026. Não usar para deploy. |

---

## ⚠️ Sobre a pasta `frontend/`

A pasta `frontend/` é um espelho parcial dos arquivos raiz criado em maio/2026.  
Os arquivos lá **não são servidos diretamente** — nenhum HTML referencia caminhos `/frontend/`.  
Use sempre `scripts/sync-frontend.sh` para mantê-la atualizada e evitar confusão.

---

## Ação pendente (você precisa fazer)

1. Acesse: `github.com/danilo111727-code/estofaria-frontend/blob/main/.github/workflows/deploy.yml`
2. Clique no lápis (editar)
3. Substitua:
   ```yaml
   on:
     push:
       branches: [main]
     workflow_dispatch:
   ```
   por:
   ```yaml
   on:
     workflow_dispatch:
   ```
4. Commite direto no `main`

Após isso, nenhum push ao `main` vai mais disparar deploy automático.
