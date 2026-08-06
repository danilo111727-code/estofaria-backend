const API = (window.API_BASE || '') + '/api'
const MASTER_LOGS_KEY = 'estofaria_master_logs_v1'
const qs = new URLSearchParams(window.location.search)
const allowDemoMode = qs.get('demo') === '1'
const REAL_ENDPOINTS = ['/admin/companies', '/master/companies', '/saas/companies', '/subscription/admin/companies']
const state = {
  companies: [],
  filtered: [],
  selectedId: null,
  source: 'api'
}

const STATUS_LABELS = {
  stripe: 'Pago',
  courtesy: 'Cortesia',
  trial: 'Trial',
  manual: 'Manual',
  active: 'Ativo',
  blocked: 'Bloqueado',
  manual_grace: 'Liberação manual',
  courtesy_active: 'Cortesia ativa',
  trial_active: 'Trial ativo',
  past_due: 'Atrasado',
  unpaid: 'Inadimplente',
  canceled: 'Cancelado',
  trialing: 'Em teste'
}

function $(id){ return document.getElementById(id) }

function getToken(){
  try { return localStorage.getItem('auth_token') || localStorage.getItem('token') || '' } catch (_) { return '' }
}

function authHeaders(extra = {}){
  const headers = { Accept:'application/json', ...extra }
  const token = getToken()
  if(token) headers.Authorization = 'Bearer ' + token
  return headers
}

function brl(cents){
  return (Number(cents || 0) / 100).toLocaleString('pt-BR', { style:'currency', currency:'BRL' })
}

function escapeHtml(v){
  return String(v ?? '')
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#39;')
}

function formatDateTime(value){
  if(!value) return '—'
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('pt-BR')
}

function formatDate(value){
  if(!value) return '—'
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('pt-BR')
}

function todayPlus(days){
  const date = new Date()
  date.setDate(date.getDate() + days)
  return date.toISOString().slice(0, 10)
}

function getModeLabel(){
  return allowDemoMode ? 'API real · demo técnico oculto' : 'API real'
}

function normalizeModules(value){
  if(!value) return []
  if(Array.isArray(value)) return value.filter(Boolean)
  if(typeof value === 'string') return value.split(/[\s,;|]+/).map(v => v.trim()).filter(Boolean)
  if(typeof value === 'object') return Object.keys(value).filter(key => value[key])
  return []
}

function planTemplate(planCode){
  const code = String(planCode || 'gestao').toLowerCase()
  if(code.includes('empresarial')) return { code:'empresarial', name:'Plano Empresarial', seats_limit:null, monthly_price_cents:53900 }
  return { code:'gestao', name:'Plano Gestão', seats_limit:2, monthly_price_cents:8990 }
}

function normalizeCompany(item){
  const plan = planTemplate(item.plan_code || item.plan || item.plan_name)
  return {
    id: item.id || item.company_id || item.slug || item.email || Math.random().toString(36).slice(2),
    name: item.name || item.company_name || item.business_name || item.empresa || 'Empresa sem nome',
    owner_name: item.owner_name || item.responsavel || item.contact_name || 'Responsável não informado',
    owner_email: item.owner_email || item.email || item.contact_email || '—',
    owner_phone: item.owner_phone || item.whatsapp || item.phone || '',
    plan_code: plan.code,
    plan_name: item.plan_name || plan.name,
    billing_mode: String(item.billing_mode || item.payment_provider || item.subscription_source || 'stripe').toLowerCase(),
    financial_status: String(item.financial_status || item.subscription_status || item.status || 'active').toLowerCase(),
    access_status: String(item.access_status || item.access || item.account_status || 'active').toLowerCase(),
    seats_limit: item.seats_limit == null ? plan.seats_limit : item.seats_limit,
    seats_used: Number(item.seats_used || item.users_count || item.active_users || 1),
    next_charge_at: item.next_charge_at || item.current_period_end || '',
    last_payment_at: item.last_payment_at || item.last_paid_at || '',
    courtesy_until: item.courtesy_until || '',
    manual_grace_until: item.manual_grace_until || item.free_until || '',
    trial_ends_at: item.trial_ends_at || '',
    notes: item.notes || item.internal_note || '',
    monthly_price_cents: Number(item.monthly_price_cents || plan.monthly_price_cents || 0),
    stripe_customer_id: item.stripe_customer_id || '',
    stripe_subscription_id: item.stripe_subscription_id || '',
    team: Array.isArray(item.team) ? item.team.map(member => ({
      name: member.name || member.nome || 'Usuário',
      email: member.email || '—',
      role: member.role || member.company_role || 'custom',
      status: member.status || 'active',
      modules: normalizeModules(member.modules || member.allowed_modules || member.permissions)
    })) : []
  }
}

