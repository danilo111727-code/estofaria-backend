# Estofaria Digital — Backend

## Ambientes

| Branch | Serviço Render | Banco | Uso |
|--------|---------------|-------|-----|
| `main` | estofaria-backend | PostgreSQL produção | App oficial |
| `dev`  | estofaria-backend-dev | PostgreSQL staging | Testes |

## Variáveis de ambiente por serviço

**Produção (main):**
- `DATABASE_URL` → Postgres produção
- `JWT_SECRET` → secret de produção
- `CORS_ALLOWED_ORIGINS` → https://estofariadigital.com.br

**Staging (dev):**
- `DATABASE_URL` → Postgres staging (banco separado)
- `JWT_SECRET` → secret de staging
- `CORS_ALLOWED_ORIGINS` → https://dev.estofaria-digital.pages.dev

## Fluxo de trabalho

```
Desenvolve em dev → testa no staging → PR → merge main → produção
```
