const API = (window.API_BASE || '') + '/api'
const qs = new URLSearchParams(window.location.search)
const isManagementMode = qs.get('gestao') === '1'
let subscriptionConfig = null
let teamState = { company:null, subscription:null, users:[] }

const MODULE_OPTIONS = [
  { code:'painel', label:'Painel', description:'Resumo geral e indicadores' },
  { code:'material', label:'Materiais', description:'Cadastro e custos de materiais' },
  { code:'precificacao', label:'Precificação', description:'Modelos, foto e PDF técnico' },
  { code:'catalogo', label:'Catálogo', description:'Modelos e consulta comercial' },
  { code:'itens-personalizacao', label:'Itens para personalização', description:'Globais e por modelo' },
  { code:'vendedor', label:'Vendedor', description:'Orçamentos, PDF e atendimento' },
  { code:'agenda', label:'Agenda', description:'Fila de produção e entregas' },
  { code:'assinatura', label:'Assinatura', description:'Plano, cobrança e equipe' }
]

const ROLE_PRESETS = {
  admin: MODULE_OPTIONS.map(item => item.code),
  vendedor: ['vendedor'],
  operacional: ['painel', 'agenda'],
  financeiro: ['painel', 'assinatura'],
  custom: []
}

const PLAN_PRESETS = {
  gestao: {
    code:'gestao',
    name:'Plano Gestão',
    monthly_price_cents:14900,
    seats_limit:2,
    seats_label:'2 acessos por empresa',
    badge:'Até 2 acessos',
    description:'Ideal para o dono da empresa + 1 colaborador, com controle manual de abas e equipe enxuta.'
  },
  empresarial: {
    code:'empresarial',
    name:'Plano Empresarial',
    monthly_price_cents:39900,
    seats_limit:null,
    seats_label:'Acessos ilimitados',
    badge:'Acessos ilimitados',
    description:'Pensado para operação maior, com múltiplos vendedores, setores e equipe sem limite de acessos.'
  }
}

function $(id){ return document.getElementById(id) }

function brl(cents){
  return (Number(cents || 0) / 100).toLocaleString('pt-BR', { style:'currency', currency:'BRL' })
}

function centsFromBRL(value){
  const n = Number(String(value || '').replace(',', '.'))
  return Number.isFinite(n) ? Math.round(n * 100) : 0
}

function getToken(){
  try {
    return window.ESTOFARIA_HTTP && typeof window.ESTOFARIA_HTTP.getToken === 'function'
      ? window.ESTOFARIA_HTTP.getToken()
      : (localStorage.getItem('auth_token') || localStorage.getItem('token') || '')
  } catch (_) { return '' }
}

function authHeaders(extra = {}){
  return window.ESTOFARIA_HTTP && typeof window.ESTOFARIA_HTTP.authHeaders === 'function'
    ? window.ESTOFARIA_HTTP.authHeaders(extra)
    : { Accept:'application/json', ...extra }
}

async function apiGet(path){
  return window.ESTOFARIA_HTTP.fetchJson(API + path, { cache: 'no-store' })
}

async function apiSend(method, path, body){
  return window.ESTOFARIA_HTTP.fetchJson(API + path, {
    method,
    headers: { 'Content-Type':'application/json' },
    body: body == null ? undefined : JSON.stringify(body)
  })
}

function setNotice(type, text, targetId = 'notice'){
  const box = $(targetId)
  if(!box) return
  box.className = 'notice ' + (type || '')
  box.textContent = text || ''
}

function escapeHtml(v){
  return String(v ?? '')
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#39;')
}

function normalizeModuleCode(value){
  const raw = String(value || '').trim().toLowerCase()
  const aliases = {
    dashboard:'painel',
    painel:'painel',
    material:'material',
    materiais:'material',
    pricing:'precificacao',
    precificacao:'precificacao',
    catalogo:'catalogo',
    personalizacao:'itens-personalizacao',
    'itens-personalizacao':'itens-personalizacao',
    itens_personalizacao:'itens-personalizacao',
    vendedor:'vendedor',
    seller:'vendedor',
    agenda:'agenda',
    assinatura:'assinatura',
    subscription:'assinatura'
  }
  return aliases[raw] || raw
}

