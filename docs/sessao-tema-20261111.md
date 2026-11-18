# Sessão de 30 dias e tema claro inicial — 11/11/2026

## Escopo
- Backend: src/lib/auth.js emite novos tokens com expiração fixa de 30 dias, sem renovar por atividade. A política fica no código, sem depender da variável legada JWT_EXPIRES_IN=48h no Render. Segredo e validação de tokens preservados.
- Frontend: config.js alinha os prazos locais a 30 dias e continua respeitando a expiração assinada pelo backend. painel/theme.js inicia claro quando não há preferência válida; escolhas explícitas dark/light e botão de alternância preservados.
- Sem migração de banco ou alteração do Stripe. Contas e assinaturas não são modificadas pelo pacote.

## Validação
17 testes focados aprovados (9 backend e 8 frontend): expiração no limite de 30 dias com relógio simulado; acesso no dia 29; ausência de renovação; tokens antigos de 48h não ampliados; saída limpa; usuário desativado, sessão revogada, vínculo inativo e assinatura bloqueada continuam impedidos; tema inicial claro, preferências e alternância.
Backend oficial de teste publicou commit 119a4f556603a3cb09c6042ba20bef5b98abb038, deploy dep-dbq9oe95efls73ah0scg live. Cadastro e login fictícios via HTTP emitiram tokens de 30 dias; /api/auth/me respondeu 200 em ambos. Não se aguardaram 30 dias reais: a fronteira temporal foi validada por simulação.
CI backend de sessão: https://github.com/danilo111727-code/estofaria-backend/actions/runs/43061841769
CI frontend: https://github.com/danilo111727-code/estofaria-frontend/actions/runs/43061985706
Regressões existentes de Stripe, Painel e Portfólio passaram no backend dev; verificações existentes de fabricação/reforma, celular/notebook, layout e fotos passaram no frontend de teste.

## Publicação manual
Backend produção: estofaria-backend, main, autoDeploy off. Usar Manual Deploy > Deploy latest commit após conferir o commit preparado. Nenhuma chave ou variável precisa ser editada para esta política.
Frontend produção: workflow Deploy para Cloudflare Pages (deploy.yml), selecionar main e executar manualmente.
A preparação no GitHub não equivale a publicação em produção.

## Limites e retorno
A mudança vale para o próximo login. Sessões existentes mantêm o exp original. Tema é preferência deste navegador; uma escolha explícita de escuro permanece.
Para voltar, reverter somente o commit deste pacote em cada repositório e publicar manualmente. Voltar o código para 48h não revoga tokens de 30 dias já emitidos; revogação administrativa continua disponível.

Frontend oficial de teste publicado: commit dbb0fd1b168d0095d53fc8fbe416b22fa12d1cfc. Workflow de publicação e verificação da versão exata concluído com sucesso: https://github.com/danilo111727-code/estofaria-frontend/actions/runs/43061985756 .