function getSampleCompanies(){
  return [
    normalizeCompany({
      id:'cmp-demo-hidden-001',
      company_name:'Demo técnico oculto',
      owner_name:'Suporte interno',
      owner_email:'demo@interno.local',
      plan_code:'gestao',
      billing_mode:'manual',
      financial_status:'active',
      access_status:'active',
      seats_used:1,
      notes:'Modo técnico via ?demo=1 para homologação visual. Nunca usar como base operacional.',
      team:[
        { name:'Usuário demo', email:'demo@interno.local', role:'admin', status:'active', modules:['painel','material','precificacao','catalogo','itens-personalizacao','vendedor','agenda','assinatura'] }
      ]
    })
  ]
}

function readLogs(){
  try {
    const raw = JSON.parse(localStorage.getItem(MASTER_LOGS_KEY) || '[]')
    return Array.isArray(raw) ? raw : []
  } catch (_) {
    return []
  }
}

function writeLogs(items){
  localStorage.setItem(MASTER_LOGS_KEY, JSON.stringify(items))
}

function appendLog(companyId, action, message){
  const user = (() => {
    try { return JSON.parse(localStorage.getItem('auth_user') || '{}') } catch (_) { return {} }
  })()
  const items = readLogs()
  items.unshift({
    id: Date.now() + '-' + Math.random().toString(36).slice(2),
    company_id: companyId,
    action,
    message,
    actor: user.name || user.nome || user.email || 'Dono do app',
    created_at: new Date().toISOString()
  })
  writeLogs(items.slice(0, 250))
}

function setMasterNotice(type, text){
  const box = $('masterNotice')
  if(!box) return
  box.className = 'notice ' + (type || '')
  box.textContent = text || ''
}

function setDetailNotice(type, text){
  const box = $('detailActionNotice')
  if(!box) return
  box.className = 'notice ' + (type || '')
  box.textContent = text || ''
}

function getActorMeta(){
  try {
    const user = JSON.parse(localStorage.getItem('auth_user') || '{}')
    return {
      actor_id: user.id || user.user_id || '',
      actor_name: user.name || user.nome || user.full_name || '',
      actor_email: user.email || user.user_email || '',
      actor_role: user.role || user.user_role || user.company_role || ''
    }
  } catch (_) {
    return { actor_id:'', actor_name:'', actor_email:'', actor_role:'' }
  }
}

function buildAuditPayload(action, companyId){
  return {
    source: 'master-ui',
    action,
    company_id: companyId,
    requested_at: new Date().toISOString(),
    app_version: 'saas-hardening-v1',
    ...getActorMeta()
  }
}

function explainMasterError(error, fallback){
  const message = String(error && error.message || '').trim()
  if(!message) return fallback
  const lower = message.toLowerCase()
  if(lower.includes('failed to fetch') || lower.includes('networkerror') || lower.includes('network error')){
    return 'Não foi possível conectar à API do Master. Verifique o backend oficial e tente novamente.'
  }
  if(lower.includes('unauthorized') || lower.includes('forbidden') || lower.includes('não autorizado') || lower.includes('proibido')){
    return 'Sua sessão não tem permissão para esta ação no Master. Entre novamente com uma conta autorizada.'
  }
  return message
}

async function fetchJson(path, options = {}){
  const res = await fetch(API + path, {
    ...options,
    headers: authHeaders({ ...(options.headers || {}) })
  })
  const data = await res.json().catch(() => ({}))
  if(!res.ok) throw new Error(data.error || data.message || 'Falha ao carregar dados.')
  return data
}

