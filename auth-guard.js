(function(){
  const LOGIN_PATH = '/login/'
  const base = String(window.API_BASE || '').replace(/\/+$/, '')
  const pathname = window.location.pathname || '/'
  const authStore = window.ESTOFARIA_AUTH || null
  const token = (function(){
    try {
      if(authStore && typeof authStore.getToken === 'function') return authStore.getToken()
      return localStorage.getItem('auth_token') || localStorage.getItem('token') || ''
    } catch (_) {
      return ''
    }
  })()

  const MODULE_ROUTES = {
    master: '/master/',
    painel: '/painel/',
    material: '/material/',
    precificacao: '/precificacao/',
    catalogo: '/catalogo/',
    'itens-personalizacao': '/itens-personalizacao/',
    vendedor: '/vendedor/',
    agenda: '/agenda/',
    configuracao: '/configuracao/',
    assinatura: '/assinatura/'
  }

  const ROLE_MODULE_PRESETS = {
    admin: Object.keys(MODULE_ROUTES).filter(code => code !== 'master'),
    owner: Object.keys(MODULE_ROUTES).filter(code => code !== 'master'),
    vendedor: ['vendedor'],
    operacional: ['painel', 'agenda'],
    financeiro: ['painel', 'assinatura'],
    custom: []
  }

  const PATH_MODULES = [
    ['/master/', 'master'],
    ['/painel/', 'painel'],
    ['/material/', 'material'],
    ['/precificacao/', 'precificacao'],
    ['/catalogo/', 'catalogo'],
    ['/itens-personalizacao/', 'itens-personalizacao'],
    ['/vendedor/', 'vendedor'],
    ['/agenda/', 'agenda'],
    ['/configuracao/', 'configuracao'],
    ['/assinatura/', 'assinatura']
  ]

  function goLogin(){
    window.location.href = LOGIN_PATH
  }

  function logout(){
    try {
      if(authStore && typeof authStore.clearSession === 'function') authStore.clearSession()
      else {
        localStorage.removeItem('auth_token')
        localStorage.removeItem('auth_user')
        localStorage.removeItem('token')
      }
    } catch (_) {}
    goLogin()
  }

  function safeJsonParse(raw){
    if(!raw) return null
    try { return JSON.parse(raw) } catch (_) { return null }
  }

  function readStoredUser(){
    try {
      if(authStore && typeof authStore.getUser === 'function'){
        return authStore.getUser() || {}
      }
      return safeJsonParse(localStorage.getItem('auth_user')) || {}
    } catch (_) {
      return {}
    }
  }

  function hasUserData(user){
    return !!(user && typeof user === 'object' && Object.keys(user).length)
  }

  function getNestedCompanyName(user){
    if(!user || typeof user !== 'object') return ''
    if(user.company && typeof user.company === 'object'){
      return user.company.name || user.company.company_name || user.company.business_name || user.company.display_name || ''
    }
    return typeof user.company === 'string' ? user.company : ''
  }

  function mergeUserData(primary, secondary){
    const baseUser = hasUserData(primary) ? { ...primary } : {}
    const nextUser = hasUserData(secondary) ? { ...secondary } : {}
    const merged = { ...baseUser, ...nextUser }
    const companyName = nextUser.empresa || nextUser.empresa_nome || nextUser.company_name || nextUser.business_name || nextUser.companyName || getNestedCompanyName(nextUser) || baseUser.empresa || baseUser.empresa_nome || baseUser.company_name || baseUser.business_name || baseUser.companyName || getNestedCompanyName(baseUser) || ''
    if(companyName){
      merged.empresa = merged.empresa || companyName
      merged.company_name = merged.company_name || companyName
      merged.business_name = merged.business_name || companyName
      merged.company = typeof merged.company === 'object'
        ? { ...(merged.company || {}), name: merged.company.name || companyName }
        : (merged.company || companyName)
    }
    return merged
  }

  function normalizeModuleName(value){
    const raw = String(value || '').trim().toLowerCase()
    const aliases = {
      master: 'master',
      admin: 'master',
      admin_saas: 'master',
      saas_admin: 'master',
      superadmin: 'master',
      super_admin: 'master',
      owner_master: 'master',
      dashboard: 'painel',
      painel: 'painel',
      materials: 'material',
      material: 'material',
      materiais: 'material',
      pricing: 'precificacao',
      precificacao: 'precificacao',
      catálogo: 'catalogo',
      catalogo: 'catalogo',
      personalization: 'itens-personalizacao',
      personalizacao: 'itens-personalizacao',
      'itens-personalizacao': 'itens-personalizacao',
      itens_personalizacao: 'itens-personalizacao',
      itens: 'itens-personalizacao',
      sales: 'vendedor',
      seller: 'vendedor',
      vendedor: 'vendedor',
      agenda: 'agenda',
      subscription: 'assinatura',
      assinatura: 'assinatura',
      billing: 'assinatura',
      configuracao: 'configuracao'
    }
    return aliases[raw] || raw
  }

  function collectTokensFromValue(value, out){
    if(value == null) return
    if(Array.isArray(value)){
      value.forEach(item => collectTokensFromValue(item, out))
      return
    }
    if(typeof value === 'object'){
      Object.entries(value).forEach(([key, enabled]) => {
        if(enabled) out.add(String(key).trim().toLowerCase())
      })
      return
    }
    String(value)
      .split(/[\s,;|]+/)
      .map(part => part.trim().toLowerCase())
      .filter(Boolean)
      .forEach(part => out.add(part))
  }

  function getPermissionTokens(user){
    const out = new Set()
    if(!user || typeof user !== 'object') return out

    ;[
      user.role,
      user.user_role,
      user.company_role,
      user.profile_role,
      user.permission,
      user.permissions,
      user.allowed_modules,
      user.allowed_tabs,
      user.modules,
      user.tabs,
      user.scopes,
      user.permissions_map,
      user.module_permissions,
      user.access,
      user.access_modules,
      user.access_tabs,
      user.menu,
      user.features,
      user.claims && user.claims.permissions,
      user.claims && user.claims.modules,
      user.claims && user.claims.allowed_modules,
      user.app_metadata && user.app_metadata.permissions,
      user.app_metadata && user.app_metadata.modules,
      user.app_metadata && user.app_metadata.allowed_modules,
      user.app_metadata && user.app_metadata.roles,
      user.user_metadata && user.user_metadata.roles
    ].forEach(value => collectTokensFromValue(value, out))

    return out
  }

  function hasMasterAccess(user, tokens){
    if(!user || typeof user !== 'object') return false
    if(user.is_superadmin || user.is_master || user.master_access || user.saas_admin) return true
    if(user.app_metadata && (user.app_metadata.is_superadmin || user.app_metadata.is_master || user.app_metadata.saas_admin)) return true
    const masterTokens = ['master','admin_saas','saas_admin','superadmin','super_admin','owner_master','root','platform_admin']
    return Array.from(tokens).some(token => masterTokens.includes(token) || token.startsWith('master.') || token.startsWith('saas.'))
  }

  function hasAllBusinessAccess(user, tokens){
    if(!user || typeof user !== 'object') return false
    if(user.is_admin || user.is_owner || user.full_access || user.all_access) return true
    const elevated = ['owner','admin','empresa_owner','company_owner','manager']
    return Array.from(tokens).some(token => elevated.includes(token))
  }

  function getRolePreset(user){
    const aliases = {
      administrador: 'admin',
      administrator: 'admin',
      admin: 'admin',
      owner: 'owner',
      proprietario: 'owner',
      proprietário: 'owner',
      company_owner: 'owner',
      empresa_owner: 'owner',
      vendedor: 'vendedor',
      seller: 'vendedor',
      sales: 'vendedor',
      operacional: 'operacional',
      operations: 'operacional',
      financeiro: 'financeiro',
      finance: 'financeiro',
      billing: 'financeiro',
      custom: 'custom',
      personalizado: 'custom'
    }
    const values = [
      user && user.company_role,
      user && user.role,
      user && user.user_role,
      user && user.profile_role,
      user && user.profile,
      user && user.perfil,
      user && user.access_level
    ]
    for(const value of values){
      const normalized = aliases[String(value || '').trim().toLowerCase()] || ''
      if(normalized) return normalized
    }
    return ''
  }

  function isStrictPermissionMode(user){
    if(!user || typeof user !== 'object') return false
    const company = user.company && typeof user.company === 'object' ? user.company : {}
    const subscription = user.subscription && typeof user.subscription === 'object' ? user.subscription : {}
    const appMetadata = user.app_metadata && typeof user.app_metadata === 'object' ? user.app_metadata : {}
    return Boolean(
      user.enforce_permissions ||
      user.permissions_strict ||
      user.strict_permissions ||
      company.enforce_permissions ||
      company.permissions_strict ||
      subscription.enforce_permissions ||
      subscription.permissions_strict ||
      appMetadata.enforce_permissions ||
      appMetadata.permissions_strict
    )
  }

  function getRolePresetModules(user){
    const preset = getRolePreset(user)
    if(!preset) return null
    return new Set((ROLE_MODULE_PRESETS[preset] || []).map(normalizeModuleName).filter(code => MODULE_ROUTES[code]))
  }

  function hasAnyToken(tokens, checks){
    return checks.some(check => Array.from(tokens).some(token => token === check || token.startsWith(check + '.') || token.startsWith(check + ':')))
  }

  function canManageTeam(user){
    const tokens = getPermissionTokens(user)
    if(hasMasterAccess(user, tokens) || hasAllBusinessAccess(user, tokens)) return true
    return hasAnyToken(tokens, ['team_admin', 'team.manage', 'users.manage', 'equipe.manage', 'team.users.manage'])
  }

  function canManageBilling(user){
    const tokens = getPermissionTokens(user)
    if(hasMasterAccess(user, tokens)) return true
    return hasAnyToken(tokens, ['billing_admin', 'billing.manage', 'subscription.manage', 'assinatura.manage', 'finance_admin'])
  }

  function extractAllowedModules(user){
    const tokens = getPermissionTokens(user)
    if(hasAllBusinessAccess(user, tokens)) return null

    const explicitSources = [
      user && user.permissions,
      user && user.allowed_modules,
      user && user.allowed_tabs,
      user && user.modules,
      user && user.module_permissions,
      user && user.permissions_map,
      user && user.claims && (user.claims.permissions || user.claims.modules),
      user && user.app_metadata && (user.app_metadata.permissions || user.app_metadata.modules)
    ]
    const hasExplicitAccessModel = explicitSources.some(value => value && (Array.isArray(value) ? value.length : Object.keys(value).length))
    if(!hasExplicitAccessModel){
      const presetModules = getRolePresetModules(user)
      if(presetModules) return presetModules
      if(isStrictPermissionMode(user)) return new Set(['assinatura'])
      return null
    }

    const modules = new Set()
    tokens.forEach(token => {
      const normalized = normalizeModuleName(token)
      if(MODULE_ROUTES[normalized]) modules.add(normalized)
      if(token.includes('.') || token.includes(':')){
        const baseName = normalizeModuleName(token.split(/[.:]/)[0])
        if(MODULE_ROUTES[baseName]) modules.add(baseName)
      }
    })
    if(!modules.size && isStrictPermissionMode(user)) return new Set(['assinatura'])
    return modules
  }

  function parseDateSafe(value){
    if(!value) return null
    const s = String(value)
    const date = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(s + 'T00:00:00') : new Date(s)
    return Number.isNaN(date.getTime()) ? null : date
  }

  function getSubscriptionSnapshot(user){
    const subscription = user && typeof user.subscription === 'object' ? user.subscription : {}
    const company = user && user.company && typeof user.company === 'object' ? user.company : {}
    const billing = user && user.billing && typeof user.billing === 'object' ? user.billing : {}

    const financialStatus = String(
      subscription.financial_status || subscription.status || billing.financial_status || billing.status || user.financial_status || user.subscription_status || user.billing_status || ''
    ).trim().toLowerCase()

    const accessStatus = String(
      subscription.access_status || company.access_status || billing.access_status || user.access_status || user.account_status || user.company_status || ''
    ).trim().toLowerCase()

    const trialEndsAt = subscription.trial_ends_at || billing.trial_ends_at || user.trial_ends_at || user.trial_end_at || ''
    const courtesyUntil = subscription.courtesy_until || billing.courtesy_until || user.courtesy_until || ''
    const graceUntil = subscription.manual_grace_until || subscription.grace_until || billing.manual_grace_until || user.manual_grace_until || user.grace_until || user.free_until || ''

    return {
      financialStatus,
      accessStatus,
      trialEndsAt,
      courtesyUntil,
      graceUntil,
      planCode: subscription.plan_code || user.plan_code || '',
      planName: subscription.plan_name || user.plan_name || ''
    }
  }

  function getCommercialAccess(user){
    const snapshot = getSubscriptionSnapshot(user)
    const now = new Date()
    const trialActive = parseDateSafe(snapshot.trialEndsAt)
    const courtesyActive = parseDateSafe(snapshot.courtesyUntil)
    const graceActive = parseDateSafe(snapshot.graceUntil)

    if(trialActive && trialActive.getTime() >= now.getTime()){
      return { blocked:false, reason:'trial_active', snapshot }
    }
    if(courtesyActive && courtesyActive.getTime() >= now.getTime()){
      return { blocked:false, reason:'courtesy_active', snapshot }
    }
    if(graceActive && graceActive.getTime() >= now.getTime()){
      return { blocked:false, reason:'manual_grace', snapshot }
    }

    const blockingFinancial = ['past_due','unpaid','blocked','canceled','cancelled','inactive','suspended','expired','overdue','delinquent','payment_failed']
    const blockingAccess = ['blocked','inactive','suspended','disabled','canceled','cancelled','expired']

    if(blockingAccess.includes(snapshot.accessStatus)){
      return { blocked:true, reason:snapshot.accessStatus || 'blocked', snapshot }
    }
    if(blockingFinancial.includes(snapshot.financialStatus)){
      return { blocked:true, reason:snapshot.financialStatus || 'past_due', snapshot }
    }
    return { blocked:false, reason:'active', snapshot }
  }

  function canAccessModule(user, moduleCode){
    const normalized = normalizeModuleName(moduleCode)
    const tokens = getPermissionTokens(user)
    if(normalized === 'master') return hasMasterAccess(user, tokens)
    if(hasMasterAccess(user, tokens)) return true

    const commercial = getCommercialAccess(user)
    if(commercial.blocked && !['assinatura'].includes(normalized)) return false

    const allowed = extractAllowedModules(user)
    if(!allowed) return true
    return allowed.has(normalized)
  }

  function resolveModuleFromPath(path){
    const hit = PATH_MODULES.find(([prefix]) => path.indexOf(prefix) === 0)
    return hit ? hit[1] : null
  }

  function resolveDefaultRoute(user){
    const commercial = getCommercialAccess(user)
    if(commercial.blocked && !hasMasterAccess(user, getPermissionTokens(user))){
      return MODULE_ROUTES.assinatura || '/assinatura/'
    }
    const order = ['master','painel','vendedor','agenda','material','precificacao','catalogo','itens-personalizacao','assinatura']
    const first = order.find(code => canAccessModule(user, code))
    return MODULE_ROUTES[first || 'painel'] || '/painel/'
  }

  function installFetchInterceptor(){
    if(!token || window.__estofariaAuthFetchInstalled) return
    const rawFetch = window.fetch.bind(window)
    window.fetch = function(input, init){
      try {
        const url = typeof input === 'string' ? input : (input && input.url) || ''
        const isApi = url.indexOf('/api/') >= 0 || (base && url.indexOf(base + '/api/') === 0)
        if(isApi){
          init = init || {}
          init.headers = new Headers(init.headers || {})
          if(!init.headers.get('Authorization')) init.headers.set('Authorization', 'Bearer ' + token)
          if(!init.headers.get('Accept')) init.headers.set('Accept', 'application/json')
        }
      } catch (_) {}
      return rawFetch(input, init)
    }
    window.__estofariaAuthFetchInstalled = true
  }

  function injectAuthStyles(){
    if(document.getElementById('estofaria-auth-style')) return
    const style = document.createElement('style')
    style.id = 'estofaria-auth-style'
    style.textContent = `
      html[data-auth-pending="1"] body{visibility:hidden;}
      .header{
        gap:6px !important;
        align-items:flex-start !important;
        flex-wrap:wrap;
        padding:8px 16px 6px !important;
        background:linear-gradient(135deg,#223a74 0%,#3359a8 58%,#7394e8 100%) !important;
        box-shadow:0 16px 34px rgba(18,34,72,.26);
        border-bottom:1px solid rgba(255,255,255,.10);
      }
      .header > :first-child{
        flex:1 1 100%;
        font-weight:800;
        font-size:16px;
        letter-spacing:-.02em;
        line-height:1.1;
      }
      .auth-shell{
        display:block;
        width:100%;
        margin-left:0;
      }
      .auth-company{
        display:flex;
        flex-direction:column;
        align-items:flex-start;
        gap:2px;
        width:100%;
        min-width:0;
        padding:0;
        border-radius:0;
        background:transparent;
        border:0;
        box-shadow:none;
        line-height:1.05;
      }
      .auth-company-bottom{
        display:flex;
        align-items:center;
        justify-content:space-between;
        gap:10px;
        width:100%;
        min-width:0;
      }
      .auth-company strong{
        flex:1 1 auto;
        min-width:0;
        font-size:14px;
        font-weight:700;
        color:#fff;
        overflow:hidden;
        text-overflow:ellipsis;
        white-space:nowrap;
        line-height:1.12;
      }
      .auth-company-actions{
        display:flex;
        align-items:center;
        gap:8px;
        flex:0 0 auto;
      }
      .auth-kicker,
      .auth-company small{display:none !important;}
      #time{
        margin:0;
        display:inline-flex;
        align-items:center;
        justify-content:center;
        padding:0;
        border:0;
        border-radius:0;
        background:transparent;
        box-shadow:none;
        font-size:11px;
        white-space:nowrap;
        line-height:1;
        color:rgba(255,255,255,.92);
      }
      .auth-logout{
        border:none;
        border-radius:999px;
        min-height:32px;
        padding:6px 12px;
        font-size:12px;
        font-weight:800;
        cursor:pointer;
        background:rgba(255,255,255,.15);
        color:#fff;
        border:1px solid rgba(255,255,255,.18);
        box-shadow:0 6px 14px rgba(10,23,52,.12);
        transition:transform .22s ease, box-shadow .22s ease, background-color .22s ease, border-color .22s ease;
        white-space:nowrap;
        line-height:1;
      }
      .auth-logout:hover{background:rgba(255,255,255,.22);transform:translateY(-1px);box-shadow:0 10px 18px rgba(10,23,52,.16);}
      .auth-logout:active{transform:translateY(0) scale(.985);}
      .auth-logout:focus-visible{outline:none;box-shadow:0 0 0 3px rgba(255,255,255,.22),0 10px 18px rgba(10,23,52,.16);}
      .nav .btn[data-hidden-by-auth="1"], .nav .nav-btn[data-hidden-by-auth="1"]{display:none !important;}
      .auth-status-chip{
        display:inline-flex;
        align-items:center;
        justify-content:center;
        min-height:28px;
        padding:5px 10px;
        border-radius:999px;
        font-size:11px;
        font-weight:800;
        letter-spacing:.01em;
        white-space:nowrap;
        background:rgba(255,255,255,.14);
        color:#fff;
        border:1px solid rgba(255,255,255,.18);
      }
      .auth-status-chip.is-alert{
        background:#fff1f2;
        color:#9f1239;
        border-color:#fecdd3;
      }
      @media (max-width: 780px){
        .header{
          padding:8px 14px 6px !important;
        }
        .auth-company strong{
          font-size:13px;
        }
        .auth-company-bottom{
          gap:6px;
          align-items:flex-start;
          flex-wrap:wrap;
        }
        .auth-company-actions{
          gap:6px;
          width:100%;
          justify-content:flex-end;
        }
        .auth-logout{
          min-height:30px;
          padding:6px 10px;
          font-size:11px;
        }
        #time{
          font-size:10.5px;
        }
      }
      @media (max-width: 420px){
        .auth-company strong{font-size:12.5px;}
        #time{font-size:10px;}
        .auth-logout{font-size:10.5px;padding:6px 9px;}
      }
    `
    document.head.appendChild(style)
  }

  function getUserLabel(user){
    const name = user.nome || user.name || user.full_name || user.username || user.login || user.email || 'Usuário'
    const role = user.company_role || user.role || user.user_role || user.access_level || user.profile || user.perfil || user.tipo_usuario || ''
    return { name, role }
  }

  function getRawCompanyLabel(user){
    const nestedCompany = user && user.company && typeof user.company === 'object'
      ? (user.company.name || user.company.company_name || user.company.business_name || user.company.display_name || '')
      : ''
    return (user && (user.empresa || user.empresa_nome || user.company_name || user.business_name || user.companyName || nestedCompany || (typeof user.company === 'string' ? user.company : '') || user.business || user.store_name || user.tenant_name)) || ''
  }

  function getCompanyLabel(user){
    return getRawCompanyLabel(user) || 'Estofaria Digital'
  }

  function getAccessLabel(user, info){
    if(user && (user.is_superadmin || user.is_master || user.master_access || user.saas_admin)) return 'master'
    const role = String(info.role || user.access || user.access_label || user.user_type || user.tipo || '').trim().toLowerCase()
    if(['platform_admin','superadmin','saas_admin','admin_saas'].includes(role)) return 'master'
    return role || 'usuário'
  }

  function ensureMasterNav(user){
    const nav = document.querySelector('.nav')
    if(!nav) return
    const existing = nav.querySelector('a[href*="/master/"]')
    if(canAccessModule(user, 'master')){
      if(existing) return
      const link = document.createElement('a')
      link.className = 'btn auth-master-link'
      link.setAttribute('data-module', 'master')
      link.href = pathname.indexOf('/master/') === 0 ? '../master/' : (pathname.indexOf('/login/') === 0 ? '/master/' : '../master/')
      link.textContent = '👑 Master'
      nav.appendChild(link)
      return
    }
    if(existing) existing.setAttribute('data-hidden-by-auth', '1')
  }

  let topLayoutSyncBound = false

  function syncTopLayout(){
    const header = document.querySelector('.header')
    const nav = document.querySelector('.nav')
    if(!header || !nav) return
    requestAnimationFrame(() => {
      const headerHeight = Math.max(Math.ceil(header.getBoundingClientRect().height || 0), header.offsetHeight || 0, 64)
      nav.style.marginTop = (headerHeight + 8) + 'px'
      nav.style.paddingLeft = '12px'
      nav.style.paddingRight = '12px'
    })
  }

  function bindTopLayoutSync(){
    if(topLayoutSyncBound) return
    topLayoutSyncBound = true
    window.addEventListener('resize', syncTopLayout)
    window.addEventListener('orientationchange', syncTopLayout)
    window.addEventListener('load', syncTopLayout)
  }

  function enhanceShell(user){
    injectAuthStyles()
    const header = document.querySelector('.header')
    if(header){
      const info = getUserLabel(user)
      const companyLabel = getCompanyLabel(user)
      const accessLabel = getAccessLabel(user, info)
      const commercial = getCommercialAccess(user)
      let shell = header.querySelector('.auth-shell')
      if(!shell){
        shell = document.createElement('div')
        shell.className = 'auth-shell'
        header.appendChild(shell)
      }
      shell.innerHTML = `
        <div class="auth-company">
          <div class="auth-company-bottom">
            <strong>${escapeHtml(companyLabel)}${accessLabel ? ' · ' + escapeHtml(accessLabel) : ''}</strong>
            <div class="auth-company-actions"></div>
          </div>
        </div>
      `
      const timeEl = header.querySelector('#time')
      const actions = shell.querySelector('.auth-company-actions')
      const logoutBtn = document.createElement('button')
      logoutBtn.type = 'button'
      logoutBtn.className = 'auth-logout'
      logoutBtn.textContent = 'Sair'
      if(actions){
        if(commercial.blocked){
          const statusChip = document.createElement('span')
          statusChip.className = 'auth-status-chip is-alert'
          statusChip.textContent = 'Assinatura pendente'
          actions.appendChild(statusChip)
        }
        if(timeEl) actions.appendChild(timeEl)
        actions.appendChild(logoutBtn)
      }
      logoutBtn.addEventListener('click', logout)
    }

    ensureMasterNav(user)

    document.querySelectorAll('.nav a[href]').forEach(link => {
      const href = link.getAttribute('href') || ''
      const moduleCode = resolveModuleFromPath(href.replace('..', ''))
      if(moduleCode && !canAccessModule(user, moduleCode)) {
        link.setAttribute('data-hidden-by-auth', '1')
      } else {
        link.removeAttribute('data-hidden-by-auth')
      }
    })
  }

  function escapeHtml(value){
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
  }

  async function enrichUserCompanyFromTeam(user){
    if(getRawCompanyLabel(user)) return user || {}
    try {
      const res = await fetch(base + '/api/auth/team', {
        headers: {
          Accept: 'application/json',
          Authorization: 'Bearer ' + token
        }
      })
      if(!res.ok) return user || {}
      const data = await res.json().catch(() => ({}))
      const companyName = (data && data.company && (data.company.name || data.company.company_name || data.company.business_name)) || data.company_name || data.business_name || data.empresa || ''
      if(!companyName) return user || {}
      const merged = mergeUserData(user, {
        empresa: companyName,
        company_name: companyName,
        business_name: companyName,
        company: { ...(user && typeof user.company === 'object' ? user.company : {}), name: companyName }
      })
      try {
        if(authStore && typeof authStore.updateUser === 'function') authStore.updateUser(merged || {})
        else localStorage.setItem('auth_user', JSON.stringify(merged || {}))
      } catch (_) {}
      return merged
    } catch (_) {
      return user || {}
    }
  }

  function primeShellFromCache(){
    const cachedUser = readStoredUser()
    if(!hasUserData(cachedUser)) return false
    document.documentElement.setAttribute('data-auth-ok', '1')
    document.documentElement.removeAttribute('data-auth-pending')
    bindTopLayoutSync()
    enhanceShell(cachedUser)
    syncTopLayout()
    setTimeout(syncTopLayout, 50)
    return true
  }

  function finalize(user){
    const commercial = getCommercialAccess(user)
    window.EstofariaAuth = {
      user,
      logout,
      commercial,
      canAccessModule: function(moduleCode){ return canAccessModule(user, moduleCode) },
      canAccessMaster: function(){ return canAccessModule(user, 'master') },
      canManageBilling: function(){ return canManageBilling(user) },
      canManageTeam: function(){ return canManageTeam(user) },
      isStrictPermissions: function(){ return isStrictPermissionMode(user) },
      getDefaultRoute: function(){ return resolveDefaultRoute(user) },
      getAllowedModules: function(){
        const allowed = extractAllowedModules(user)
        if(canAccessModule(user, 'master')){
          return ['master'].concat(allowed ? Array.from(allowed) : Object.keys(MODULE_ROUTES).filter(code => code !== 'master'))
        }
        return allowed ? Array.from(allowed) : Object.keys(MODULE_ROUTES).filter(code => code !== 'master')
      }
    }

    const currentModule = resolveModuleFromPath(pathname)
    if(currentModule && !canAccessModule(user, currentModule)){
      const target = resolveDefaultRoute(user)
      if(currentModule !== 'assinatura' && target.indexOf('/assinatura/') === 0){
        const reason = encodeURIComponent(commercial.reason || 'blocked')
        window.location.href = `${target}${target.includes('?') ? '&' : '?'}motivo=${reason}`
        return
      }
      window.location.href = target
      return
    }

    document.documentElement.setAttribute('data-auth-ok', '1')
    document.documentElement.removeAttribute('data-auth-pending')
    bindTopLayoutSync()
    enhanceShell(user)
    syncTopLayout()
    setTimeout(syncTopLayout, 80)
    setTimeout(syncTopLayout, 260)
    window.dispatchEvent(new CustomEvent('estofaria-auth-ready', { detail: { user } }))
  }

  if(!token){
    goLogin()
    return
  }

  const hasPrimedShell = primeShellFromCache()
  if(!hasPrimedShell){
    document.documentElement.setAttribute('data-auth-pending', '1')
  }
  installFetchInterceptor()

  ;(async function(){
    try {
      const res = await fetch(base + '/api/auth/me', {
        headers: {
          Accept: 'application/json',
          Authorization: 'Bearer ' + token
        }
      })
      if(!res.ok) throw new Error('unauthorized')
      const data = await res.json().catch(() => ({}))
      let user = mergeUserData(readStoredUser(), { ...((data && (data.user || data.data || data)) || {}) })
      user = await enrichUserCompanyFromTeam(user || {})
      try {
        if(authStore && typeof authStore.updateUser === 'function') authStore.updateUser(user || {})
        else localStorage.setItem('auth_user', JSON.stringify(user || {}))
      } catch (_) {}
      finalize(user || {})
    } catch (_) {
      logout()
    }
  })()
})()
