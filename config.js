// Configuração oficial da API + sessão autenticada
(function(){
  const OFFICIAL_API = 'https://estofaria-backend.onrender.com'
  const AUTH_STORAGE_KEY = 'estofaria_auth_session_v1'
  const DEFAULT_SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000
  const REMEMBER_SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000

  function safeJsonParse(raw){
    if(!raw) return null
    try { return JSON.parse(raw) } catch (_) { return null }
  }

  function resolveApiBase(){
    try{
      const loc = window.location || {}
      const protocol = String(loc.protocol || '').toLowerCase()
      const host = String(loc.host || '').trim()
      const hostname = String(loc.hostname || '').trim().toLowerCase()
      const hasHttpOrigin = (protocol === 'http:' || protocol === 'https:') && host
      const sameOriginApi = hasHttpOrigin ? `${protocol}//${host}` : ''
      const isLocalDev = ['localhost', '127.0.0.1'].includes(hostname) || hostname.endsWith('.local')
      return isLocalDev && sameOriginApi ? sameOriginApi : OFFICIAL_API
    }catch(_){
      return OFFICIAL_API
    }
  }

  const selectedApi = resolveApiBase()
  window.API_BASE = selectedApi
  window.ESTOFARIA_DEFAULT_API = selectedApi
  window.ESTOFARIA_REMOTE_FALLBACK_API = OFFICIAL_API
  window.ESTOFARIA_ALLOW_API_OVERRIDE = false

  try{ localStorage.setItem('estofaria_api_base', selectedApi) }catch(_){ }

  function normalizeUser(user){
    return user && typeof user === 'object' ? { ...user } : {}
  }

  function buildSession(payload, options = {}){
    const token = String(payload && payload.token || '').trim()
    if(!token) return null

    const now = new Date()
    const remember = !!options.remember
    const ttlMs = remember ? REMEMBER_SESSION_TTL_MS : DEFAULT_SESSION_TTL_MS
    const createdAt = options.createdAt || now.toISOString()
    const expiresAt = options.expiresAt || new Date(now.getTime() + ttlMs).toISOString()

    return {
      token,
      user: normalizeUser(payload && payload.user),
      remember,
      created_at: createdAt,
      expires_at: expiresAt,
      last_seen_at: now.toISOString()
    }
  }

  function readLegacySession(){
    try{
      const token = String(localStorage.getItem('auth_token') || localStorage.getItem('token') || '').trim()
      if(!token) return null
      const user = safeJsonParse(localStorage.getItem('auth_user')) || {}
      return buildSession({ token, user }, { remember:true })
    }catch(_){
      return null
    }
  }

  function readStoredSession(){
    try{
      const parsed = safeJsonParse(localStorage.getItem(AUTH_STORAGE_KEY))
      if(parsed && typeof parsed === 'object') return parsed
    }catch(_){ }
    return readLegacySession()
  }

  function clearLegacyKeys(){
    try {
      localStorage.removeItem('auth_token')
      localStorage.removeItem('auth_user')
      localStorage.removeItem('token')
    } catch (_) {}
  }

  function persistSessionObject(session){
    if(!session || !session.token){
      clearLegacyKeys()
      try { localStorage.removeItem(AUTH_STORAGE_KEY) } catch (_) {}
      return null
    }
    try {
      localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(session))
      localStorage.setItem('auth_token', session.token)
      localStorage.setItem('token', session.token)
      localStorage.setItem('auth_user', JSON.stringify(normalizeUser(session.user)))
    } catch (_) {}
    return session
  }

  function isExpired(session){
    const expiresAt = String(session && session.expires_at || '').trim()
    if(!expiresAt) return false
    const time = new Date(expiresAt).getTime()
    return Number.isFinite(time) ? Date.now() > time : false
  }

  function getSession(){
    const raw = readStoredSession()
    if(!raw || !raw.token){
      clearSession()
      return null
    }
    const session = buildSession(raw, {
      remember: !!raw.remember,
      createdAt: raw.created_at,
      expiresAt: raw.expires_at
    })
    session.user = normalizeUser(raw.user)
    session.last_seen_at = raw.last_seen_at || session.last_seen_at

    if(isExpired(session)){
      clearSession()
      return null
    }

    persistSessionObject(session)
    return session
  }

  function setSession(payload, options = {}){
    const session = buildSession(payload, options)
    return persistSessionObject(session)
  }

  function updateUser(user){
    const current = getSession()
    if(!current) return null
    current.user = normalizeUser(user)
    current.last_seen_at = new Date().toISOString()
    return persistSessionObject(current)
  }

  function clearSession(){
    try { localStorage.removeItem(AUTH_STORAGE_KEY) } catch (_) {}
    clearLegacyKeys()
  }

  function getToken(){
    return (getSession() && getSession().token) || ''
  }

  function getUser(){
    return normalizeUser(getSession() && getSession().user)
  }

  function buildAuthHeaders(extra = {}){
    const headers = { Accept:'application/json', ...extra }
    const token = getToken()
    if(token && !headers.Authorization) headers.Authorization = 'Bearer ' + token
    return headers
  }

  function withTimeout(promise, timeoutMs, label = 'requisição'){
    const ms = Number(timeoutMs || 0)
    if(!Number.isFinite(ms) || ms <= 0) return promise
    let timer = null
    const timeoutPromise = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Tempo esgotado em ${label}`)), ms)
    })
    return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timer))
  }

  async function fetchAny(url, options = {}){
    const fetchOptions = { ...options }
    const timeoutMs = Number(fetchOptions.timeoutMs || 0)
    const label = fetchOptions.timeoutLabel || String(url || 'requisição')
    delete fetchOptions.timeoutMs
    delete fetchOptions.timeoutLabel
    fetchOptions.headers = buildAuthHeaders(fetchOptions.headers || {})
    return withTimeout(fetch(String(url || ''), fetchOptions), timeoutMs, label)
  }

  async function fetchJson(url, options = {}){
    const response = await fetchAny(url, options)
    const contentType = String(response.headers.get('content-type') || '')
    const data = contentType.includes('application/json')
      ? await response.json().catch(() => ({}))
      : await response.text().catch(() => '')

    if(!response.ok){
      const message =
        (data && typeof data === 'object' && (data.message || data.error)) ||
        (typeof data === 'string' && data.trim()) ||
        `Falha em ${String(url || '')} (${response.status})`
      const error = new Error(message)
      error.status = response.status
      error.payload = data
      throw error
    }

    return data
  }

  window.ESTOFARIA_AUTH = {
    storageKey: AUTH_STORAGE_KEY,
    defaultSessionTtlMs: DEFAULT_SESSION_TTL_MS,
    rememberSessionTtlMs: REMEMBER_SESSION_TTL_MS,
    getSession,
    setSession,
    updateUser,
    clearSession,
    getToken,
    getUser,
    isAuthenticated: function(){ return !!getToken() }
  }

  window.ESTOFARIA_HTTP = {
    getToken,
    authHeaders: buildAuthHeaders,
    withTimeout,
    fetchAny,
    fetchJson
  }

  function ensureUiStyles(doc){
    if(!doc || doc.getElementById('estofaria-ui-styles')) return
    const style = doc.createElement('style')
    style.id = 'estofaria-ui-styles'
    style.textContent = `
      .est-ui-toast-host{position:fixed;right:16px;bottom:16px;display:flex;flex-direction:column;gap:10px;z-index:999999;max-width:min(92vw,420px)}
      .est-ui-toast{border-radius:14px;padding:14px 16px;color:#fff;box-shadow:0 14px 34px rgba(15,23,42,.28);font:600 14px/1.4 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;animation:estUiToastIn .18s ease-out}
      .est-ui-toast.info{background:#2563eb}.est-ui-toast.success{background:#059669}.est-ui-toast.warning{background:#d97706}.est-ui-toast.danger{background:#dc2626}
      .est-ui-backdrop{position:fixed;inset:0;background:rgba(15,23,42,.56);backdrop-filter:blur(2px);display:flex;align-items:center;justify-content:center;padding:18px;z-index:1000000}
      .est-ui-modal{width:min(100%,460px);background:#fff;border-radius:18px;box-shadow:0 24px 60px rgba(15,23,42,.28);overflow:hidden;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
      .est-ui-modal-head{padding:18px 20px 8px;font-size:18px;font-weight:800;color:#0f172a}
      .est-ui-modal-body{padding:0 20px 18px;color:#334155;font-size:14px;line-height:1.5;white-space:pre-line}
      .est-ui-modal-field{display:flex;flex-direction:column;gap:8px;margin-top:6px}
      .est-ui-modal-field label{font-size:13px;font-weight:700;color:#334155}
      .est-ui-modal-field input{width:100%;box-sizing:border-box;border:1px solid #cbd5e1;border-radius:12px;padding:12px 14px;font-size:15px;outline:none}
      .est-ui-modal-field input:focus{border-color:#2563eb;box-shadow:0 0 0 3px rgba(37,99,235,.14)}
      .est-ui-modal-foot{padding:14px 20px 20px;display:flex;justify-content:flex-end;gap:10px;flex-wrap:wrap}
      .est-ui-btn{border:none;border-radius:12px;padding:11px 16px;font-size:14px;font-weight:800;cursor:pointer}
      .est-ui-btn.secondary{background:#e2e8f0;color:#0f172a}.est-ui-btn.primary{background:#2563eb;color:#fff}.est-ui-btn.danger{background:#dc2626;color:#fff}.est-ui-btn.warning{background:#d97706;color:#fff}
      @keyframes estUiToastIn{from{transform:translateY(8px);opacity:0}to{transform:translateY(0);opacity:1}}
      @keyframes estUiSpin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
    `
    doc.head.appendChild(style)
  }

  function ensureToastHost(doc){
    ensureUiStyles(doc)
    let host = doc.getElementById('est-ui-toast-host')
    if(host) return host
    host = doc.createElement('div')
    host.id = 'est-ui-toast-host'
    host.className = 'est-ui-toast-host'
    doc.body.appendChild(host)
    return host
  }

  function escapeHtml(text){
    return String(text || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
  }

  function getUiDocument(){
    try {
      if (window.parent && window.parent !== window && window.parent.document && window.parent.document.body) {
        return window.parent.document
      }
    } catch (_) {}
    return document
  }

  function toast(message, options = {}){
    const doc = getUiDocument()
    const host = ensureToastHost(doc)
    const node = doc.createElement('div')
    node.className = `est-ui-toast ${options.type || 'info'}`
    node.innerHTML = options.title
      ? `<strong style="display:block;margin-bottom:4px">${escapeHtml(options.title)}</strong>${escapeHtml(message)}`
      : escapeHtml(message)
    host.appendChild(node)
    const duration = Math.max(1200, Number(options.duration || 2800))
    setTimeout(() => {
      node.style.opacity = '0'
      node.style.transform = 'translateY(8px)'
      setTimeout(() => node.remove(), 180)
    }, duration)
  }

  function openModal(options = {}){
    const doc = getUiDocument()
    ensureUiStyles(doc)
    return new Promise(resolve => {
      const backdrop = doc.createElement('div')
      backdrop.className = 'est-ui-backdrop'
      const modal = doc.createElement('div')
      modal.className = 'est-ui-modal'
      const tone = ['danger','warning'].includes(options.type) ? options.type : 'primary'
      const hasInput = options.mode === 'prompt'
      modal.innerHTML = `
        <div class="est-ui-modal-head">${escapeHtml(options.title || 'Confirmação')}</div>
        <div class="est-ui-modal-body">
          ${options.message ? `<div>${escapeHtml(options.message)}</div>` : ''}
          ${hasInput ? `<div class="est-ui-modal-field"><label>${escapeHtml(options.label || 'Valor')}</label><input id="est-ui-prompt-input" type="text" placeholder="${escapeHtml(options.placeholder || '')}" value="${escapeHtml(options.value || '')}" /></div>` : ''}
        </div>
        <div class="est-ui-modal-foot">
          ${options.showCancel === false ? '' : '<button type="button" class="est-ui-btn secondary" data-action="cancel">Cancelar</button>'}
          <button type="button" class="est-ui-btn ${tone}" data-action="confirm">${escapeHtml(options.confirmText || 'Confirmar')}</button>
        </div>
      `
      backdrop.appendChild(modal)
      doc.body.appendChild(backdrop)

      const input = modal.querySelector('#est-ui-prompt-input')
      if(input){
        setTimeout(() => { input.focus(); input.select(); }, 20)
      }

      function close(value){
        backdrop.remove()
        resolve(value)
      }

      modal.querySelector('[data-action="confirm"]')?.addEventListener('click', () => {
        close(input ? input.value : true)
      })
      modal.querySelector('[data-action="cancel"]')?.addEventListener('click', () => close(null))
      backdrop.addEventListener('click', event => {
        if(event.target === backdrop) close(null)
      })
      modal.addEventListener('keydown', event => {
        if(event.key === 'Escape') close(null)
        if(event.key === 'Enter' && (!input || event.target === input)){
          event.preventDefault()
          close(input ? input.value : true)
        }
      })
    })
  }

  function resolveButtonTarget(target){
    if(!target) return null
    if(typeof target === 'string') return document.getElementById(target)
    if(target && typeof target === 'object' && target.nodeType === 1) return target
    return null
  }

  function setButtonLoading(target, busy, options = {}){
    const button = resolveButtonTarget(target)
    if(!button) return null

    if(busy){
      if(button.dataset.estUiBusy === '1') return button
      button.dataset.estUiBusy = '1'
      button.dataset.estUiOriginalHtml = button.innerHTML
      button.dataset.estUiOriginalDisabled = button.disabled ? '1' : '0'
      button.disabled = true
      button.style.pointerEvents = 'none'
      button.setAttribute('aria-busy', 'true')
      const label = String(options.loadingText || button.dataset.loadingText || 'Processando...')
      button.innerHTML = `<span style="display:inline-flex;align-items:center;justify-content:center;gap:8px"><span style="width:14px;height:14px;border:2px solid currentColor;border-right-color:transparent;border-radius:999px;display:inline-block;animation:estUiSpin .7s linear infinite"></span><span>${escapeHtml(label)}</span></span>`
      return button
    }

    if(button.dataset.estUiOriginalHtml !== undefined){
      button.innerHTML = button.dataset.estUiOriginalHtml
    }
    button.disabled = button.dataset.estUiOriginalDisabled === '1'
    button.style.pointerEvents = ''
    button.removeAttribute('aria-busy')
    delete button.dataset.estUiBusy
    delete button.dataset.estUiOriginalHtml
    delete button.dataset.estUiOriginalDisabled
    return button
  }

  async function runButtonAction(target, action, options = {}){
    const button = resolveButtonTarget(target)
    if(button && button.dataset.estUiBusy === '1') return null
    setButtonLoading(button, true, options)
    try{
      return await action(button)
    }finally{
      setButtonLoading(button, false, options)
    }
  }

  window.ESTOFARIA_UI = {
    toast,
    success(message, options = {}){ toast(message, { ...options, type:'success' }) },
    error(message, options = {}){ toast(message, { ...options, type:'danger', duration: options.duration || 3600 }) },
    info(message, options = {}){ toast(message, { ...options, type:'info' }) },
    warning(message, options = {}){ toast(message, { ...options, type:'warning', duration: options.duration || 3400 }) },
    setButtonLoading,
    runButtonAction,
    async alert(message, options = {}){
      return openModal({ title: options.title || 'Aviso', message, confirmText: options.confirmText || 'OK', showCancel:false, type: options.type || 'primary' })
    },
    async confirm(message, options = {}){
      const result = await openModal({ title: options.title || 'Confirmar ação', message, confirmText: options.confirmText || 'Confirmar', type: options.type || 'primary' })
      return result === true
    },
    async prompt(options = {}){
      const result = await openModal({ mode:'prompt', title: options.title || 'Preencher campo', message: options.message || '', label: options.label || 'Valor', value: options.value || '', placeholder: options.placeholder || '', confirmText: options.confirmText || 'Salvar', type: options.type || 'primary' })
      return result === null ? null : String(result)
    }
  }
})()
