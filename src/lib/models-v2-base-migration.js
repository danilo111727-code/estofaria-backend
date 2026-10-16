'use strict'

// Rotina aposentada: a magnitude não identifica se o valor veio em centímetros.
// Mantém o contrato do registro de startup sem reescrever medidas existentes.
async function normalizeExistingBaseMeters() {
  return { updated: 0, skipped: true }
}

module.exports = { normalizeExistingBaseMeters }