function normalizeArray(value){
  if(!value) return []
  if(Array.isArray(value)) return value
  if(typeof value === 'string') return value.split(/[\s,;|]+/).map(item => item.trim()).filter(Boolean)
  if(typeof value === 'object') return Object.keys(value).filter(key => value[key])
  return []
}

function getPlanPreset(code){
  return PLAN_PRESETS[String(code || '').toLowerCase()] || PLAN_PRESETS.gestao
}

function getSelectedPlanCode(){
  const value = subscriptionConfig?.default_plan_code || subscriptionConfig?.plan_code || 'gestao'
  return PLAN_PRESETS[String(value).toLowerCase()] ? String(value).toLowerCase() : 'gestao'
}

function syncPlanSelection(forceCode){
  const plan = getPlanPreset(forceCode || getSelectedPlanCode())
  if($('planName')) $('planName').textContent = plan.name
  if($('planPrice')) $('planPrice').innerHTML = `${brl(plan.monthly_price_cents)} <small>/ mês</small>`
  if($('planBadge')) $('planBadge').textContent = plan.badge
  if($('planNote')) $('planNote').textContent = plan.description
  if($('selectedPlanSummary')) $('selectedPlanSummary').textContent = plan.name
  if($('priceSummary')) $('priceSummary').textContent = `${brl(plan.monthly_price_cents)}/mês`
  if($('seatSummary')) $('seatSummary').textContent = plan.seats_label
  if($('consultorPlan')) $('consultorPlan').value = plan.code
  // Atualiza o data-checkout-plan do botão do resumo para refletir o plano selecionado
  const summaryBtn = $('summaryAssinarBtn')
  if(summaryBtn) summaryBtn.dataset.checkoutPlan = plan.code
  document.querySelectorAll('[data-plan-card]').forEach(card => {
    card.classList.toggle('selected', card.dataset.planCard === plan.code)
  })
  return plan
}

function inferSeatsLimit(planCode, planName){
  const code = String(planCode || '').toLowerCase()
  const name = String(planName || '').toLowerCase()
  if(code.includes('empresarial') || name.includes('empresarial')) return null
  if(code.includes('gestao') || name.includes('gestão') || name.includes('gestao')) return 2
  return null
}

function canManageBillingArea(){
  return !!(window.EstofariaAuth && typeof window.EstofariaAuth.canManageBilling === 'function' && window.EstofariaAuth.canManageBilling())
}

function canManageTeamArea(){
  return !!(window.EstofariaAuth && typeof window.EstofariaAuth.canManageTeam === 'function' && window.EstofariaAuth.canManageTeam())
}

function getTeamRestrictionMessage(){
  return 'O gerenciamento da equipe é restrito ao proprietário, administradores da empresa ou perfis com permissão explícita de equipe.'
}

function syncTeamManagementState(){
  const canManage = canManageTeamArea()
  const formPane = $('formEquipe') ? $('formEquipe').closest('.team-pane') : null
  if(formPane) formPane.style.opacity = canManage ? '1' : '.68'

  ;['inviteName', 'inviteEmail', 'inviteRole', 'teamSubmitBtn', 'teamResetBtn'].forEach(id => {
    const element = $(id)
    if(element) element.disabled = !canManage
  })

  document.querySelectorAll('#moduleChecklist input').forEach(input => {
    input.disabled = !canManage
  })

  if(!canManage){
    $('inviteFormTitle').textContent = 'Gerenciamento restrito'
    setNotice('warn', getTeamRestrictionMessage(), 'noticeTeam')
  }else if(!$('editingUserId').value){
    $('inviteFormTitle').textContent = 'Convidar usuário'
    if(($('noticeTeam')?.textContent || '').trim() === getTeamRestrictionMessage()){
      setNotice('', '', 'noticeTeam')
    }
  }
}

function getActiveUsersCount(){
  return teamState.users.filter(user => String(user.status || '').toLowerCase().includes('active')).length
}

