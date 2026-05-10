const API = (window.API_BASE || '') + '/api'
const LOGIN_REDIRECT = '/painel/'
const EYE_OPEN_ICON = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M2.6 12s3.4-6 9.4-6 9.4 6 9.4 6-3.4 6-9.4 6S2.6 12 2.6 12Z" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><circle cx="12" cy="12" r="3.1" stroke="currentColor" stroke-width="1.8"/></svg>'
const EYE_CLOSED_ICON = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 4l16 16" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M9.9 5.5A11 11 0 0 1 12 5.3c6 0 9.4 6 9.4 6a17.8 17.8 0 0 1-3.1 3.8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M6.7 6.7A17.5 17.5 0 0 0 2.6 12s3.4 6 9.4 6a10.7 10.7 0 0 0 4-.7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M10.3 10.3A3 3 0 0 0 9 12a3 3 0 0 0 4.7 2.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>'

const pendingActions = { login:false, register:false, forgot:false }

const MODULE_ROUTES = {
  master: '/master/',
  painel: '/painel/',
  vendedor: '/vendedor/',
  agenda: '/agenda/',
  material: '/material/',
  precificacao: '/precificacao/',
  catalogo: '/catalogo/',
  'itens-personalizacao': '/itens-personalizacao/',
  assinatura: '/assinatura/'
}

function $(id){ return document.getElementById(id) }

function showAlert(id, type, message){
  const box = $(id)
  if(!box) return
  box.className = 'alert show ' + type
  box.textContent = message || ''
}

function hideAlert(id){
  const box = $(id)
  if(!box) return
  box.className = 'alert'
  box.textContent = ''
}

function setLoading(buttonId, loading, label){
  const btn = $(buttonId)
  if(!btn) return
  btn.disabled = loading
  btn.innerHTML = loading ? '<span class="loading-spinner"></span>Aguarde...' : label
}

function clearAuthStorage(){
  if(window.ESTOFARIA_AUTH && typeof window.ESTOFARIA_AUTH.clearSession === 'function'){
    window.ESTOFARIA_AUTH.clearSession()
    return
  }
  localStorage.removeItem('auth_token')
  localStorage.removeItem('auth_user')
  localStorage.removeItem('token')
}

function safeJsonParse(raw){
  if(!raw) return null
  try { return JSON.parse(raw) } catch (_) { return null }
}

function getCompanyName(user, data){
  const topLevelCompany = data && data.company && typeof data.company === 'object'
    ? (data.company.name || data.company.company_name || data.company.business_name || '')
    : (data && typeof data.company === 'string' ? data.company : '')
  const userCompany = user && user.company && typeof user.company === 'object'
    ? (user.company.name || user.company.company_name || user.company.business_name || '')
    : (user && typeof user.company === 'string' ? user.company : '')
  return user?.empresa || user?.empresa_nome || user?.company_name || user?.business_name || user?.companyName || userCompany || topLevelCompany || data?.empresa || data?.company_name || data?.business_name || ''
}

function normalizeUserForStorage(user, data){
  const normalized = { ...(user || {}) }
  const companyName = getCompanyName(normalized, data || {})
  if(companyName){
    normalized.empresa = normalized.empresa || companyName
    normalized.company_name = normalized.company_name || companyName
    normalized.business_name = normalized.business_name || companyName
    normalized.company = typeof normalized.company === 'object'
      ? { ...(normalized.company || {}), name: normalized.company?.name || companyName }
      : (normalized.company || companyName)
  }
  return normalized
}

function normalizeAuthError(error, fallback){
  const message = String(error && error.message || '').trim()
  if(!message) return fallback
  const lower = message.toLowerCase()
  if(lower.includes('failed to fetch') || lower.includes('networkerror') || lower.includes('network error')){
    return 'Não foi possível conectar ao servidor agora. Verifique a API oficial e tente novamente.'
  }
  if(lower.includes('unauthorized') || lower.includes('não autorizado') || lower.includes('credenciais') || lower.includes('senha incorret') || lower.includes('e-mail ou senha')){
    return 'E-mail ou senha inválidos.'
  }
  return message
}

