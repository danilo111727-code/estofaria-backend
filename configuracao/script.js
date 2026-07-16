(function(){
  var API = (window.ESTOFARIA_CONFIG && window.ESTOFARIA_CONFIG.API_URL) || 'https://estofaria-backend.onrender.com'

  function getToken(){
    try {
      var auth = window.ESTOFARIA_AUTH
      if(auth && typeof auth.getToken === 'function') return auth.getToken()
    } catch(_){}
    return localStorage.getItem('auth_token') || localStorage.getItem('token') || ''
  }

  function apiGet(path){
    return fetch(API + path, { headers:{ Authorization:'Bearer '+getToken() } }).then(function(r){ return r.json() })
  }
  function apiPut(path, body){
    return fetch(API + path, {
      method:'PUT',
      headers:{ 'Content-Type':'application/json', Authorization:'Bearer '+getToken() },
      body: JSON.stringify(body)
    }).then(function(r){ return r.json() })
  }

  function el(id){ return document.getElementById(id) }
  function val(id){ return el(id) ? el(id).value.trim() : '' }
  function setVal(id, v){ if(el(id)) el(id).value = v || '' }

  function showNotice(msg, ok){
    var n = el('cfgNotice')
    if(!n) return
    n.textContent = msg
    n.className = 'cfg-notice ' + (ok ? 'cfg-notice--ok' : 'cfg-notice--err')
    clearTimeout(n._t)
    n._t = setTimeout(function(){ n.className = 'cfg-notice' }, 4000)
  }

  function loadConfig(){
    apiGet('/config').then(function(data){
      var c = data && (data.data || data)
      if(!c) return
      setVal('cfgPrazoDias', c.prazo_dias)
      setVal('cfgVagasSemana', c.vagas_semana)
      setVal('cfgTipoDias', c.tipo_dias || 'corrido')
      setVal('cfgCityCode', c.city_code || '')
      setVal('cfgDataInicioEntrega', c.data_inicio_entrega || '')
      var lbl = el('cfgLoading')
      if(lbl) lbl.style.display = 'none'
      var form = el('cfgForm')
      if(form) form.style.display = ''
    }).catch(function(){
      var lbl = el('cfgLoading')
      if(lbl) lbl.textContent = 'Não foi possível carregar as configurações.'
    })
  }

  function saveConfig(){
    var btn = el('cfgSaveBtn')
    if(btn) btn.disabled = true
    var body = {
      prazo_dias: parseInt(val('cfgPrazoDias'), 10) || 0,
      vagas_semana: parseInt(val('cfgVagasSemana'), 10) || 0,
      tipo_dias: val('cfgTipoDias') || 'corrido',
      city_code: val('cfgCityCode'),
      data_inicio_entrega: val('cfgDataInicioEntrega')
    }
    apiPut('/config', body).then(function(data){
      if(btn) btn.disabled = false
      if(data && (data.ok || data.data || data.success)){
        showNotice('Configurações salvas com sucesso!', true)
      } else {
        showNotice('Erro ao salvar. Tente novamente.', false)
      }
    }).catch(function(){
      if(btn) btn.disabled = false
      showNotice('Erro de conexão. Tente novamente.', false)
    })
  }

  document.addEventListener('DOMContentLoaded', function(){
    loadConfig()
    var btn = el('cfgSaveBtn')
    if(btn) btn.addEventListener('click', saveConfig)
  })
})()
