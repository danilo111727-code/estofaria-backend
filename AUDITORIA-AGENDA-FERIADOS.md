# Auditoria da agenda — feriados nacionais

## Escopo auditado
- Frontend da agenda (`agenda/script.js`, `agenda/__content.html`)
- Backend de operações (`src/routes/operations.js`)

## Achados críticos
1. **Dias úteis ignoravam feriados nacionais**
   - A função de agenda considerava apenas sábado e domingo.
   - Impacto: datas como **03/04/2026 (Paixão de Cristo)** eram tratadas como úteis.

2. **Endpoint de feriados retornava vazio**
   - `/api/calendar/holidays` respondia `holidays: []`.
   - Impacto: o frontend não tinha base oficial para bloquear ou exibir feriados.

3. **Feriados não eram exibidos na interface**
   - A agenda não mostrava a lista de feriados nacionais carregados.
   - Impacto: o usuário não conseguia conferir visualmente se um feriado estava sendo considerado.

## Correções aplicadas
1. **Backend passou a gerar feriados nacionais reais**
   - Implementada geração dos feriados nacionais fixos do Brasil.
   - Implementado cálculo de **Paixão de Cristo** por ano.
   - Endpoint `/api/calendar/holidays` agora aceita `year`/`years` e devolve a lista preenchida.

2. **Frontend agora carrega feriados nacionais**
   - A agenda passou a consultar o endpoint de feriados ao carregar a tela.
   - O estado da agenda guarda os feriados para uso no cálculo.

3. **Cálculo de dias úteis corrigido**
   - A lógica agora pula:
     - sábado
     - domingo
     - feriados nacionais retornados pelo backend

4. **Distribuição de vagas na semana ajustada**
   - A agenda agora usa os dias realmente válidos da semana ao montar os slots quando o tipo está em `Úteis`.

5. **Interface passou a exibir feriados nacionais**
   - Adicionada seção `Feriados nacionais` com as próximas datas carregadas.

## Validação executada
- Sintaxe JS validada com sucesso nos arquivos alterados.
- Backend local subiu com sucesso.
- `/api/calendar/holidays?year=2026` validado com retorno de:
  - `2026-04-03 — Paixão de Cristo`
  - demais feriados nacionais do ano.

## Riscos remanescentes / próximos passos recomendados
1. Incluir **feriados estaduais e municipais** por configuração da empresa.
2. Destacar visualmente pedidos antigos que já tenham sido gravados em um feriado.
3. Adicionar teste automatizado para anos futuros e feriados móveis.
4. Publicar novamente frontend e backend para a correção entrar no ambiente online.