function extractCompaniesPayload(raw){
  if(Array.isArray(raw)) return raw
  if(Array.isArray(raw.companies)) return raw.companies
  if(Array.isArray(raw.items)) return raw.items
  if(Array.isArray(raw.data)) return raw.data
  if(raw.company) return [raw.company]
  return []
}

async function loadCompanies(){
  let lastError = null
  let receivedEmptySuccess = false

  for(const path of REAL_ENDPOINTS){
    try {
      const data = await fetchJson(path)
      const companies = extractCompaniesPayload(data).map(normalizeCompany)
      if(companies.length){
        state.source = 'api'
        state.companies = companies
        applyFilters()
        setMasterNotice('', '')
        return
      }
      receivedEmptySuccess = true
    } catch (error) {
      lastError = error
    }
  }

  if(allowDemoMode){
    const companies = getSampleCompanies()
    state.source = 'demo'
    state.companies = companies
    state.selectedId = companies[0] ? companies[0].id : null
    setMasterNotice('warn', 'Modo técnico oculto ativo via ?demo=1. Este painel está configurado para operar com empresas reais e só expõe dados demo para suporte/homologação.')
    applyFilters()
    return
  }

  state.source = 'api'
  state.companies = []
  state.selectedId = null
  applyFilters()
  setMasterNotice('warn', receivedEmptySuccess
    ? 'A API respondeu, mas não retornou empresas reais para o painel Master. Verifique se o backend já expõe a lista de assinantes.'
    : ((lastError && lastError.message)
      ? `Não foi possível carregar empresas reais agora. Verifique os endpoints do Master/API (${REAL_ENDPOINTS.join(', ')}). Último retorno: ${explainMasterError(lastError, lastError.message)}`
      : `Não foi possível carregar empresas reais agora. Verifique os endpoints do Master/API (${REAL_ENDPOINTS.join(', ')}).`))
}

function getSelectedCompany(){
  return state.companies.find(company => String(company.id) === String(state.selectedId)) || null
}

function applyFilters(){
  const query = String(($('searchCompany')?.value || '')).trim().toLowerCase()
  const plan = $('filterPlan')?.value || 'all'
  const billing = $('filterBilling')?.value || 'all'
  const access = $('filterAccess')?.value || 'all'

  state.filtered = state.companies.filter(company => {
    const hay = [company.name, company.owner_name, company.owner_email, company.plan_name, company.billing_mode, company.access_status, company.financial_status].join(' ').toLowerCase()
    if(query && !hay.includes(query)) return false
    if(plan !== 'all' && company.plan_code !== plan) return false
    if(billing !== 'all' && company.billing_mode !== billing) return false
    if(access !== 'all' && company.access_status !== access) return false
    return true
  })

  if(!state.selectedId && state.filtered.length) state.selectedId = state.filtered[0].id
  if(state.selectedId && !state.companies.some(company => String(company.id) === String(state.selectedId))) {
    state.selectedId = state.filtered[0] ? state.filtered[0].id : null
  }

  renderStats()
  renderCompanyList()
  renderDetail()
}

function getStats(){
  const companies = state.companies
  return {
    total: companies.length,
    paid: companies.filter(c => c.billing_mode === 'stripe' && c.access_status !== 'blocked').length,
    courtesy: companies.filter(c => c.billing_mode === 'courtesy' || c.access_status === 'courtesy_active').length,
    delayed: companies.filter(c => ['past_due','unpaid'].includes(c.financial_status)).length,
    blocked: companies.filter(c => c.access_status === 'blocked').length,
    mrr: companies.filter(c => c.billing_mode === 'stripe' && c.access_status !== 'blocked').reduce((sum, c) => sum + Number(c.monthly_price_cents || 0), 0)
  }
}

