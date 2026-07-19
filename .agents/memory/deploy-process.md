---
name: Deploy process — Estofaria Digital Frontend
description: Regras e causas raiz do processo de deploy; o que fazer e o que nunca fazer
---

## Regra absoluta
NUNCA fazer `git push origin main`. Isso dispara GitHub Actions → deploy automático de produção.
SEMPRE usar `git push origin HEAD:dev` ou `git push origin dev`.

## Como funciona o deploy
- GitHub Actions (`.github/workflows/deploy.yml`) dispara em `push: branches: [main]`
- Roda `npx wrangler@3 pages deploy . --project-name=estofaria-digital --branch=main --commit-dirty=true`
- O usuário também deploya manualmente via wrangler CLI

## Pendência do usuário
Editar `.github/workflows/deploy.yml` no GitHub.com e remover `push: branches: [main]`, deixando só `workflow_dispatch`. O token do Replit não tem `workflow` scope para fazer esse push.

## Causas raiz identificadas (19/07/2026)
1. Workflow auto-dispara em push ao main → sobrescreve produção a cada commit
2. Melhorias feitas via wrangler sem commit → GitHub Actions deploya versão git mais antiga
3. Pasta `frontend/` tem duplicatas dos arquivos raiz que ficam desatualizadas

## Scripts de correção (commitados no dev)
- `scripts/pre-deploy-check.sh` — verifica pendências antes de deploiar
- `scripts/sync-frontend.sh` — sincroniza frontend/ com arquivos raiz

**Why:** O token PAT não tem `workflow` scope; edições em `.github/workflows/` via push requerem esse scope.