function getCurrentSeatsLimit(){
  const selectedPlan = getPlanPreset(getSelectedPlanCode())
  const planName = subscriptionConfig?.plan_name || teamState.subscription?.plan_name || selectedPlan.name || ''
  const planCode = subscriptionConfig?.plan_code || teamState.subscription?.plan_code || selectedPlan.code || ''
  const apiLimit = teamState.subscription?.seats_limit
  return apiLimit == null ? inferSeatsLimit(planCode, planName) : apiLimit
}

function hasSeatAvailable(ignoreUserId){
  const limit = getCurrentSeatsLimit()
  if(limit == null) return true
  const activeUsers = teamState.users.filter(user => {
    if(ignoreUserId && String(user.id) === String(ignoreUserId)) return false
    return String(user.status || '').toLowerCase().includes('active')
  }).length
  return activeUsers < limit
}

function normalizeTeamPayload(raw){
  const data = raw || {}
  const usersRaw = Array.isArray(data.users) ? data.users : Array.isArray(data.items) ? data.items : []
  const users = usersRaw.map(item => {
    const modules = normalizeArray(
      item.modules || item.allowed_modules || item.allowed_tabs || item.permissions || item.permissions_map || item.access_modules
    ).map(normalizeModuleCode)

    const normalizedModules = modules.filter((value, index, list) => value && list.indexOf(value) === index)
    return {
      id: item.id || item.user_id || item.invite_id || item.member_id || item.email,
      name: item.name || item.nome || item.full_name || item.user_name || 'Usuário',
      email: item.email || item.user_email || '-',
      role: item.role || item.company_role || item.user_role || 'custom',
      status: String(item.status || item.state || (item.accepted_at ? 'active' : 'pending')).toLowerCase(),
      modules: normalizedModules,
      lastLoginAt: item.last_login_at || item.last_seen_at || item.updated_at || '',
      invitedAt: item.invited_at || item.created_at || '',
      isOwner: Boolean(item.is_owner || item.owner)
    }
  })

  return {
    company: data.company || data.empresa || null,
    subscription: data.subscription || data.plan || null,
    users
  }
}

function renderPlan(cfg){
  subscriptionConfig = cfg || {}
  const selectedPlan = syncPlanSelection(cfg?.default_plan_code || cfg?.plan_code || getSelectedPlanCode())
  const td = Number(cfg?.trial_days || 0)
  $('trialSummary').textContent = td >= 30 ? `${Math.round(td/30)} ${Math.round(td/30) === 1 ? 'mês' : 'meses'} grátis` : `${td} dias grátis`
  $('providerSummary').textContent = cfg?.payment_provider || 'manual'
  $('supportSummary').textContent = cfg?.support_contact || 'Atendimento comercial'
  if($('planNote') && cfg?.notes){
    $('planNote').textContent = cfg.notes
  }
  if($('seatSummary') && !cfg?.notes){
    $('seatSummary').textContent = selectedPlan.seats_label
  }

  if(!cfg.enabled){
    setNotice('warn', 'A assinatura está temporariamente desativada. Você ainda pode deixar seus dados para contato.')
  }

  syncSeatInfo()
}

function renderManagement(cfg){
  if(!isManagementMode) return
  const card = $('gestaoCard')
  if(!canManageBillingArea()){
    if(card) card.style.display = 'none'
    setNotice('warn', 'A área de gestão comercial exige permissão específica de cobrança.', 'notice')
    return
  }
  if(card) card.style.display = 'block'
  $('cfgEnabled').checked = Boolean(cfg.enabled)
  $('cfgPlanName').value = cfg.plan_name || ''
  $('cfgMonthly').value = ((Number(cfg.monthly_price_cents || 0)) / 100).toFixed(2)
  $('cfgTrial').value = Number(cfg.trial_days || 0)
  $('cfgProvider').value = cfg.payment_provider || ''
  $('cfgLink').value = cfg.payment_link || ''
  $('cfgSupport').value = cfg.support_contact || ''
  $('cfgNotes').value = cfg.notes || ''
}

