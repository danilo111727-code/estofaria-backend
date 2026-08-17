# Models V2 + Cloudflare R2

Esta fase cria uma arquitetura paralela para modelos e imagens. Ela não remove nem altera o `kv_store`.

## Variáveis de ambiente do R2

Configure apenas no backend/Render:

- `R2_ACCOUNT_ID`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_BUCKET`
- opcional: `R2_ENDPOINT`

As credenciais não devem ser colocadas no frontend.

## Tabelas novas

- `app_models_v2`
- `app_model_materials_v2`
- `app_model_images_v2`

Todas são segregadas por `company_id`.

## API paralela

Base: `/api/v2`

- `GET /models`
- `GET /models/:id`
- `POST /models`
- `PUT|PATCH /models/:id`
- `DELETE /models/:id` (soft delete)
- `PUT /models/:id/images/original`
- `PUT /models/:id/images/thumb`
- `GET /models/:id/images/:variant/url`
- `DELETE /models/:id/images/:variant`

A API V2 rejeita imagem base64 dentro do JSON do modelo. Imagens são objetos separados no R2.

## Migração segura

O script é dry-run por padrão:

```bash
node scripts/migrate-models-v2.js
```

Para aplicar após backup, R2 configurado e autorização explícita:

```bash
node scripts/migrate-models-v2.js --apply
```

Opcionalmente filtrar uma empresa:

```bash
node scripts/migrate-models-v2.js --apply --company=COMPANY_ID
```

A migração é idempotente por `company_id + legacy_id` e não apaga o `kv_store`.