function renderStats(){
  const stats = getStats()
  $('statsGrid').innerHTML = [
    { label:'Empresas totais', value:String(stats.total), note:'Todas as contas conhecidas pelo painel master.' },
    { label:'Pagantes ativas', value:String(stats.paid), note:'Empresas em cobrança normal e com acesso liberado.' },
    { label:'Cortesias', value:String(stats.courtesy), note:'Contas grátis liberadas manualmente por você.' },
    { label:'Atrasadas', value:String(stats.delayed), note:'Stripe em atraso, aguardando cobrança ou decisão manual.' },
    { label:'MRR estimado', value:brl(stats.mrr), note:'Receita mensal dos pagantes ativos no painel.' }
  ].map(item => `
    <article class="stat-card">
      <span>${escapeHtml(item.label)}</span>
      <strong>${escapeHtml(item.value)}</strong>
      <small>${escapeHtml(item.note)}</small>
    </article>
  `).join('')
}

function badge(label, cls){
  return `<span class="badge ${cls}">${escapeHtml(label)}</span>`
}

function renderCompanyList(){
  $('resultsMeta').textContent = `${state.filtered.length} empresa(s) exibida(s) · origem: ${state.source === 'api' ? getModeLabel() : 'demo técnico oculto'}`
  const host = $('companyList')
  if(!state.filtered.length){
    host.innerHTML = `<div class="empty-state">${state.companies.length ? 'Nenhuma empresa encontrada com os filtros atuais.' : 'Nenhuma empresa real foi carregada ainda. Confirme se o backend do Master está retornando assinantes.'}</div>`
    return
  }

  host.innerHTML = state.filtered.map(company => {
    const isActive = String(company.id) === String(state.selectedId)
    const seatLabel = company.seats_limit == null ? `${company.seats_used} / Ilimitado` : `${company.seats_used} / ${company.seats_limit}`
    return `
      <article class="company-card ${isActive ? 'active' : ''}" data-company-id="${escapeHtml(company.id)}">
        <div class="company-head">
          <div>
            <h3>${escapeHtml(company.name)}</h3>
            <p>${escapeHtml(company.owner_name)} · ${escapeHtml(company.owner_email)}</p>
          </div>
          <div class="badge-row">
            ${badge(company.plan_name, 'plan')}
            ${badge(STATUS_LABELS[company.billing_mode] || company.billing_mode, 'billing-' + company.billing_mode)}
            ${badge(STATUS_LABELS[company.access_status] || company.access_status, 'access-' + company.access_status)}
          </div>
        </div>
        <div class="quick-meta">
          <span>Assentos: <b>${escapeHtml(seatLabel)}</b></span>
          <span>Próxima cobrança: <b>${escapeHtml(formatDate(company.next_charge_at))}</b></span>
          <span>Último pagamento: <b>${escapeHtml(formatDate(company.last_payment_at))}</b></span>
        </div>
        <div class="quick-actions">
          <button type="button" class="small secondary" data-quick-action="courtesy"    data-company-id="${escapeHtml(company.id)}">Cortesia</button>
          <button type="button" class="small ghost"     data-quick-action="grantGrace"  data-company-id="${escapeHtml(company.id)}">+ 7 dias</button>
          <button type="button" class="small danger"    data-quick-action="block"       data-company-id="${escapeHtml(company.id)}">Bloquear</button>
          <button type="button" class="small primary"   data-quick-action="view"        data-company-id="${escapeHtml(company.id)}">Ver detalhes</button>
          <button type="button" class="small info"      data-quick-action="impersonate" data-company-id="${escapeHtml(company.id)}">Entrar como cliente</button>
          <button type="button" class="small danger-outline" data-quick-action="delete" data-company-id="${escapeHtml(company.id)}">Excluir empresa</button>
        </div>
      </article>
    `
  }).join('')
}

function updateCompanyLocally(updated){
  state.companies = state.companies.map(company => String(company.id) === String(updated.id) ? normalizeCompany(updated) : company)
  applyFilters()
}

