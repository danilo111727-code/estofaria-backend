#!/bin/bash
# =============================================================================
# SYNC FRONTEND/ — Estofaria Digital
# Mantém a pasta frontend/ em sincronia com os arquivos raiz.
# A pasta frontend/ é um espelho — nunca edite diretamente lá.
# Uso: bash scripts/sync-frontend.sh
# =============================================================================

PAIRS=(
  "agenda/script.js:frontend/agenda/script.js"
  "agenda/__content.html:frontend/agenda/__content.html"
  "painel/script.js:frontend/painel/script.js"
  "painel/__content.html:frontend/painel/__content.html"
  "configuracao/script.js:frontend/configuracao/script.js"
  "configuracao/__content.html:frontend/configuracao/__content.html"
  "app-shell.js:frontend/app-shell.js"
)

echo "Sincronizando frontend/..."
for PAIR in "${PAIRS[@]}"; do
  SRC="${PAIR%%:*}"
  DST="${PAIR##*:}"
  if [ -f "$SRC" ]; then
    cp "$SRC" "$DST"
    echo "  ✓ $DST"
  fi
done
echo "Concluído."
