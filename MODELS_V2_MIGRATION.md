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
- `POST /models/:id/images/:variant/upload-url`
- upload direto do navegador para a URL temporária do R2
- `POST /models/:id/images/:variant/complete`
- `GET /models/:id/images/:variant/url`
- `DELETE /models/:id/images/:variant`

Variantes aceitas: `original` e `thumb`.

A API V2 rejeita imagem base64 dentro do JSON do modelo. O backend gera uma URL assinada de curta duração, o navegador envia a imagem diretamente ao R2 e depois confirma o upload. Assim a imagem não atravessa o Render no fluxo normal.

O bucket R2 deve permanecer privado. Para upload direto pelo navegador, configure CORS no bucket permitindo apenas as origens oficiais do Estofaria Digital e o método `PUT` com `Content-Type`.

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
