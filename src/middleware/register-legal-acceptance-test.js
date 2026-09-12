'use strict'

module.exports = function registerLegalAcceptanceTest(req, res, next){
  const acceptedTerms = req.body?.accepted_terms === true
  const acceptedPrivacy = req.body?.accepted_privacy === true
  const legalVersion = String(req.body?.legal_version || '').trim()

  if(!acceptedTerms || !acceptedPrivacy){
    return res.status(400).json({
      error:'legal_acceptance_required',
      message:'Aceite os Termos de Uso e a Política de Privacidade para criar sua conta.'
    })
  }

  if(legalVersion && legalVersion !== '2026-08-30-v1'){
    return res.status(400).json({
      error:'legal_version_mismatch',
      message:'A versão dos documentos legais foi atualizada. Recarregue a página e aceite novamente.'
    })
  }

  next()
}