function toggleForgotPassword(show){
  const box = $('forgot-password-box')
  const input = $('forgot-email')
  if(!box) return
  box.hidden = !show
  if(show && input && !input.value){
    input.value = $('login-email')?.value?.trim() || ''
  }
  if(!show) hideAlert('forgot-alert')
}

function setTab(tab){
  document.querySelectorAll('[data-auth-tab]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.authTab === tab)
  })
  document.querySelectorAll('.form-section').forEach(section => {
    section.classList.toggle('active', section.dataset.section === tab)
  })
  hideAlert('login-alert')
  hideAlert('register-alert')
}

function togglePw(id, button){
  const input = $(id)
  if(!input) return
  const isPassword = input.type === 'password'
  input.type = isPassword ? 'text' : 'password'
  if(button){
    button.innerHTML = isPassword ? EYE_CLOSED_ICON : EYE_OPEN_ICON
    button.setAttribute('aria-label', isPassword ? 'Ocultar senha' : 'Mostrar senha')
    button.setAttribute('title', isPassword ? 'Ocultar senha' : 'Mostrar senha')
  }
}

function normalizeModuleName(value){
  const raw = String(value || '').trim().toLowerCase()
  const aliases = {
    master: 'master',
    admin_saas: 'master',
    saas_admin: 'master',
    superadmin: 'master',
    super_admin: 'master',
    dashboard:'painel',
    painel:'painel',
    material:'material',
    materiais:'material',
    pricing:'precificacao',
    precificacao:'precificacao',
    catalogo:'catalogo',
    personalizacao:'itens-personalizacao',
    'itens-personalizacao':'itens-personalizacao',
    vendedor:'vendedor',
    agenda:'agenda',
    assinatura:'assinatura',
    subscription:'assinatura'
  }
  return aliases[raw] || raw
}

function collectTokens(value, out){
  if(value == null) return
  if(Array.isArray(value)) return value.forEach(item => collectTokens(item, out))
  if(typeof value === 'object'){
    Object.entries(value).forEach(([key, enabled]) => { if(enabled) out.add(String(key).trim().toLowerCase()) })
    return
  }
  String(value).split(/[\s,;|]+/).map(part => part.trim().toLowerCase()).filter(Boolean).forEach(part => out.add(part))
}

function getTokens(user){
  const tokens = new Set()
  ;[
    user && user.role,
    user && user.user_role,
    user && user.company_role,
    user && user.permissions,
    user && user.modules,
    user && user.allowed_modules,
    user && user.allowed_tabs,
    user && user.permissions_map,
    user && user.access,
    user && user.claims && user.claims.permissions,
    user && user.claims && user.claims.modules,
    user && user.app_metadata && user.app_metadata.permissions,
    user && user.app_metadata && user.app_metadata.modules,
    user && user.app_metadata && user.app_metadata.roles
  ].forEach(value => collectTokens(value, tokens))
  return tokens
}

function hasMasterAccess(user, tokens = getTokens(user)){
  if(user && (user.is_superadmin || user.is_master || user.master_access || user.saas_admin)) return true
  if(user && user.app_metadata && (user.app_metadata.is_superadmin || user.app_metadata.is_master || user.app_metadata.saas_admin)) return true
  return Array.from(tokens).some(token => ['master','admin_saas','saas_admin','superadmin','super_admin','root','platform_admin'].includes(token) || token.startsWith('master.') || token.startsWith('saas.'))
}

function getAllowedModules(user){
  const tokens = getTokens(user)
  if(hasMasterAccess(user, tokens)) return Object.keys(MODULE_ROUTES)
  if(user && (user.is_admin || user.is_owner || user.full_access || user.all_access)) return Object.keys(MODULE_ROUTES).filter(code => code !== 'master')
  if(Array.from(tokens).some(token => ['owner','admin','empresa_owner','company_owner'].includes(token))) {
    return Object.keys(MODULE_ROUTES).filter(code => code !== 'master')
  }

  const explicit = [user && user.permissions, user && user.modules, user && user.allowed_modules, user && user.allowed_tabs, user && user.permissions_map].some(value => value && (Array.isArray(value) ? value.length : Object.keys(value).length))
  if(!explicit) return Object.keys(MODULE_ROUTES).filter(code => code !== 'master')

  const modules = new Set()
  tokens.forEach(token => {
    const normalized = normalizeModuleName(token)
    if(MODULE_ROUTES[normalized]) modules.add(normalized)
    if(token.includes('.') || token.includes(':')){
      const base = normalizeModuleName(token.split(/[.:]/)[0])
      if(MODULE_ROUTES[base]) modules.add(base)
    }
  })

  return modules.size ? Array.from(modules) : ['painel']
}