async function sendCompanyAction(companyId, action, payload){
  const audit = buildAuditPayload(action, companyId)
  const candidates = [
    { path:`/saas/companies/${encodeURIComponent(companyId)}/actions`,  method:'POST',  body:{ action, ...payload, audit } },
    { path:`/admin/companies/${encodeURIComponent(companyId)}/actions`, method:'POST',  body:{ action, ...payload, audit } },
    { path:`/master/companies/${encodeURIComponent(companyId)}/actions`,method:'POST',  body:{ action, ...payload, audit } },
    { path:`/admin/companies/${encodeURIComponent(companyId)}`,         method:'PATCH', body:{ action, ...payload, audit } },
    { path:`/master/companies/${encodeURIComponent(companyId)}`,        method:'PATCH', body:{ action, ...payload, audit } }
  ]

  let lastError = null
  for(const candidate of candidates){
    try {
      const data = await fetchJson(candidate.path, {
        method: candidate.method,
        headers: { 'Content-Type':'application/json' },
        body: JSON.stringify(candidate.body)
      })
      return data
    } catch (error) {
      lastError = error
    }
  }
  throw lastError || new Error('Falha ao salvar ação do Master no backend.')
}

function nextCompanyState(company, action, payload){
  const plan = planTemplate(payload.plan_code || company.plan_code)
  const next = { ...company }
  next.notes = payload.notes || company.notes || ''

  if(action === 'courtesy' || action === 'freeAccess'){
    next.billing_mode = 'courtesy'
    next.financial_status = 'active'
    next.access_status = 'courtesy_active'
    next.courtesy_until = payload.courtesy_until || ''
    next.manual_grace_until = ''
  }
  if(action === 'endCourtesy'){
    next.billing_mode = 'manual'
    next.access_status = 'blocked'
    next.financial_status = company.financial_status === 'active' ? 'unpaid' : company.financial_status
    next.courtesy_until = ''
  }
  if(action === 'toPaid'){
    next.billing_mode = 'stripe'
    next.financial_status = 'active'
    next.access_status = 'active'
    next.courtesy_until = ''
    next.manual_grace_until = ''
  }
  if(action === 'changePlan'){
    next.plan_code = plan.code
    next.plan_name = plan.name
    next.seats_limit = plan.seats_limit
    next.monthly_price_cents = plan.monthly_price_cents
  }
  if(action === 'grantGrace'){
    next.access_status = 'manual_grace'
    next.manual_grace_until = payload.manual_grace_until || todayPlus(7)
  }
  if(action === 'block'){
    next.access_status = 'blocked'
  }
  if(action === 'reactivate'){
    if(next.billing_mode === 'courtesy') next.access_status = 'courtesy_active'
    else if(next.manual_grace_until) next.access_status = 'manual_grace'
    else if(next.billing_mode === 'trial') next.access_status = 'trial_active'
    else next.access_status = 'active'
    if(['unpaid','past_due','canceled'].includes(next.financial_status) && next.billing_mode !== 'stripe') next.financial_status = 'active'
  }

  return next
}

async function performAction(action, companyId, overrides = {}, silentNotice = false){
  const company = state.companies.find(item => String(item.id) === String(companyId))
  if(!company) return
  const payload = {
    plan_code: $('detailPlanSelect')?.value || company.plan_code,
    courtesy_until: $('detailCourtesyUntil')?.value || company.courtesy_until,
    manual_grace_until: $('detailGraceUntil')?.value || company.manual_grace_until,
    notes: $('detailNotes')?.value.trim() || company.notes,
    ...overrides
  }

  const optimistic = nextCompanyState(company, action, payload)
  try {
    const response = await sendCompanyAction(companyId, action, payload)
    const updated = normalizeCompany(response.company || response.data || optimistic)
    updateCompanyLocally(updated)
    appendLog(companyId, action, `Ação "${action}" aplicada via API.`)
    if(!silentNotice) setDetailNotice('ok', 'Ação aplicada com sucesso via API.')
  } catch (error) {
    if(allowDemoMode){
      updateCompanyLocally(optimistic)
      appendLog(companyId, action, `Ação "${action}" aplicada localmente em modo demonstração.`)
      if(!silentNotice) setDetailNotice('warn', 'Modo demonstração ativo: a ação foi aplicada localmente apenas para teste visual.')
      return
    }
    if(!silentNotice) setDetailNotice('warn', explainMasterError(error, 'A API do Master não confirmou a ação. Nenhuma alteração local fake foi aplicada.'))
  }
}

