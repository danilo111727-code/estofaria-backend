(function () {
  var API = ((window.ESTOFARIA_CONFIG && window.ESTOFARIA_CONFIG.API_URL) || window.API_BASE || 'https://estofaria-backend.onrender.com') + '/api'

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
    'AC': { nome: 'Acre',               cidades: [{ code: 'AC-RIO_BRANCO', label: 'Rio Branco' }, { code: 'AC-CRUZEIRO_DO_SUL', label: 'Cruzeiro do Sul' }] },
    'AL': { nome: 'Alagoas',            cidades: [{ code: 'AL-MACEIO', label: 'Maceió' }, { code: 'AL-ARAPIRACA', label: 'Arapiraca' }, { code: 'AL-PALMEIRA_DOS_INDIOS', label: 'Palmeira dos Índios' }] },
    'AM': { nome: 'Amazonas',           cidades: [{ code: 'AM-MANAUS', label: 'Manaus' }, { code: 'AM-PARINTINS', label: 'Parintins' }, { code: 'AM-ITACOATIARA', label: 'Itacoatiara' }, { code: 'AM-MANACAPURU', label: 'Manacapuru' }] },
    'AP': { nome: 'Amapá',              cidades: [{ code: 'AP-MACAPA', label: 'Macapá' }, { code: 'AP-SANTANA', label: 'Santana' }] },
    'BA': { nome: 'Bahia',              cidades: [{ code: 'BA-SALVADOR', label: 'Salvador' }, { code: 'BA-FEIRA_SANTANA', label: 'Feira de Santana' }, { code: 'BA-VITORIA_DA_CONQUISTA', label: 'Vitória da Conquista' }, { code: 'BA-CAMACARI', label: 'Camaçari' }, { code: 'BA-ITABUNA', label: 'Itabuna' }, { code: 'BA-ILHEUS', label: 'Ilhéus' }, { code: 'BA-JEQUIE', label: 'Jequié' }, { code: 'BA-LAURO_DE_FREITAS', label: 'Lauro de Freitas' }, { code: 'BA-BARREIRAS', label: 'Barreiras' }, { code: 'BA-PORTO_SEGURO', label: 'Porto Seguro' }, { code: 'BA-SIMOES_FILHO', label: 'Simões Filho' }, { code: 'BA-PAULO_AFONSO', label: 'Paulo Afonso' }] },
    'CE': { nome: 'Ceará',              cidades: [{ code: 'CE-FORTALEZA', label: 'Fortaleza' }, { code: 'CE-CAUCAIA', label: 'Caucaia' }, { code: 'CE-JUAZEIRO_DO_NORTE', label: 'Juazeiro do Norte' }, { code: 'CE-MARACANAU', label: 'Maracanaú' }, { code: 'CE-SOBRAL', label: 'Sobral' }, { code: 'CE-CRATO', label: 'Crato' }, { code: 'CE-ITAPIPOCA', label: 'Itapipoca' }, { code: 'CE-MARANGUAPE', label: 'Maranguape' }] },
    'DF': { nome: 'Distrito Federal',   cidades: [{ code: 'DF-BRASILIA', label: 'Brasília' }] },
    'ES': { nome: 'Espírito Santo',     cidades: [{ code: 'ES-VITORIA', label: 'Vitória' }, { code: 'ES-VILA_VELHA', label: 'Vila Velha' }, { code: 'ES-SERRA', label: 'Serra' }, { code: 'ES-CARIACICA', label: 'Cariacica' }, { code: 'ES-CACHOEIRO_ITAPEMIRIM', label: 'Cachoeiro de Itapemirim' }, { code: 'ES-LINHARES', label: 'Linhares' }, { code: 'ES-SAO_MATEUS', label: 'São Mateus' }, { code: 'ES-GUARAPARI', label: 'Guarapari' }, { code: 'ES-COLATINA', label: 'Colatina' }] },
    'GO': { nome: 'Goiás',              cidades: [{ code: 'GO-GOIANIA', label: 'Goiânia' }, { code: 'GO-APARECIDA_DE_GOIANIA', label: 'Aparecida de Goiânia' }, { code: 'GO-ANAPOLIS', label: 'Anápolis' }, { code: 'GO-RIO_VERDE', label: 'Rio Verde' }, { code: 'GO-LUZIANIA', label: 'Luziânia' }, { code: 'GO-AGUAS_LINDAS', label: 'Águas Lindas de Goiás' }, { code: 'GO-VALPARAISO', label: 'Valparaíso de Goiás' }, { code: 'GO-TRINDADE', label: 'Trindade' }, { code: 'GO-SENADOR_CANEDO', label: 'Senador Canedo' }, { code: 'GO-ITUMBIARA', label: 'Itumbiara' }] },
    'MA': { nome: 'Maranhão',           cidades: [{ code: 'MA-SAO_LUIS', label: 'São Luís' }, { code: 'MA-IMPERATRIZ', label: 'Imperatriz' }, { code: 'MA-SAO_JOSE_DE_RIBAMAR', label: 'São José de Ribamar' }, { code: 'MA-TIMON', label: 'Timon' }, { code: 'MA-CAXIAS', label: 'Caxias' }, { code: 'MA-CODÓ', label: 'Codó' }, { code: 'MA-BACABAL', label: 'Bacabal' }] },
    'MG': { nome: 'Minas Gerais',       cidades: [{ code: 'MG-BELO_HORIZONTE', label: 'Belo Horizonte' }, { code: 'MG-UBERLANDIA', label: 'Uberlândia' }, { code: 'MG-CONTAGEM', label: 'Contagem' }, { code: 'MG-JUIZ_DE_FORA', label: 'Juiz de Fora' }, { code: 'MG-BETIM', label: 'Betim' }, { code: 'MG-MONTES_CLAROS', label: 'Montes Claros' }, { code: 'MG-RIBEIRAO_DAS_NEVES', label: 'Ribeirão das Neves' }, { code: 'MG-UBERABA', label: 'Uberaba' }, { code: 'MG-GOVERNADOR_VALADARES', label: 'Governador Valadares' }, { code: 'MG-IPATINGA', label: 'Ipatinga' }, { code: 'MG-SETE_LAGOAS', label: 'Sete Lagoas' }, { code: 'MG-DIVINOPOLIS', label: 'Divinópolis' }, { code: 'MG-SANTA_LUZIA', label: 'Santa Luzia' }, { code: 'MG-IBIRITE', label: 'Ibirité' }, { code: 'MG-POCOS_DE_CALDAS', label: 'Poços de Caldas' }, { code: 'MG-PATOS_DE_MINAS', label: 'Patos de Minas' }, { code: 'MG-POUSO_ALEGRE', label: 'Pouso Alegre' }, { code: 'MG-CORONEL_FABRICIANO', label: 'Coronel Fabriciano' }, { code: 'MG-TEOFILO_OTONI', label: 'Teófilo Otoni' }, { code: 'MG-BARBACENA', label: 'Barbacena' }, { code: 'MG-VESPASIANO', label: 'Vespasiano' }, { code: 'MG-ITABIRA', label: 'Itabira' }, { code: 'MG-MURIAE', label: 'Muriaé' }, { code: 'MG-CONSELHEIRO_LAFAIETE', label: 'Conselheiro Lafaiete' }] },
    'MS': { nome: 'Mato Grosso do Sul', cidades: [{ code: 'MS-CAMPO_GRANDE', label: 'Campo Grande' }, { code: 'MS-DOURADOS', label: 'Dourados' }, { code: 'MS-TRES_LAGOAS', label: 'Três Lagoas' }, { code: 'MS-CORUMBA', label: 'Corumbá' }, { code: 'MS-PONTA_PORA', label: 'Ponta Porã' }, { code: 'MS-NAVIRAÍ', label: 'Naviraí' }] },
    'MT': { nome: 'Mato Grosso',        cidades: [{ code: 'MT-CUIABA', label: 'Cuiabá' }, { code: 'MT-VARZEA_GRANDE', label: 'Várzea Grande' }, { code: 'MT-RONDONOPOLIS', label: 'Rondonópolis' }, { code: 'MT-SINOP', label: 'Sinop' }, { code: 'MT-TANGARA_DA_SERRA', label: 'Tangará da Serra' }, { code: 'MT-CACERES', label: 'Cáceres' }, { code: 'MT-SORRISO', label: 'Sorriso' }] },
    'PA': { nome: 'Pará',               cidades: [{ code: 'PA-BELEM', label: 'Belém' }, { code: 'PA-ANANINDEUA', label: 'Ananindeua' }, { code: 'PA-SANTAREM', label: 'Santarém' }, { code: 'PA-MARABA', label: 'Marabá' }, { code: 'PA-CASTANHAL', label: 'Castanhal' }, { code: 'PA-ABAETETUBA', label: 'Abaetetuba' }, { code: 'PA-PARAUAPEBAS', label: 'Parauapebas' }] },
    'PB': { nome: 'Paraíba',            cidades: [{ code: 'PB-JOAO_PESSOA', label: 'João Pessoa' }, { code: 'PB-CAMPINA_GRANDE', label: 'Campina Grande' }, { code: 'PB-SANTA_RITA', label: 'Santa Rita' }, { code: 'PB-PATOS', label: 'Patos' }, { code: 'PB-BAYEUX', label: 'Bayeux' }, { code: 'PB-SOUSA', label: 'Sousa' }] },
    'PE': { nome: 'Pernambuco',         cidades: [{ code: 'PE-RECIFE', label: 'Recife' }, { code: 'PE-CARUARU', label: 'Caruaru' }, { code: 'PE-OLINDA', label: 'Olinda' }, { code: 'PE-JABOATAO', label: 'Jaboatão dos Guararapes' }, { code: 'PE-PETROLINA', label: 'Petrolina' }, { code: 'PE-PAULISTA', label: 'Paulista' }, { code: 'PE-CAMARAJIBE', label: 'Camaragibe' }, { code: 'PE-CABO_DE_SANTO_AGOSTINHO', label: 'Cabo de Santo Agostinho' }, { code: 'PE-GARANHUNS', label: 'Garanhuns' }, { code: 'PE-VITORIA_DE_SANTO_ANTAO', label: 'Vitória de Santo Antão' }] },
    'PI': { nome: 'Piauí',              cidades: [{ code: 'PI-TERESINA', label: 'Teresina' }, { code: 'PI-PARNAIBA', label: 'Parnaíba' }, { code: 'PI-PICOS', label: 'Picos' }, { code: 'PI-PIRIPIRI', label: 'Piripiri' }] },
    'PR': { nome: 'Paraná',             cidades: [{ code: 'PR-CURITIBA', label: 'Curitiba' }, { code: 'PR-LONDRINA', label: 'Londrina' }, { code: 'PR-MARINGA', label: 'Maringá' }, { code: 'PR-PONTA_GROSSA', label: 'Ponta Grossa' }, { code: 'PR-CASCAVEL', label: 'Cascavel' }, { code: 'PR-SAO_JOSE_DOS_PINHAIS', label: 'São José dos Pinhais' }, { code: 'PR-FOZ_DO_IGUACU', label: 'Foz do Iguaçu' }, { code: 'PR-COLOMBO', label: 'Colombo' }, { code: 'PR-GUARAPUAVA', label: 'Guarapuava' }, { code: 'PR-PARANAGUA', label: 'Paranaguá' }, { code: 'PR-ARAUCARIA', label: 'Araucária' }, { code: 'PR-TOLEDO', label: 'Toledo' }, { code: 'PR-APUCARANA', label: 'Apucarana' }, { code: 'PR-CAMPO_LARGO', label: 'Campo Largo' }, { code: 'PR-ALMIRANTE_TAMANDARE', label: 'Almirante Tamandaré' }, { code: 'PR-UMUARAMA', label: 'Umuarama' }, { code: 'PR-CAMPO_MOURAO', label: 'Campo Mourão' }, { code: 'PR-SARANDI', label: 'Sarandi' }] },
    'RJ': { nome: 'Rio de Janeiro',     cidades: [{ code: 'RJ-RIO_DE_JANEIRO', label: 'Rio de Janeiro' }, { code: 'RJ-SAO_GONCALO', label: 'São Gonçalo' }, { code: 'RJ-DUQUE_CAXIAS', label: 'Duque de Caxias' }, { code: 'RJ-NOVA_IGUACU', label: 'Nova Iguaçu' }, { code: 'RJ-NITEROI', label: 'Niterói' }, { code: 'RJ-BELFORD_ROXO', label: 'Belford Roxo' }, { code: 'RJ-SAO_JOAO_DE_MERITI', label: 'São João de Meriti' }, { code: 'RJ-CAMPOS', label: 'Campos dos Goytacazes' }, { code: 'RJ-PETROPOLIS', label: 'Petrópolis' }, { code: 'RJ-VOLTA_REDONDA', label: 'Volta Redonda' }, { code: 'RJ-MAGE', label: 'Magé' }, { code: 'RJ-ITABORAI', label: 'Itaboraí' }, { code: 'RJ-MESQUITA', label: 'Mesquita' }, { code: 'RJ-NOVA_FRIBURGO', label: 'Nova Friburgo' }, { code: 'RJ-BARRA_MANSA', label: 'Barra Mansa' }, { code: 'RJ-MARICA', label: 'Maricá' }, { code: 'RJ-ANGRA_DOS_REIS', label: 'Angra dos Reis' }, { code: 'RJ-TERESOPOLIS', label: 'Teresópolis' }, { code: 'RJ-QUEIMADOS', label: 'Queimados' }] },
    'RN': { nome: 'Rio Grande do Norte', cidades: [{ code: 'RN-NATAL', label: 'Natal' }, { code: 'RN-MOSSORO', label: 'Mossoró' }, { code: 'RN-PARNAMIRIM', label: 'Parnamirim' }, { code: 'RN-SAO_GONCALO_DO_AMARANTE', label: 'São Gonçalo do Amarante' }, { code: 'RN-CEARA_MIRIM', label: 'Ceará-Mirim' }] },
    'RO': { nome: 'Rondônia',           cidades: [{ code: 'RO-PORTO_VELHO', label: 'Porto Velho' }, { code: 'RO-JI_PARANA', label: 'Ji-Paraná' }, { code: 'RO-ARIQUEMES', label: 'Ariquemes' }, { code: 'RO-VILHENA', label: 'Vilhena' }] },
    'RR': { nome: 'Roraima',            cidades: [{ code: 'RR-BOA_VISTA', label: 'Boa Vista' }, { code: 'RR-RORAINOPOLIS', label: 'Rorainópolis' }] },
    'RS': { nome: 'Rio Grande do Sul',  cidades: [{ code: 'RS-PORTO_ALEGRE', label: 'Porto Alegre' }, { code: 'RS-CAXIAS_DO_SUL', label: 'Caxias do Sul' }, { code: 'RS-CANOAS', label: 'Canoas' }, { code: 'RS-PELOTAS', label: 'Pelotas' }, { code: 'RS-SANTA_MARIA', label: 'Santa Maria' }, { code: 'RS-GRAVATAI', label: 'Gravataí' }, { code: 'RS-VIAMAOO', label: 'Viamão' }, { code: 'RS-NOVO_HAMBURGO', label: 'Novo Hamburgo' }, { code: 'RS-SAO_LEOPOLDO', label: 'São Leopoldo' }, { code: 'RS-RIO_GRANDE', label: 'Rio Grande' }, { code: 'RS-ALVORADA', label: 'Alvorada' }, { code: 'RS-PASSO_FUNDO', label: 'Passo Fundo' }, { code: 'RS-SAPUCAIA_DO_SUL', label: 'Sapucaia do Sul' }, { code: 'RS-URUGUAIANA', label: 'Uruguaiana' }, { code: 'RS-SANTA_CRUZ_DO_SUL', label: 'Santa Cruz do Sul' }, { code: 'RS-CACHOEIRINHA', label: 'Cachoeirinha' }, { code: 'RS-BAGE', label: 'Bagé' }, { code: 'RS-ERECHIM', label: 'Erechim' }] },
    'SC': { nome: 'Santa Catarina',     cidades: [{ code: 'SC-FLORIANOPOLIS', label: 'Florianópolis' }, { code: 'SC-JOINVILLE', label: 'Joinville' }, { code: 'SC-BLUMENAU', label: 'Blumenau' }, { code: 'SC-SAO_JOSE', label: 'São José' }, { code: 'SC-CHAPECO', label: 'Chapecó' }, { code: 'SC-ITAJAI', label: 'Itajaí' }, { code: 'SC-CRICIUMA', label: 'Criciúma' }, { code: 'SC-JARAGUA_DO_SUL', label: 'Jaraguá do Sul' }, { code: 'SC-LAGES', label: 'Lages' }, { code: 'SC-PALHOCA', label: 'Palhoça' }, { code: 'SC-BRUSQUE', label: 'Brusque' }, { code: 'SC-TUBARAO', label: 'Tubarão' }, { code: 'SC-BALNEARIO_CAMBORIU', label: 'Balneário Camboriú' }, { code: 'SC-SAOFRANCISCO_DO_SUL', label: 'São Francisco do Sul' }] },
    'SE': { nome: 'Sergipe',            cidades: [{ code: 'SE-ARACAJU', label: 'Aracaju' }, { code: 'SE-NOSSA_SENHORA_DO_SOCORRO', label: 'Nossa Senhora do Socorro' }, { code: 'SE-LAGARTO', label: 'Lagarto' }, { code: 'SE-ITABAIANA', label: 'Itabaiana' }] },
    'SP': { nome: 'São Paulo',          cidades: [{ code: 'SP-SAO_PAULO', label: 'São Paulo' }, { code: 'SP-GUARULHOS', label: 'Guarulhos' }, { code: 'SP-CAMPINAS', label: 'Campinas' }, { code: 'SP-SAO_BERNARDO', label: 'São Bernardo do Campo' }, { code: 'SP-SANTO_ANDRE', label: 'Santo André' }, { code: 'SP-OSASCO', label: 'Osasco' }, { code: 'SP-SAO_JOSE_DOS_CAMPOS', label: 'São José dos Campos' }, { code: 'SP-RIBEIRAO_PRETO', label: 'Ribeirão Preto' }, { code: 'SP-SOROCABA', label: 'Sorocaba' }, { code: 'SP-MAUA', label: 'Mauá' }, { code: 'SP-SAO_JOSE_RIO_PRETO', label: 'São José do Rio Preto' }, { code: 'SP-MOGI_DAS_CRUZES', label: 'Mogi das Cruzes' }, { code: 'SP-SANTOS', label: 'Santos' }, { code: 'SP-DIADEMA', label: 'Diadema' }, { code: 'SP-JUNDIAI', label: 'Jundiaí' }, { code: 'SP-PIRACICABA', label: 'Piracicaba' }, { code: 'SP-CARAPICUIBA', label: 'Carapicuíba' }, { code: 'SP-BAURU', label: 'Bauru' }, { code: 'SP-ITAQUAQUECETUBA', label: 'Itaquaquecetuba' }, { code: 'SP-SAO_CAETANO', label: 'São Caetano do Sul' }, { code: 'SP-FRANCA', label: 'Franca' }, { code: 'SP-PRAIA_GRANDE', label: 'Praia Grande' }, { code: 'SP-BARUERI', label: 'Barueri' }, { code: 'SP-SUZANO', label: 'Suzano' }, { code: 'SP-TABOAO_DA_SERRA', label: 'Taboão da Serra' }, { code: 'SP-LIMEIRA', label: 'Limeira' }, { code: 'SP-SAO_CARLOS', label: 'São Carlos' }, { code: 'SP-AMERICANA', label: 'Americana' }, { code: 'SP-ARARAQUARA', label: 'Araraquara' }, { code: 'SP-MARILIA', label: 'Marília' }, { code: 'SP-PRESIDENTE_PRUDENTE', label: 'Presidente Prudente' }, { code: 'SP-COTIA', label: 'Cotia' }, { code: 'SP-INDAIATUBA', label: 'Indaiatuba' }, { code: 'SP-EMBU_DAS_ARTES', label: 'Embu das Artes' }, { code: 'SP-HORTOLANDIA', label: 'Hortolândia' }, { code: 'SP-SUMARE', label: 'Sumaré' }, { code: 'SP-JACAREI', label: 'Jacareí' }, { code: 'SP-TAUBATE', label: 'Taubaté' }, { code: 'SP-BRAGANCA_PAULISTA', label: 'Bragança Paulista' }, { code: 'SP-ATIBAIA', label: 'Atibaia' }, { code: 'SP-ITAPETININGA', label: 'Itapetininga' }, { code: 'SP-BOTUCATU', label: 'Botucatu' }, { code: 'SP-ARARAS', label: 'Araras' }, { code: 'SP-CATANDUVA', label: 'Catanduva' }, { code: 'SP-SERTAOZINHO', label: 'Sertãozinho' }, { code: 'SP-REGISTRO', label: 'Registro' }] },
    'TO': { nome: 'Tocantins',          cidades: [{ code: 'TO-PALMAS', label: 'Palmas' }, { code: 'TO-ARAGUAINA', label: 'Araguaína' }, { code: 'TO-GURUPI', label: 'Gurupi' }, { code: 'TO-PORTO_NACIONAL', label: 'Porto Nacional' }] }
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

  window.addEventListener('message', function (e) {
    if (!e.data || e.data.type !== 'estofaria-ptr-refresh') return
    Promise.all([loadAgendaConfig(), loadOrders(), loadHolidays()])
      .then(function () {
        renderHolidayTable()
        renderManualHolidayTable()
        renderHistoricoTabela()
      })
      .catch(function () {})
      .finally(function () {
        try { window.parent.postMessage({ type: 'estofaria-ptr-done' }, '*') } catch (_) {}
      })
  })
})()