function getDefaultRoute(user){
  const allowed = getAllowedModules(user)
  const order = ['master','painel','vendedor','agenda','material','precificacao','catalogo','itens-personalizacao','assinatura']
  const first = order.find(code => allowed.includes(code)) || 'painel'
  return MODULE_ROUTES[first] || LOGIN_REDIRECT
}

function getRememberSessionChoice(){
  return true
}

function persistAuth(data, options = {}){
  const user = normalizeUserForStorage({ ...(data.user || {}) }, data || {})
  if(window.ESTOFARIA_AUTH && typeof window.ESTOFARIA_AUTH.setSession === 'function'){
    window.ESTOFARIA_AUTH.setSession({ token: data.token, user }, { remember: options.remember !== false })
  }else{
    localStorage.setItem('auth_token', data.token)
    localStorage.setItem('token', data.token)
    localStorage.setItem('auth_user', JSON.stringify(user))
  }
  return user
}

async function doLogin(){
  if(pendingActions.login) return
  hideAlert('login-alert')
  const email = $('login-email').value.trim()
  const password = $('login-password').value

  if(!email || !password){
    showAlert('login-alert', 'error', 'Preencha seu e-mail e sua senha para entrar.')
    return
  }

  pendingActions.login = true
  setLoading('btn-login', true, 'Entrar')
  try{
    const response = await fetch(API + '/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ email, password })
    })
    const data = await response.json().catch(() => ({}))
    if(!response.ok) throw new Error(data.error || data.message || 'Não foi possível entrar agora.')
    if(!data || !data.token || !data.user) throw new Error('Resposta de autenticação incompleta. Verifique o backend de login.')
    const authUser = persistAuth(data, { remember: getRememberSessionChoice() })
    showAlert('login-alert', 'success', 'Login realizado com sucesso. Abrindo seu ambiente...')
    window.location.replace(getDefaultRoute(authUser))
    return
  }catch(error){
    showAlert('login-alert', 'error', normalizeAuthError(error, 'Erro de conexão. Tente novamente.'))
  }finally{
    pendingActions.login = false
    setLoading('btn-login', false, 'Entrar')
  }
}

async function doForgotPassword(){
  if(pendingActions.forgot) return
  hideAlert('forgot-alert')
  const email = ($('forgot-email')?.value || $('login-email')?.value || '').trim()

  if(!email){
    showAlert('forgot-alert', 'error', 'Informe seu e-mail para receber as instruções.')
    return
  }

  pendingActions.forgot = true
  setLoading('btn-forgot-password', true, 'Enviar instruções')
  try{
    const candidates = ['/auth/forgot-password', '/auth/reset-password/request', '/auth/password/forgot']
    let lastError = null
    for(const path of candidates){
      try{
        const response = await fetch(API + path, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
          body: JSON.stringify({ email })
        })
        if(!response.ok){
          const data = await response.json().catch(() => ({}))
          throw new Error(data.error || 'Falha ao solicitar recuperação.')
        }
        showAlert('forgot-alert', 'success', 'Se este e-mail estiver cadastrado, enviaremos as instruções de redefinição de senha.')
        return
      }catch(error){
        lastError = error
      }
    }
    showAlert('forgot-alert', 'success', 'Se este e-mail estiver cadastrado, enviaremos as instruções de redefinição de senha. Se o backend ainda não estiver pronto, ative um endpoint de recuperação para concluir o fluxo.')
  }catch(error){
    showAlert('forgot-alert', 'error', error.message || 'Não foi possível iniciar a recuperação agora.')
  }finally{
    pendingActions.forgot = false
    setLoading('btn-forgot-password', false, 'Enviar instruções')
  }
}

