(function () {
  var API = (window.ESTOFARIA_CONFIG && window.ESTOFARIA_CONFIG.API_URL) || 'https://estofaria-backend.onrender.com'

  var state = {
    holidays: [],
    holidayMap: Object.create(null),
    cityCode: '',
    orders: []
  }

  // ===== HELPERS =====

  function $(id) { return document.getElementById(id) }

  function getToken() {
    try {
      var auth = window.ESTOFARIA_AUTH
      if (auth && typeof auth.getToken === 'function') return auth.getToken()
    } catch (_) {}
    return localStorage.getItem('auth_token') || localStorage.getItem('token') || ''
  }

  function apiGet(path) {
    return fetch(API + path, { headers: { Authorization: 'Bearer ' + getToken() } }).then(function (r) { return r.json() })
  }

  function apiPatch(path, body) {
    return fetch(API + path, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + getToken() },
      body: JSON.stringify(body)
    }).then(function (r) { return r.json() })
  }

  function apiDelete(path) {
    return fetch(API + path, {
      method: 'DELETE',
      headers: { Authorization: 'Bearer ' + getToken() }
    }).then(function (r) { return r.ok ? {} : r.json() })
  }

  function formatFullDate(dateStr) {
    if (!dateStr) return '--/--'
    var d = new Date(dateStr + 'T00:00:00')
    if (isNaN(d)) return '--/--'
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
  }

  function formatShortDate(dateStr) {
    if (!dateStr) return '--/--'
    var d = new Date(dateStr + 'T00:00:00')
    if (isNaN(d)) return '--/--'
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
  }

  function toISODate(d) {
    var year = d.getFullYear()
    var month = String(d.getMonth() + 1).padStart(2, '0')
    var day = String(d.getDate()).padStart(2, '0')
    return year + '-' + month + '-' + day
  }

  function scopeBadge(scope) {
    if (scope === 'state') return '<span style="display:inline-block;font-size:.72rem;padding:1px 6px;border-radius:10px;background:#dbeafe;color:#1e40af;font-weight:600;white-space:nowrap;">Estadual</span>'
    if (scope === 'city') return '<span style="display:inline-block;font-size:.72rem;padding:1px 6px;border-radius:10px;background:#dcfce7;color:#166534;font-weight:600;white-space:nowrap;">Municipal</span>'
    return '<span style="display:inline-block;font-size:.72rem;padding:1px 6px;border-radius:10px;background:#f3f4f6;color:#374151;font-weight:600;white-space:nowrap;">Nacional</span>'
  }

  function notifyError(msg) { alert(msg) }

  // ===== MANUAL HOLIDAYS (localStorage) =====

  function getManualHolidayKey() {
    try {
      var user = JSON.parse(localStorage.getItem('esd_user') || '{}')
      return 'esd_manual_holidays_' + (user.company_id || 'default')
    } catch (_) { return 'esd_manual_holidays_default' }
  }

  function getManualHolidays() {
    try { return JSON.parse(localStorage.getItem(getManualHolidayKey()) || '[]') } catch (_) { return [] }
  }

  function saveManualHolidays(list) {
    localStorage.setItem(getManualHolidayKey(), JSON.stringify(list))
  }

  // ===== ESTADOS E CIDADES =====

  var ESTADOS_CIDADES = {
    'AL': { nome: 'Alagoas',            cidades: [{ code: 'AL-MACEIO',          label: 'Maceió' }] },
    'AM': { nome: 'Amazonas',           cidades: [{ code: 'AM-MANAUS',           label: 'Manaus' }] },
    'BA': { nome: 'Bahia',              cidades: [{ code: 'BA-SALVADOR',         label: 'Salvador' }, { code: 'BA-FEIRA_SANTANA', label: 'Feira de Santana' }] },
    'CE': { nome: 'Ceará',              cidades: [{ code: 'CE-FORTALEZA',        label: 'Fortaleza' }] },
    'DF': { nome: 'Distrito Federal',   cidades: [{ code: 'DF-BRASILIA',         label: 'Brasília' }] },
    'ES': { nome: 'Espírito Santo',     cidades: [{ code: 'ES-VITORIA',          label: 'Vitória' }] },
    'GO': { nome: 'Goiás',              cidades: [{ code: 'GO-GOIANIA',          label: 'Goiânia' }] },
    'MA': { nome: 'Maranhão',           cidades: [{ code: 'MA-SAO_LUIS',         label: 'São Luís' }] },
    'MG': { nome: 'Minas Gerais',       cidades: [{ code: 'MG-BELO_HORIZONTE',   label: 'Belo Horizonte' }, { code: 'MG-CONTAGEM', label: 'Contagem' }, { code: 'MG-UBERLANDIA', label: 'Uberlândia' }, { code: 'MG-JUIZ_DE_FORA', label: 'Juiz de Fora' }] },
    'MS': { nome: 'Mato Grosso do Sul', cidades: [{ code: 'MS-CAMPO_GRANDE',     label: 'Campo Grande' }] },
    'PA': { nome: 'Pará',               cidades: [{ code: 'PA-BELEM',            label: 'Belém' }] },
    'PE': { nome: 'Pernambuco',         cidades: [{ code: 'PE-RECIFE',           label: 'Recife' }, { code: 'PE-CARUARU', label: 'Caruaru' }] },
    'PI': { nome: 'Piauí',              cidades: [{ code: 'PI-TERESINA',         label: 'Teresina' }] },
    'PR': { nome: 'Paraná',             cidades: [{ code: 'PR-CURITIBA',         label: 'Curitiba' }, { code: 'PR-LONDRINA', label: 'Londrina' }] },
    'RJ': { nome: 'Rio de Janeiro',     cidades: [{ code: 'RJ-RIO_DE_JANEIRO',   label: 'Rio de Janeiro' }, { code: 'RJ-NITEROI', label: 'Niterói' }, { code: 'RJ-DUQUE_CAXIAS', label: 'Duque de Caxias' }, { code: 'RJ-NOVA_IGUACU', label: 'Nova Iguaçu' }] },
    'RN': { nome: 'Rio Grande do Norte', cidades: [{ code: 'RN-NATAL',           label: 'Natal' }] },
    'RS': { nome: 'Rio Grande do Sul',  cidades: [{ code: 'RS-PORTO_ALEGRE',     label: 'Porto Alegre' }, { code: 'RS-CAXIAS_DO_SUL', label: 'Caxias do Sul' }] },
    'SC': { nome: 'Santa Catarina',     cidades: [{ code: 'SC-FLORIANOPOLIS',    label: 'Florianópolis' }, { code: 'SC-JOINVILLE', label: 'Joinville' }] },
    'SP': { nome: 'São Paulo',          cidades: [{ code: 'SP-SAO_PAULO',        label: 'São Paulo' }, { code: 'SP-CAMPINAS', label: 'Campinas' }, { code: 'SP-SANTOS', label: 'Santos' }, { code: 'SP-SAO_BERNARDO', label: 'São Bernardo do Campo' }, { code: 'SP-RIBEIRAO_PRETO', label: 'Ribeirão Preto' }, { code: 'SP-SOROCABA', label: 'Sorocaba' }, { code: 'SP-OSASCO', label: 'Osasco' }, { code: 'SP-GUARULHOS', label: 'Guarulhos' }, { code: 'SP-JUNDIAI', label: 'Jundiaí' }, { code: 'SP-BAURU', label: 'Bauru' }] }
  }

  function populateEstadoSelect() {
    var sel = $('estadoSelecionado')
    if (!sel) return
    sel.innerHTML = '<option value="">Selecione o estado</option>'
    Object.entries(ESTADOS_CIDADES)
      .sort(function (a, b) { return a[1].nome.localeCompare(b[1].nome, 'pt-BR') })
      .forEach(function (entry) {
        var opt = document.createElement('option')
        opt.value = entry[0]
        opt.textContent = entry[1].nome
        sel.appendChild(opt)
      })

    var cityCode = state.cityCode || ''
    if (cityCode) {
      var uf = cityCode.split('-')[0]
      sel.value = uf
      updateCidadesSelect(true)
    }
  }

  window.updateCidadesSelect = function (keepValue) {
    var estSel = $('estadoSelecionado')
    var cidSel = $('cidadeSelecionada')
    if (!estSel || !cidSel) return

    var uf = estSel.value
    cidSel.innerHTML = '<option value="">Selecione a cidade</option>'

    if (!uf || !ESTADOS_CIDADES[uf]) return
    ESTADOS_CIDADES[uf].cidades.forEach(function (c) {
      var opt = document.createElement('option')
      opt.value = c.code
      opt.textContent = c.label
      cidSel.appendChild(opt)
    })

    if (keepValue && state.cityCode) {
      cidSel.value = state.cityCode
    }
  }

  window.handleCityChange = function () {
    var sel = $('cidadeSelecionada')
    if (!sel) return
    var city = sel.value || ''
    state.cityCode = city
    loadHolidays().then(renderHolidayTable)
    apiPatch('/agenda/config', { city_code: city }).catch(function (e) {
      console.error('handleCityChange save', e)
    })
  }

  // ===== FERIADOS OFICIAIS =====

  function normalizeHolidayRows(rows) {
    var unique = new Map()
    ;(Array.isArray(rows) ? rows : []).forEach(function (item) {
      var date = String(item && item.date || '').trim()
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return
      if (!unique.has(date)) {
        unique.set(date, {
          date: date,
          name: String(item && item.name || 'Feriado nacional').trim() || 'Feriado nacional',
          scope: String(item && item.scope || 'national').trim() || 'national'
        })
      }
    })
    return Array.from(unique.values()).sort(function (a, b) {
      return a.date.localeCompare(b.date) || a.name.localeCompare(b.name, 'pt-BR')
    })
  }

  function setHolidayState(rows) {
    state.holidays = normalizeHolidayRows(rows)
    state.holidayMap = state.holidays.reduce(function (acc, item) {
      acc[item.date] = item
      return acc
    }, Object.create(null))
  }

  function getHolidayYearsToLoad() {
    var y = new Date().getFullYear()
    return [y - 1, y, y + 1].join(',')
  }

  function getVisibleHolidays(limit) {
    var preferredYear = String(new Date().getFullYear())
    var sameYear = state.holidays.filter(function (item) {
      return String(item.date || '').startsWith(preferredYear + '-')
    })
    var rows = sameYear.length ? sameYear : state.holidays
    return rows.slice(0, limit || 12)
  }

  function loadHolidays() {
    var city = state.cityCode || ''
    var cityParam = city ? '&city=' + encodeURIComponent(city) : ''
    return apiGet('/calendar/holidays?years=' + encodeURIComponent(getHolidayYearsToLoad()) + cityParam)
      .then(function (data) {
        setHolidayState(data && data.holidays)
      })
      .catch(function () {
        setHolidayState([])
      })
  }

  function renderHolidayTable() {
    var tbody = $('feriadosTabela')
    if (!tbody) return

    var limit = state.cityCode ? 40 : 12
    var rows = getVisibleHolidays(limit)
    tbody.innerHTML = ''

    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="3">Nenhum feriado carregado.</td></tr>'
      return
    }

    var today = toISODate(new Date())
    rows.forEach(function (item) {
      var tr = document.createElement('tr')
      var isToday = item.date === today
      tr.innerHTML =
        '<td>' + formatFullDate(item.date) + '</td>' +
        '<td>' + item.name + (isToday ? ' <strong>— hoje</strong>' : '') + '</td>' +
        '<td>' + scopeBadge(item.scope) + '</td>'
      tbody.appendChild(tr)
    })
  }

  // ===== FERIADOS MANUAIS =====

  window.addManualHoliday = function () {
    var dataInput = $('feriadoData')
    var nomeInput = $('feriadoNome')
    if (!dataInput || !nomeInput) return

    var date = dataInput.value.trim()
    var name = nomeInput.value.trim()
    if (!date || !name) { notifyError('Preencha a data e o nome do feriado.'); return }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { notifyError('Data inválida.'); return }

    var list = getManualHolidays()
    if (list.some(function (h) { return h.date === date })) { notifyError('Esta data já foi adicionada.'); return }

    list.push({ date: date, name: name })
    list.sort(function (a, b) { return a.date.localeCompare(b.date) })
    saveManualHolidays(list)

    dataInput.value = ''
    nomeInput.value = ''
    renderManualHolidayTable()
  }

  window.deleteManualHoliday = function (date) {
    var list = getManualHolidays().filter(function (h) { return h.date !== date })
    saveManualHolidays(list)
    renderManualHolidayTable()
  }

  function renderManualHolidayTable() {
    var tbody = $('feriadosManuaisTabela')
    if (!tbody) return

    var list = getManualHolidays()
    tbody.innerHTML = ''

    if (!list.length) {
      tbody.innerHTML = '<tr><td colspan="3">Nenhum feriado municipal cadastrado.</td></tr>'
      return
    }

    var today = toISODate(new Date())
    list.forEach(function (item) {
      var tr = document.createElement('tr')
      var isToday = item.date === today
      tr.innerHTML =
        '<td>' + formatFullDate(item.date) + '</td>' +
        '<td>' + item.name + (isToday ? ' <strong>— hoje</strong>' : '') + '</td>' +
        '<td><button class="danger-btn" onclick="deleteManualHoliday(\'' + item.date + '\')">Remover</button></td>'
      tbody.appendChild(tr)
    })
  }

  // ===== HISTÓRICO =====

  function loadOrders() {
    return apiGet('/agenda/orders')
      .then(function (rows) {
        state.orders = Array.isArray(rows) ? rows : []
      })
      .catch(function () {
        state.orders = []
      })
  }

  function getHistoricOrders() {
    var seen = new Set()
    return state.orders
      .filter(function (order, index) {
        if (order.status !== 'entregue') return false
        var key = String(order.id || '') + '_' + String(order.cliente || '') + '_' + index
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
      .sort(function (a, b) {
        return String(b.updated_at || b.created_at || '').localeCompare(String(a.updated_at || a.created_at || '')) ||
          Number(b.id || 0) - Number(a.id || 0)
      })
  }

  function renderHistoricoTabela() {
    var tbody = $('historicoTabela')
    if (!tbody) return

    var historico = getHistoricOrders()
    var anoAtual = new Date().getFullYear()
    var totalAno = historico.filter(function (r) {
      var raw = r.ent_date || r.updated_at || ''
      var d = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? new Date(raw + 'T00:00:00') : new Date(raw)
      return d.getFullYear() === anoAtual
    }).length

    var counter = $('historicoCounter')
    if (counter) counter.textContent = 'Pedidos entregues em ' + anoAtual + ': ' + totalAno

    tbody.innerHTML = ''

    if (!historico.length) {
      tbody.innerHTML = '<tr><td colspan="4">Nenhum pedido entregue no histórico.</td></tr>'
      return
    }

    historico.forEach(function (row) {
      var tr = document.createElement('tr')
      tr.className = 'status-entregue'
      tr.innerHTML =
        '<td>' + (row.cliente || '-') + '</td>' +
        '<td>' + (row.descricao || '-') + '</td>' +
        '<td>' + formatShortDate(row.ent_date) + '</td>' +
        '<td><span class="status-pill">Entregue</span></td>'
      tbody.appendChild(tr)
    })
  }

  window.limparHistorico = function () {
    var historico = getHistoricOrders()
    if (!historico.length) {
      alert('Nenhum pedido entregue no histórico.')
      return
    }
    var n = historico.length
    var plural = n !== 1
    if (!confirm('Remover ' + n + ' pedido' + (plural ? 's' : '') + ' entregue' + (plural ? 's' : '') + ' do histórico? Esta ação não pode ser desfeita.')) return

    Promise.all(historico.map(function (order) {
      return apiDelete('/agenda/orders/' + order.id).catch(function () {})
    })).then(function () {
      return loadOrders()
    }).then(function () {
      renderHistoricoTabela()
    })
  }

  // ===== INIT =====

  function loadAgendaConfig() {
    return apiGet('/agenda/config')
      .then(function (c) {
        if (c && c.city_code) state.cityCode = c.city_code
      })
      .catch(function () {})
  }

  document.addEventListener('DOMContentLoaded', function () {
    populateEstadoSelect()
    renderManualHolidayTable()

    Promise.all([loadAgendaConfig(), loadOrders()])
      .then(function () {
        if (state.cityCode) {
          var uf = state.cityCode.split('-')[0]
          var estSel = $('estadoSelecionado')
          if (estSel) {
            estSel.value = uf
            updateCidadesSelect(true)
          }
        }
        return loadHolidays()
      })
      .then(function () {
        renderHolidayTable()
        renderHistoricoTabela()
      })
  })
})()
