'use strict'

module.exports = function registerWhatsapp(storeLib){
  return function registerWhatsappMiddleware(req, res, next){
    const whatsapp = String(req.body?.whatsapp || '').replace(/\s+/g, ' ').trim().slice(0, 40)
    const digits = whatsapp.replace(/\D/g, '')

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
        console.error('[register-whatsapp] Falha ao salvar WhatsApp:', error)
      }
      return originalJson(payload)
    }

    next()
  }
}