function renderLeads(items){
  const box = $('leadsList')
  if(!box) return
  if(!items.length){
    box.textContent = 'Nenhuma solicitação recebida ainda.'
    return
  }
  box.innerHTML = items.map(item=>{
    const when = item.created_at ? new Date(item.created_at).toLocaleString('pt-BR') : '-'
    return `
      <div class="plan-line">
        <span><b>${escapeHtml(item.name)}</b><br><small>${escapeHtml(item.email)} · ${escapeHtml(item.whatsapp || 'sem WhatsApp')}</small><br><small>${escapeHtml(item.business_name || 'sem empresa')} · ${when}</small></span>
        <strong>${escapeHtml(item.status || 'novo')}</strong>
      </div>
    `
  }).join('')
}

async function loadLeads(){
  if(!isManagementMode || !canManageBillingArea()) return
  try{
    const items = await apiGet('/subscription/checkout-requests')
    renderLeads(Array.isArray(items) ? items : [])
  }catch(e){
    console.error(e)
    renderLeads([])
    setNotice('warn', 'Não consegui carregar as solicitações.', 'noticeAdmin')
  }
}

async function loadSubscription(){
  try{
    const cfg = await apiGet('/subscription/public')
    renderPlan(cfg)
    renderManagement(cfg)
  }catch(e){
    console.error(e)
    setNotice('warn', 'Não consegui carregar os detalhes da assinatura agora.')
  }
}

async function iniciarCheckoutStripe(planCode){
  const plan = getPlanPreset(planCode || getSelectedPlanCode())
  setNotice('ok', 'Abrindo checkout seguro da Stripe...')
  try{
    const out = await apiSend('POST', '/subscription/stripe/create-checkout', { plan_code: plan.code })
    if(out?.url){
      // Redireciona no topo da página (o conteúdo roda dentro de um iframe no app-shell)
      window.top.location.href = out.url
    }else{
      setNotice('warn', 'Não foi possível abrir o checkout. Tente novamente.')
    }
  }catch(e){
    console.error('Checkout error', e)
    const status = e.status ? ` (HTTP ${e.status})` : ''
    const detail = e.payload?.message || e.payload?.error || e.message || 'Erro desconhecido'
    setNotice('warn', `Erro ao abrir checkout${status}: ${detail}`)
  }
}

async function solicitarAtendimento(ev){
  ev.preventDefault()
  const planCode = $('consultorPlan')?.value || getSelectedPlanCode()
  const selectedPlan = getPlanPreset(planCode)
  const user = window.EstofariaAuth?.user

  const payload = {
    name: $('consultorName').value.trim() || user?.name || '',
    business_name: $('consultorBusiness').value.trim() || user?.empresa || '',
    email: $('consultorEmail').value.trim() || user?.email || '',
    whatsapp: $('consultorWhatsapp').value.trim(),
    plan_code: selectedPlan.code,
    plan_name: selectedPlan.name,
    billing_cycle: 'monthly',
    accepted_terms: $('consultorTerms').checked,
    source: 'consultor-ui'
  }

  if(!payload.name || !payload.email){
    setNotice('warn', 'Preencha pelo menos nome e e-mail para solicitar atendimento.', 'noticeConsultor')
    return
  }

  try{
    await apiSend('POST', '/subscription/checkout-request', payload)
    setNotice('ok', `Solicitação enviada! Retornaremos em breve sobre o ${selectedPlan.name}.`, 'noticeConsultor')
    $('formConsultor').reset()
    if(isManagementMode) loadLeads()
  }catch(e){
    console.error(e)
    setNotice('warn', e.message || 'Não consegui registrar sua solicitação.', 'noticeConsultor')
  }
}