async function doRegister(){
  if(pendingActions.register) return
  hideAlert('register-alert')
  const empresa = $('reg-empresa').value.trim()
  const nome = $('reg-nome').value.trim()
  const email = $('reg-email').value.trim()
  const password = $('reg-password').value
  const confirm = $('reg-password-confirm').value

  if(!empresa || !nome || !email || !password || !confirm){
    showAlert('register-alert', 'error', 'Preencha todos os campos para criar sua conta.')
    return
  }
  if(password.length < 6){
    showAlert('register-alert', 'error', 'A senha deve ter pelo menos 6 caracteres.')
    return
  }
  if(password !== confirm){
    showAlert('register-alert', 'error', 'A confirmação de senha não confere.')
    return
  }

  pendingActions.register = true
  setLoading('btn-register', true, 'Criar conta')
  try{
    const response = await fetch(API + '/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ empresa, nome, email, password })
    })
    const data = await response.json().catch(() => ({}))
    if(!response.ok) throw new Error(data.error || data.message || 'Não foi possível criar sua conta agora.')
    if(!data || !data.token || !data.user) throw new Error('Resposta de cadastro incompleta. Verifique o backend de registro.')
    const authUser = persistAuth(data, { remember: true })
    showAlert('register-alert', 'success', 'Conta criada com sucesso. Abrindo seu painel...')
    window.location.replace(getDefaultRoute(authUser || {}))
    return
  }catch(error){
    showAlert('register-alert', 'error', normalizeAuthError(error, 'Erro de conexão. Tente novamente.'))
  }finally{
    pendingActions.register = false
    setLoading('btn-register', false, 'Criar conta')
  }
}

async function bootstrap(){
  const auth = window.ESTOFARIA_AUTH || null
  const token = auth && typeof auth.getToken === 'function'
    ? auth.getToken()
    : (localStorage.getItem('auth_token') || localStorage.getItem('token') || '')
  if(!token) return
  const cachedUser = auth && typeof auth.getUser === 'function'
    ? auth.getUser()
    : (safeJsonParse(localStorage.getItem('auth_user')) || {})
  if(cachedUser && Object.keys(cachedUser).length){
    window.location.replace(getDefaultRoute(cachedUser))
    return
  }
  try{
    const response = await fetch(API + '/auth/me', {
      headers: { Accept:'application/json', Authorization: 'Bearer ' + token }
    })
    if(!response.ok) throw new Error('unauthorized')
    const data = await response.json().catch(() => ({}))
    const user = normalizeUserForStorage({ ...((data && (data.user || data)) || {}) }, data || {})
    if(auth && typeof auth.updateUser === 'function') auth.updateUser(user || {})
    else localStorage.setItem('auth_user', JSON.stringify(user || {}))
    window.location.replace(getDefaultRoute(user || {}))
  }catch(_){
    clearAuthStorage()
  }
}

document.addEventListener('DOMContentLoaded', () => {
  bootstrap()
  document.querySelectorAll('[data-auth-tab]').forEach(btn => {
    btn.addEventListener('click', () => setTab(btn.dataset.authTab))
  })
  document.querySelectorAll('[data-toggle-password]').forEach(button => {
    button.innerHTML = EYE_OPEN_ICON
    button.setAttribute('aria-label', 'Mostrar senha')
    button.setAttribute('title', 'Mostrar senha')
    button.addEventListener('click', () => togglePw(button.dataset.togglePassword, button))
  })
  $('btn-login')?.addEventListener('click', doLogin)
  $('btn-register')?.addEventListener('click', doRegister)
  $('forgot-password-link')?.addEventListener('click', () => toggleForgotPassword(true))
  $('forgot-password-close')?.addEventListener('click', () => toggleForgotPassword(false))
  $('btn-forgot-password')?.addEventListener('click', doForgotPassword)
  document.addEventListener('keydown', event => {
    if(event.key !== 'Enter') return
    const target = event.target
    if(target && ['TEXTAREA', 'BUTTON'].includes(target.tagName)) return
    const forgotBoxVisible = !$('forgot-password-box')?.hidden
    if(forgotBoxVisible && (target?.id === 'forgot-email' || target?.closest?.('#forgot-password-box'))){
      event.preventDefault()
      doForgotPassword()
      return
    }
    const activeSection = document.querySelector('.form-section.active')?.dataset.section
    if(activeSection === 'login'){
      event.preventDefault()
      doLogin()
      return
    }
    if(activeSection === 'register'){
      event.preventDefault()
      doRegister()
    }
  })
})
