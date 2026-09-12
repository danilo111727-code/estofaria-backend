'use strict'

module.exports = function registerWhatsappTest(storeLib){
  return function registerWhatsappMiddleware(req, res, next){
    const whatsapp = String(req.body?.whatsapp || '').replace(/\s+/g, ' ').trim().slice(0, 40)
    const digits = whatsapp.replace(/\D/g, '')
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

    if(!whatsapp || digits.length < 10){
      return res.status(400).json({
        error:'invalid_whatsapp',
        message:'Informe um WhatsApp válido para continuarmos auxiliando nos primeiros passos.'
      })
    }

    const originalJson = res.json.bind(res)
    res.json = function(payload){
      try{
        const companyId = payload?.user?.company_id
        if(companyId && res.statusCode >= 200 && res.statusCode < 300){
          const store = storeLib.readStore()
          const company = (store.companies || []).find(item => String(item.id) === String(companyId))
          if(company){
            company.owner_phone = whatsapp
            company.updated_at = new Date().toISOString()
            storeLib.writeStore(store)
          }
        }
      }catch(error){
        console.error('[register-whatsapp-test] Falha ao salvar WhatsApp:', error)
      }
      return originalJson(payload)
    }

    next()
  }
}
