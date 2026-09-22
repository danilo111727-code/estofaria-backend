'use strict'

const AUTOMATIC_METER_UNITS = new Set([
  'metro',
  'metro linear',
  'metro quadrado'
])

function text(value) {
  return String(value ?? '').trim()
}

function normalizeUnit(value) {
  return text(value)
    .toLocaleLowerCase('pt-BR')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
}

function meterKey(value) {
  const meter = Number(String(value).replace(',', '.'))
  if (!Number.isFinite(meter) || meter <= 0) return null
  return meter.toFixed(meter % 1 === 0 ? 1 : 2)
}

function defaultMeters() {
  const meters = []
  for (let value = 10; value <= 50; value += 1) {
    meters.push(meterKey(value / 10))
  }
  return meters
}

function modelMeters(modelConfig = {}) {
  const saved = Array.isArray(modelConfig.metragens) ? modelConfig.metragens : []
  const normalized = saved.map(meterKey).filter(Boolean)
  return normalized.length ? [...new Set(normalized)] : defaultMeters()
}

function itemKey(item = {}) {
  return text(item.name || item.nome).replace(/\s+/g, ' ').toLocaleLowerCase('pt-BR')
}

function isFoam(item = {}) {
  return normalizeUnit(item.category) === 'espuma'
}

function usesAutomaticMeterConsumption(item = {}) {
  const unit = isFoam(item) ? 'metro linear' : normalizeUnit(item.unit || item.unidade)
  return AUTOMATIC_METER_UNITS.has(unit)
}

function savedConsumptions(item, modelConfig = {}) {
  const key = itemKey(item)
  const saved = key && modelConfig.consumos && typeof modelConfig.consumos === 'object'
    ? modelConfig.consumos[key]
    : null
  return saved && typeof saved === 'object' && !Array.isArray(saved) ? { ...saved } : {}
}

function hasEquivalentMeter(result, meter) {
  return Object.keys(result).some(key => {
    const savedMeter = Number(String(key).replace(',', '.'))
    return Number.isFinite(savedMeter) && savedMeter === meter
  })
}

function resolveItemConsumptions(item, modelConfig = {}) {
  const result = savedConsumptions(item, modelConfig)
  if (!usesAutomaticMeterConsumption(item)) return result

  modelMeters(modelConfig).forEach(rawMeter => {
    const key = meterKey(rawMeter)
    const meter = Number(key)
    if (!key || hasEquivalentMeter(result, meter)) return
    result[key] = meter
  })
  return result
}

function resolveModelConfig(catalog = {}, modelConfig = {}) {
  const consumos = modelConfig.consumos && typeof modelConfig.consumos === 'object'
    ? { ...modelConfig.consumos }
    : {}
  const resolvedConfig = {
    ...modelConfig,
    metragens: modelMeters(modelConfig),
    consumos
  }

  ;(Array.isArray(catalog.items) ? catalog.items : []).forEach(item => {
    if (!usesAutomaticMeterConsumption(item)) return
    const key = itemKey(item)
    if (!key) return
    resolvedConfig.consumos[key] = resolveItemConsumptions(item, resolvedConfig)
  })
  return resolvedConfig
}

module.exports = {
  defaultMeters,
  modelMeters,
  usesAutomaticMeterConsumption,
  resolveItemConsumptions,
  resolveModelConfig
}