function renderDetail(){
  const company = getSelectedCompany()
  $('detailEmpty').style.display = company ? 'none' : 'block'
  $('detailContent').style.display = company ? 'block' : 'none'
  if(!company) return

  $('detailName').textContent = company.name
  $('detailSub').textContent = `${company.owner_name} · ${company.owner_email}`
  $('detailPlan').textContent = company.plan_name
  $('detailSeats').textContent = company.seats_limit == null ? `${company.seats_used} / Ilimitado` : `${company.seats_used} / ${company.seats_limit}`
  $('detailNextCharge').textContent = formatDate(company.next_charge_at)
  $('detailLastPayment').textContent = formatDate(company.last_payment_at)
  $('detailPlanSelect').value = company.plan_code
  $('detailCourtesyUntil').value = company.courtesy_until ? company.courtesy_until.slice(0, 10) : ''
  $('detailGraceUntil').value = company.manual_grace_until ? company.manual_grace_until.slice(0, 10) : ''
  $('detailNotes').value = company.notes || ''
  $('detailBadges').innerHTML = [
    badge(company.plan_name, 'plan'),
    badge(STATUS_LABELS[company.billing_mode] || company.billing_mode, 'billing-' + company.billing_mode),
    badge(STATUS_LABELS[company.access_status] || company.access_status, 'access-' + company.access_status)
  ].join('')

  $('teamInfo').textContent = company.team.length
    ? `${company.team.length} usuário(s) encontrado(s) nesta empresa.`
    : 'Nenhum usuário retornado pela API/local para esta empresa.'

  $('teamList').innerHTML = company.team.length ? company.team.map(member => `
    <article class="team-card">
      <h4>${escapeHtml(member.name)}</h4>
      <p>${escapeHtml(member.email)}</p>
      <div class="team-meta">
        <span class="badge plan">${escapeHtml(member.role || 'custom')}</span>
        <span class="badge access-${escapeHtml(member.status || 'active')}">${escapeHtml(STATUS_LABELS[member.status] || member.status || 'active')}</span>
      </div>
      <div class="team-modules">
        ${(member.modules || []).map(module => `<span class="module-pill">${escapeHtml(module)}</span>`).join('') || '<span class="module-pill">Sem módulos definidos</span>'}
      </div>
    </article>
  `).join('') : '<div class="empty-state">Sem equipe carregada para esta empresa.</div>'

  const logs = readLogs().filter(item => String(item.company_id) === String(company.id)).slice(0, 8)
  $('historyList').innerHTML = logs.length ? logs.map(item => `
    <article class="history-item">
      <strong>${escapeHtml(item.action)}</strong>
      <p>${escapeHtml(item.message)}</p>
      <p>${escapeHtml(item.actor)} · ${escapeHtml(formatDateTime(item.created_at))}</p>
    </article>
  `).join('') : '<div class="empty-state">Nenhuma ação registrada ainda para esta empresa.</div>'
}

function handleListClick(event){
  const quick = event.target.closest('[data-quick-action][data-company-id]')
  if(quick){
    const companyId = quick.dataset.companyId
    state.selectedId = companyId
    if(quick.dataset.quickAction === 'view'){
      applyFilters()
      return
    }
    if(quick.dataset.quickAction === 'courtesy'){
      $('detailCourtesyUntil').value = todayPlus(30)
      performAction('courtesy', companyId, { courtesy_until: todayPlus(30) }, true).then(() => {
        setDetailNotice('ok', 'Cortesia liberada rapidamente por 30 dias.')
      })
      return
    }
    if(quick.dataset.quickAction === 'grantGrace'){
      $('detailGraceUntil').value = todayPlus(7)
      performAction('grantGrace', companyId, { manual_grace_until: todayPlus(7) }, true).then(() => {
        setDetailNotice('ok', 'Liberação manual de 7 dias aplicada.')
      })
      return
    }
    if(quick.dataset.quickAction === 'block'){
      performAction('block', companyId, {}, true).then(() => {
        setDetailNotice('ok', 'Empresa bloqueada manualmente.')
      })
      return
    }
    if(quick.dataset.quickAction === 'delete'){
      performDelete(companyId)
      return
    }
    if(quick.dataset.quickAction === 'impersonate'){
      performImpersonate(companyId)
      return
    }
  }

  const card = event.target.closest('[data-company-id]')
  if(!card) return
  state.selectedId = card.dataset.companyId
  applyFilters()
}

