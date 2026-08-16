'use strict'

function pickImage(model){
  if(!model || typeof model !== 'object') return ''
  return model.image_data_url || model.imageDataUrl || model.foto_data_url || model.fotoDataUrl || model.photo_data_url || model.photoDataUrl || model.image || model.photo || model.foto || ''
}

function compactModel(model){
  if(!model || typeof model !== 'object' || Array.isArray(model)) return model

  const image = pickImage(model)
  const compact = { ...model }

  if(image) compact.image_data_url = image
  else delete compact.image_data_url

  delete compact.imageDataUrl
  delete compact.foto_data_url
  delete compact.fotoDataUrl
  delete compact.photo_data_url
  delete compact.photoDataUrl
  delete compact.image
  delete compact.photo
  delete compact.foto

  return compact
}

function isModelResponsePath(req){
  const path = String(req.originalUrl || req.url || '').split('?')[0]
  return /^\/api\/models(?:\/[^/]+)?\/?$/.test(path)
}

function compactModelResponse(req, res, next){
  if(!isModelResponsePath(req)) return next()

  const originalJson = res.json.bind(res)
  res.json = function(body){
    if(Array.isArray(body)) return originalJson(body.map(compactModel))
    return originalJson(compactModel(body))
  }

  next()
}

module.exports = compactModelResponse
