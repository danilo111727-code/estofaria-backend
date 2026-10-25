# Pacote 02 — preparação e retorno

Preparado em 2026-10-25. Nenhuma publicação de produção foi executada.

## Referências preservadas

- Frontend: `backup/producao-antes-pacote02-20261025`, commit `19c1c4c6dcb97d7f0473217a4f93e622bb630c41`.
- Backend: `backup/main-antes-pacote02-20261025`, commit `1c3245ce6a0f0e35d2862066c8419ae2cf9b684e`.
- Pendente: confirmar no Render o serviço de produção e seu commit em execução. A referência do backend preserva a main; não é ainda uma confirmação do artefato ao vivo.

## Escopo da candidata

Pronta entrega e suas rotas, fotos, estoque, busca, total, lixeira e limpeza por empresa. Sob encomenda mantém o conteúdo atual da produção. Pacote 03 excluído. Máscara de medidas aplicada também à profundidade e altura na Precificação. Ajustes mais recentes do formulário de pronta entrega restritos ao CSS de desktop (min-width:1024px).

## Verificação

56 testes passaram: 6 de cadastro/medidas, 10 do frontend de pronta entrega e 40 de backend (pronta entrega, lixeira, limpeza por empresa e inicialização). Um teste adicional de importação de recuperação ficou ignorado por depender de arquivo externo. Sintaxe JavaScript e diff verificados. A compilação pública completa e a revisão visual desta combinação isolada ainda devem ser executadas antes de autorizar a publicação.

## Publicação, somente após nova autorização

1. Confirmar o commit ao vivo e a versão de retorno do backend no Render.
2. Concluir build público e revisão da candidata em desktop e celular.
3. Publicar o backend com o novo schema aditivo e validar saúde/rotas.
4. Publicar o frontend e verificar as funções do pacote 02.

## Retorno, somente após autorização

1. Restaurar o frontend pelo commit preservado. O workflow `Deploy para Cloudflare Pages` é manual e aceita a referência da branch de backup; ele publica no projeto de produção. Não executá-lo para testes.
2. Se necessário, restaurar no Render o deploy anterior confirmado, ou o commit exato que ele utilizava. Não presumir que main seja esse deploy.
3. Não excluir a tabela `app_ready_models_v1`, imagens, nem restaurar todo o banco durante retorno de código. As migrações deste pacote criam/adaptam apenas a tabela do pacote 02.
4. Validar login e os fluxos existentes de Catálogo/Precificação após o retorno.

Estas referências preservam versões de código; não constituem backup de banco de dados nem dos objetos R2. Nenhum dado de produção foi modificado por esta preparação.