async function salvarConfiguracao(ev){
  ev.preventDefault()
  if(!canManageBillingArea()){
    setNotice('warn', 'Somente perfis com gestão comercial podem alterar a configuração da cobrança.', 'noticeAdmin')
    return
  }
  const payload = {
    enabled: $('cfgEnabled').checked,
    plan_name: $('cfgPlanName').value.trim() || 'Plano Profissional',
    monthly_price_cents: centsFromBRL($('cfgMonthly').value),
    annual_price_cents: 0,
    payment_provider: $('cfgProvider').value.trim() || 'manual',
    payment_link: $('cfgLink').value.trim(),
    support_contact: $('cfgSupport').value.trim(),
    trial_days: Number($('cfgTrial').value || 0),
    notes: $('cfgNotes').value.trim() || '2 meses grátis com suporte'
  }

  try{
    const cfg = await apiSend('PUT', '/subscription/config', payload)
    renderPlan(cfg)
    renderManagement(cfg)
    setNotice('ok', 'Plano salvo com sucesso.', 'noticeAdmin')
  }catch(e){
    console.error(e)
    setNotice('warn', e.message || 'Não consegui salvar o plano.', 'noticeAdmin')
  }
}

function buildModuleChecklist(){
  const host = $('moduleChecklist')
  if(!host) return
  host.innerHTML = MODULE_OPTIONS.map(item => `
    <label class="module-item">
      <input type="checkbox" value="${item.code}">
      <div>
        <strong>${item.label}</strong>
        <span>${item.description}</span>
      </div>
    </label>
  `).join('')
}

function getSelectedModules(){
  return Array.from(document.querySelectorAll('#moduleChecklist input:checked')).map(input => input.value)
}

function setSelectedModules(modules){
  const selected = new Set((modules || []).map(normalizeModuleCode))
  document.querySelectorAll('#moduleChecklist input').forEach(input => {
    input.checked = selected.has(input.value)
  })
}

function applyRolePreset(role){
  const normalizedRole = String(role || 'custom').toLowerCase()
  const modules = ROLE_PRESETS[normalizedRole] || []
  if(normalizedRole !== 'custom') setSelectedModules(modules)
}

function resetTeamForm(){
  $('editingUserId').value = ''
  $('inviteName').value = ''
  $('inviteEmail').value = ''
  $('inviteRole').value = 'admin'
  applyRolePreset('admin')
  $('teamSubmitBtn').textContent = 'Enviar convite'
  $('inviteFormTitle').textContent = 'Convidar usuário'
  setNotice('', '', 'noticeTeam')
}