function handleDetailActions(event){
  const button = event.target.closest('[data-master-action]')
  if(!button || !state.selectedId) return
  const action = button.dataset.masterAction
  performAction(action, state.selectedId)
}

async function performDelete(companyId){
  const company = state.companies.find(c => String(c.id) === String(companyId))
  if(!company) return
  const confirmed = window.confirm(
    `⚠️ Excluir permanentemente a empresa "${company.name}"?\n\n` +
    `Todos os usuários, pedidos e configurações serão removidos. Essa ação é irreversível.`
  )
  if(!confirmed) return

  try {
    await fetchJson(`/saas/companies/${encodeURIComponent(companyId)}`, { method: 'DELETE' })
    state.companies = state.companies.filter(c => String(c.id) !== String(companyId))
    if(String(state.selectedId) === String(companyId)) state.selectedId = null
    appendLog(companyId, 'deleted', `Empresa "${company.name}" excluída pelo master.`)
    applyFilters()
    setMasterNotice('ok', `✓ Empresa "${company.name}" excluída com sucesso.`)
  } catch(error) {
    if(allowDemoMode){
      state.companies = state.companies.filter(c => String(c.id) !== String(companyId))
      if(String(state.selectedId) === String(companyId)) state.selectedId = null
      applyFilters()
      setMasterNotice('warn', 'Modo demonstração: empresa removida localmente.')
      return
    }
    setMasterNotice('warn', explainMasterError(error, 'Não foi possível excluir a empresa agora.'))
  }
}

async function performImpersonate(companyId){
  const company = state.companies.find(c => String(c.id) === String(companyId))
  if(!company) return
  const confirmed = window.confirm(
    `Você está prestes a entrar como cliente da empresa "${company.name}".\n\n` +
    `Um aviso será exibido durante o acesso. Clique em "Voltar ao painel Master" para retornar.\n\n` +
    `A senha do cliente NÃO será alterada. Continuar?`
  )
  if(!confirmed) return

  try {
    const data = await fetchJson(`/saas/companies/${encodeURIComponent(companyId)}/impersonate`, { method: 'POST' })
    if(!data || !data.token) throw new Error('Token de impersonação não retornado pelo backend.')

    // Salva sessão master para restaurar depois
    localStorage.setItem('master_auth_token', getToken())
    try { localStorage.setItem('master_auth_user', localStorage.getItem('auth_user') || '') } catch(_){}
    localStorage.setItem('master_impersonating', JSON.stringify({
      company_id: companyId,
      company_name: data.company_name || company.name,
      impersonated_user: (data.user && data.user.email) || '',
      started_at: new Date().toISOString()
    }))

    // Troca sessão para o cliente
    localStorage.setItem('auth_token', data.token)
    localStorage.setItem('token', data.token)
    if(data.user) localStorage.setItem('auth_user', JSON.stringify(data.user))

    // Abre painel do cliente (usa window.top pois roda dentro de iframe)
    var target = window.top || window
    target.location.href = '/painel/?master_mode=1'
  } catch(error) {
    const msg = explainMasterError(error, 'Não foi possível iniciar o acesso como cliente.')
    setMasterNotice('warn', msg)
    window.alert('Erro ao entrar como cliente:\n\n' + msg)
  }
}

function bindEvents(){
  $('searchCompany')?.addEventListener('input', applyFilters)
  $('filterPlan')?.addEventListener('change', applyFilters)
  $('filterBilling')?.addEventListener('change', applyFilters)
  $('filterAccess')?.addEventListener('change', applyFilters)
  $('companyList')?.addEventListener('click', handleListClick)
  $('detailContent')?.addEventListener('click', handleDetailActions)
  $('refreshBtn')?.addEventListener('click', loadCompanies)
}

document.addEventListener('DOMContentLoaded', () => {
  bindEvents()
  loadCompanies()
})
