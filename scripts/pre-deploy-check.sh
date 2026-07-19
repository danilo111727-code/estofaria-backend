#!/bin/bash
# =============================================================================
# PRE-DEPLOY CHECK — Estofaria Digital Frontend
# Executa antes de qualquer deploy manual via wrangler.
# Uso: bash scripts/pre-deploy-check.sh
# =============================================================================

set -e
BOLD="\033[1m"
RED="\033[31m"
YELLOW="\033[33m"
GREEN="\033[32m"
RESET="\033[0m"
ERRORS=0

echo -e "${BOLD}=== PRE-DEPLOY CHECK — Estofaria Digital ===${RESET}\n"

# 1. Arquivos modificados não commitados
UNCOMMITTED=$(git status --porcelain | grep -v "^??" | wc -l)
if [ "$UNCOMMITTED" -gt 0 ]; then
  echo -e "${RED}[ERRO] Existem $UNCOMMITTED arquivo(s) modificado(s) não commitados:${RESET}"
  git status --porcelain | grep -v "^??"
  echo -e "${YELLOW}  → Faça commit antes de deploiar ou as melhorias serão perdidas no próximo deploy via GitHub Actions.${RESET}\n"
  ERRORS=$((ERRORS + 1))
else
  echo -e "${GREEN}[OK] Nenhum arquivo modificado sem commit.${RESET}"
fi

# 2. frontend/ sincronizado com root
DESYNC=0
for SRC in agenda/script.js agenda/__content.html painel/script.js painel/__content.html configuracao/script.js configuracao/__content.html app-shell.js; do
  if [ -f "frontend/$SRC" ]; then
    if ! diff -q "$SRC" "frontend/$SRC" > /dev/null 2>&1; then
      echo -e "${RED}[ERRO] Dessincronizado: $SRC ≠ frontend/$SRC${RESET}"
      DESYNC=$((DESYNC + 1))
    fi
  fi
done
if [ "$DESYNC" -eq 0 ]; then
  echo -e "${GREEN}[OK] Pasta frontend/ sincronizada com arquivos raiz.${RESET}"
else
  echo -e "${YELLOW}  → Execute: bash scripts/sync-frontend.sh${RESET}\n"
  ERRORS=$((ERRORS + 1))
fi

# 3. Branch atual
BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$BRANCH" != "main" ]; then
  echo -e "${YELLOW}[AVISO] Você está no branch '$BRANCH', não no 'main'. O deploy usará os arquivos locais (--commit-dirty=true).${RESET}"
fi

# 4. Divergência com origin/main
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/main 2>/dev/null || echo "desconhecido")
if [ "$LOCAL" != "$REMOTE" ]; then
  echo -e "${YELLOW}[AVISO] HEAD local ($LOCAL) ≠ origin/main ($REMOTE). Considera dar push antes de deploiar.${RESET}"
else
  echo -e "${GREEN}[OK] HEAD local igual ao origin/main.${RESET}"
fi

echo ""
if [ "$ERRORS" -gt 0 ]; then
  echo -e "${RED}${BOLD}Encontrados $ERRORS problema(s). Corrija antes de deploiar.${RESET}"
  exit 1
else
  echo -e "${GREEN}${BOLD}Tudo OK. Pode deploiar com segurança.${RESET}"
fi