function formatDateTime(value){
  if(!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('pt-BR')
}

function statusLabel(status){
  const normalized = String(status || '').toLowerCase()
  if(normalized.includes('active')) return ['active', 'Ativo']
  if(normalized.includes('pending') || normalized.includes('invite')) return ['pending', 'Convite pendente']
  if(normalized.includes('inactive') || normalized.includes('disabled') || normalized.includes('removed')) return ['inactive', 'Inativo']
  return ['pending', normalized || 'Pendente']
}

function roleLabel(role){
  const labels = {
    admin: 'Administrador',
    vendedor: 'Vendedor',
    operacional: 'Operacional',
    financeiro: 'Financeiro',
    custom: 'Personalizado',
    owner: 'Proprietário'
  }
  return labels[String(role || '').toLowerCase()] || (role || 'Personalizado')
}

function syncSeatInfo(){
  const activeUsers = getActiveUsersCount()
  const seatsLimit = getCurrentSeatsLimit()
  $('teamSeatsUsed').textContent = String(activeUsers)
  $('teamSeatsLimit').textContent = seatsLimit == null ? 'Ilimitado' : String(seatsLimit)
  $('teamMeta').textContent = seatsLimit == null
    ? `${teamState.users.length} usuário(s) encontrado(s). Plano sem limite de acessos.`
    : `${activeUsers} acesso(s) ativo(s) de ${seatsLimit} disponível(is).`
}

function renderTeamUsers(){
  const host = $('teamUsersList')
  if(!host) return
  if(!teamState.users.length){
    host.innerHTML = '<div class="empty-state">Nenhum usuário adicional cadastrado ainda. Use o formulário ao lado para convidar o primeiro acesso.</div>'
    syncSeatInfo()
    syncTeamManagementState()
    return
  }

  const canManage = canManageTeamArea()
  host.innerHTML = teamState.users.map(user => {
    const [statusClass, statusText] = statusLabel(user.status)
    const modules = user.modules.length ? user.modules : ['Nenhum módulo definido']
    const protectedOwnerText = '<span class="muted small-note">Conta principal protegida. A transferência deve ser feita em fluxo administrativo próprio.</span>'
    const readOnlyText = `<span class="muted small-note">${escapeHtml(getTeamRestrictionMessage())}</span>`
    const actionButton = statusClass === 'inactive'
      ? `<button type="button" class="ghost small-btn" data-action="reactivate" data-id="${escapeHtml(user.id)}">Reativar</button>`
      : `<button type="button" class="danger small-btn" data-action="deactivate" data-id="${escapeHtml(user.id)}">Desativar</button>`
    const actionsHtml = !canManage
      ? readOnlyText
      : user.isOwner
        ? protectedOwnerText
        : `<button type="button" class="secondary small-btn" data-action="edit" data-id="${escapeHtml(user.id)}">Editar acessos</button>${actionButton}`

    return `
      <article class="team-user">
        <div class="team-user-head">
          <div>
            <h4>${escapeHtml(user.name)}</h4>
            <p>${escapeHtml(user.email)}</p>
          </div>
          <span class="status-badge ${statusClass}">${statusText}</span>
        </div>
        <div class="meta-row">
          <span class="role-badge">${escapeHtml(roleLabel(user.role))}</span>
          ${user.isOwner ? '<span class="module-badge">Conta principal</span>' : ''}
          <span class="module-badge">Último acesso: ${escapeHtml(formatDateTime(user.lastLoginAt))}</span>
        </div>
        <div class="modules-row">
          ${modules.map(module => `<span class="module-badge">${escapeHtml(module)}</span>`).join('')}
        </div>
        <div class="user-actions">${actionsHtml}</div>
      </article>
    `
  }).join('')

  syncSeatInfo()
  syncTeamManagementState()
}

function findTeamUser(userId){
  return teamState.users.find(user => String(user.id) === String(userId)) || null
}

function loadUserIntoForm(user){
  if(!user) return
  if(!canManageTeamArea()){
    setNotice('warn', getTeamRestrictionMessage(), 'noticeTeam')
    return
  }
  if(user.isOwner){
    setNotice('warn', 'A conta principal está protegida e não pode ser alterada por este formulário.', 'noticeTeam')
    return
  }
  $('editingUserId').value = user.id
  $('inviteName').value = user.name || ''
  $('inviteEmail').value = user.email || ''
  $('inviteRole').value = ROLE_PRESETS[user.role] ? user.role : 'custom'
  setSelectedModules(user.modules || [])
  $('teamSubmitBtn').textContent = 'Salvar alterações'
  $('inviteFormTitle').textContent = 'Editar usuário'
  syncTeamManagementState()
  window.scrollTo({ top: $('teamCard').offsetTop - 90, behavior:'smooth' })
}

function renderBannerAcesso(accessStatus, financialStatus){
  const banner = $('bannerAcesso')
  if(!banner) return

  const CONFIGS = {
    pending_payment: {
      bg: '#1e40af', color: '#fff',
      icon: '💳',
      title: 'Cadastre seu cartão para começar',
      text: 'Você tem <strong>2 meses grátis</strong> esperando. Cadastre o cartão agora — a cobrança só começa após o período de teste. Sem cartão, o acesso ao sistema fica bloqueado.',
      btn: 'Cadastrar cartão e ativar agora'
    },
    blocked: {
      bg: '#991b1b', color: '#fff',
      icon: '🔒',
      title: 'Acesso bloqueado',
      text: 'Sua assinatura está inativa. Regularize para voltar a usar o sistema.',
      btn: 'Regularizar assinatura'
    },
    past_due: {
      bg: '#92400e', color: '#fff',
      icon: '⚠️',
      title: 'Pagamento em atraso',
      text: 'Há uma fatura em aberto. Atualize seu método de pagamento para continuar usando o sistema.',
      btn: 'Atualizar pagamento'
    }
  }

  const statusKey = accessStatus === 'blocked' && financialStatus === 'past_due' ? 'past_due' : (accessStatus || '')
  const cfg = CONFIGS[statusKey]

  if(!cfg){
    banner.style.display = 'none'
    return
  }

  banner.style.cssText = `display:block;background:${cfg.bg};color:${cfg.color};padding:20px 24px;text-align:center;border-radius:0 0 12px 12px;margin-bottom:16px`
  banner.innerHTML = `
    <div style="font-size:28px;margin-bottom:6px">${cfg.icon}</div>
    <strong style="font-size:17px;display:block;margin-bottom:6px">${cfg.title}</strong>
    <p style="margin:0 0 14px;opacity:.92;font-size:14px;max-width:520px;margin-left:auto;margin-right:auto">${cfg.text}</p>
    <button onclick="iniciarCheckoutStripe()" style="background:#fff;color:${cfg.bg};border:none;padding:10px 22px;border-radius:8px;font-weight:700;cursor:pointer;font-size:14px">${cfg.btn}</button>
  `
}

async function loadTeam(){
  try{
    const payload = await apiGet('/auth/team')
    teamState = normalizeTeamPayload(payload)
    const accessStatus = payload?.company?.access_status || payload?.subscription?.access_status || ''
    const financialStatus = payload?.company?.financial_status || payload?.subscription?.financial_status || ''
    renderBannerAcesso(accessStatus, financialStatus)
    renderTeamUsers()
    syncTeamManagementState()
  }catch(error){
    console.error(error)
    teamState = { company:null, subscription:null, users:[] }
    renderTeamUsers()
    syncTeamManagementState()
    setNotice('warn', 'Não consegui carregar a equipe agora. Verifique se os endpoints de usuários já estão ativos na API.', 'noticeTeam')
  }
}

async function submitTeamForm(event){
  event.preventDefault()
  setNotice('', '', 'noticeTeam')
  if(!canManageTeamArea()){
    setNotice('warn', getTeamRestrictionMessage(), 'noticeTeam')
    return
  }
  const editingId = $('editingUserId').value.trim()
  const payload = {
    name: $('inviteName').value.trim(),
    email: $('inviteEmail').value.trim(),
    role: $('inviteRole').value,
    modules: getSelectedModules()
  }

  if(!payload.name || !payload.email){
    setNotice('warn', 'Preencha nome e e-mail do usuário.', 'noticeTeam')
    return
  }
  if(!payload.modules.length){
    setNotice('warn', 'Selecione pelo menos uma aba para este usuário.', 'noticeTeam')
    return
  }

  const editingUser = editingId ? findTeamUser(editingId) : null
  if(editingUser && editingUser.isOwner){
    setNotice('warn', 'A conta principal está protegida e não pode ser editada por este formulário.', 'noticeTeam')
    return
  }

  const isEditingActiveUser = !!(editingUser && String(editingUser.status || '').toLowerCase().includes('active'))
  if(!editingId && !hasSeatAvailable()){
    setNotice('warn', 'Seu plano atingiu o limite de acessos. Troque o plano ou desative um usuário antes de convidar outro.', 'noticeTeam')
    return
  }
  if(editingId && !isEditingActiveUser && !hasSeatAvailable(editingId)){
    setNotice('warn', 'Não há vaga disponível para reativar este acesso dentro do plano atual.', 'noticeTeam')
    return
  }

  try{
    if(editingId){
      await apiSend('PATCH', `/auth/team/users/${encodeURIComponent(editingId)}`, payload)
      setNotice('ok', 'Acessos atualizados com sucesso.', 'noticeTeam')
    }else{
      await apiSend('POST', '/auth/team/invite', payload)
      setNotice('ok', 'Convite enviado com sucesso.', 'noticeTeam')
    }
    resetTeamForm()
    syncTeamManagementState()
    await loadTeam()
  }catch(error){
    console.error(error)
    setNotice('warn', error.message || 'Não consegui salvar este usuário.', 'noticeTeam')
  }
}

async function handleTeamAction(event){
  const button = event.target.closest('[data-action][data-id]')
  if(!button) return
  if(!canManageTeamArea()){
    setNotice('warn', getTeamRestrictionMessage(), 'noticeTeam')
    return
  }
  const userId = button.dataset.id
  const action = button.dataset.action
  const user = findTeamUser(userId)
  if(!user) return

  if(user.isOwner){
    setNotice('warn', 'A conta principal está protegida e não pode ser desativada nem editada por este fluxo.', 'noticeTeam')
    return
  }

  if(action === 'edit'){
    loadUserIntoForm(user)
    return
  }

  try{
    if(action === 'deactivate'){
      await apiSend('POST', `/auth/team/users/${encodeURIComponent(userId)}/deactivate`)
      setNotice('ok', 'Usuário desativado e vaga liberada.', 'noticeTeam')
    }
    if(action === 'reactivate'){
      if(!hasSeatAvailable(userId)){
        setNotice('warn', 'Limite de acessos atingido para o plano atual. Troque o plano ou libere uma vaga antes de reativar.', 'noticeTeam')
        return
      }
      await apiSend('POST', `/auth/team/users/${encodeURIComponent(userId)}/reactivate`)
      setNotice('ok', 'Usuário reativado com sucesso.', 'noticeTeam')
    }
    await loadTeam()
  }catch(error){
    console.error(error)
    setNotice('warn', error.message || 'Não consegui atualizar este usuário.', 'noticeTeam')
  }
}

window.addEventListener('DOMContentLoaded', ()=>{
  buildModuleChecklist()
  resetTeamForm()
  syncPlanSelection(getSelectedPlanCode())
  syncTeamManagementState()
  loadSubscription()
  loadTeam()
  if(isManagementMode) loadLeads()

  // Retorno do Stripe / redirect por bloqueio
  if(qs.get('sucesso') === '1'){
    setNotice('ok', '🎉 Cartão cadastrado com sucesso! Seus 2 meses grátis estão ativos. Bem-vindo ao Estofaria Digital.')
    window.history.replaceState({}, '', window.location.pathname)
  } else if(qs.get('cancelado') === '1'){
    setNotice('warn', 'O cadastro do cartão foi cancelado. Cadastre o cartão para liberar o acesso ao sistema.')
    window.history.replaceState({}, '', window.location.pathname)
  } else if(qs.get('bloqueado') === '1'){
    setNotice('warn', 'O acesso ao sistema está bloqueado. Regularize sua assinatura abaixo para continuar.')
    window.history.replaceState({}, '', window.location.pathname)
  }

  // Botões de checkout direto via Stripe
  document.querySelectorAll('[data-checkout-plan]').forEach(button => {
    button.addEventListener('click', () => iniciarCheckoutStripe(button.dataset.checkoutPlan))
  })

  // Hero: assinar e falar com consultor
  $('heroAssinarBtn')?.addEventListener('click', () => iniciarCheckoutStripe(getSelectedPlanCode()))
  $('heroConsultorBtn')?.addEventListener('click', () => {
    $('cardConsultor')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  })

  // Formulário secundário: falar com um consultor
  $('formConsultor')?.addEventListener('submit', solicitarAtendimento)
  $('formGestao')?.addEventListener('submit', salvarConfiguracao)
  $('formEquipe')?.addEventListener('submit', submitTeamForm)
  $('inviteRole')?.addEventListener('change', event => applyRolePreset(event.target.value))
  $('teamResetBtn')?.addEventListener('click', resetTeamForm)
  $('refreshTeamBtn')?.addEventListener('click', loadTeam)
  $('teamUsersList')?.addEventListener('click', handleTeamAction)
  window.addEventListener('estofaria-auth-ready', syncTeamManagementState)

  window.addEventListener('message', function (e) {
    if (!e.data || e.data.type !== 'estofaria-ptr-refresh') return
    Promise.all([
      typeof loadSubscription === 'function' ? loadSubscription().catch(function () {}) : Promise.resolve(),
      typeof loadLeads === 'function' ? loadLeads().catch(function () {}) : Promise.resolve(),
      typeof loadTeam === 'function' ? loadTeam().catch(function () {}) : Promise.resolve()
    ]).finally(function () {
      try { window.parent.postMessage({ type: 'estofaria-ptr-done' }, '*') } catch (_) {}
    })
  })
})
