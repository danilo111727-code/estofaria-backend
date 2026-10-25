# Pacote 02 — preparação e retorno

Preparado em 2026-10-25. Nenhuma publicação de produção foi executada.

## Referências preservadas

- Frontend: `backup/producao-antes-pacote02-20261025`, commit `19c1c4c6dcb97d7f0473217a4f93e622bb630c41`.
- Backend: `backup/main-antes-pacote02-20261025`, commit `1c3245ce6a0f0e35d2862066c8419ae2cf9b684e`.
- Confirmado no Render em 2026-10-25: workspace `My Workspace` (`tea-d6vjiqea2pns73akeu0g`), serviço `estofaria-backend` (`srv-d762rr7fte5s73cg997g`), deploy ao vivo `dep-dbf1q15g1s2s73e64sa0`, commit `1c3245ce6a0f0e35d2862066c8419ae2cf9b684e`. A referência de segurança do backend corresponde ao código no ar. Auto-deploy de produção está desligado.

## Escopo da candidata

Pronta entrega e suas rotas, fotos, estoque, busca, total, lixeira e limpeza por empresa. Sob encomenda mantém o conteúdo atual da produção. Pacote 03 excluído. Máscara de medidas aplicada também à profundidade e altura na Precificação. Ajustes mais recentes do formulário de pronta entrega restritos ao CSS de desktop (min-width:1024px).

## Verificação

56 testes passaram: 6 de cadastro/medidas, 10 do frontend de pronta entrega e 40 de backend (pronta entrega, lixeira, limpeza por empresa e inicialização). Um teste adicional de importação de recuperação ficou ignorado por depender de arquivo externo. Sintaxe JavaScript e diff verificados. O build público completo e a revisão visual em oito larguras foram concluídos; veja PACOTE02_CHECKUP.md. Os 16 testes de frontend também passaram sobre o bundle público gerado.

## Publicação, somente após nova autorização

1. Versão de retorno confirmada no Render; reconferir o deploy ao vivo imediatamente antes de publicar.
2. Build público e revisão da candidata concluídos; obter autorização explícita para publicação. A proposta posterior de cadastro por botão/página separada permanece fora desta candidata.
3. Publicar o backend com o novo schema aditivo e validar saúde/rotas.
4. Publicar o frontend e verificar as funções do pacote 02.

## Retorno, somente após autorização

1. Restaurar o frontend pelo commit preservado. O workflow `Deploy para Cloudflare Pages` é manual e aceita a referência da branch de backup; ele publica no projeto de produção. Não executá-lo para testes.
2. Se necessário, restaurar no Render o deploy preservado `dep-dbf1q15g1s2s73e64sa0` (se o artefato continuar disponível), ou publicar seu commit exato `1c3245ce6a0f0e35d2862066c8419ae2cf9b684e`. Antes de executar, consultar a documentação vigente de rollback e reconferir a configuração do serviço.
3. Não excluir a tabela `app_ready_models_v1`, imagens, nem restaurar todo o banco durante retorno de código. As migrações deste pacote criam/adaptam apenas a tabela do pacote 02.
4. Validar login e os fluxos existentes de Catálogo/Precificação após o retorno.

Estas referências preservam versões de código; não constituem backup de banco de dados nem dos objetos R2. Nenhum dado de produção foi modificado por esta preparação.
