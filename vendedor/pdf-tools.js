window.VendedorPDF = (function(){
  const API = (window.API_BASE || '') + '/api'

  function money(v){
    return Number(v || 0).toLocaleString('pt-BR', { style:'currency', currency:'BRL' })
  }

  function centsToMoney(v){
    return money(Number(v || 0) / 100)
  }

  function getToken(){
    try{
      return (
        localStorage.getItem('auth_token') ||
        localStorage.getItem('token') ||
        localStorage.getItem('estofaria_token') ||
        ''
      )
    }catch(_){
      return ''
    }
  }

  function authHeaders(extra = {}){
    const headers = new Headers(extra || {})
    const token = getToken()
    if(token && !headers.get('Authorization')) headers.set('Authorization', 'Bearer ' + token)
    if(!headers.get('Accept')) headers.set('Accept', 'application/json')
    return headers
  }

  function parseHex(hex){
    const clean = String(hex || '#4c64a8').replace('#','')
    const full = clean.length === 3 ? clean.split('').map(x=>x+x).join('') : clean.padEnd(6, '0').slice(0,6)
    return [parseInt(full.slice(0,2),16), parseInt(full.slice(2,4),16), parseInt(full.slice(4,6),16)]
  }

  function safeFileName(text){
    return String(text || 'documento')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9-_]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .toLowerCase()
  }

  function escapeHtml(text){
    return String(text || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;')
  }

  function openPdfPreview(doc, fileName, title){
    const blob = doc.output('blob')
    const url = URL.createObjectURL(blob)

    // Usa janela pré-aberta (capturada antes de chamadas assíncronas) para evitar
    // bloqueio de popup em iOS Safari e Android Chrome após awaits
    let previewWindow = window._pendingPdfWindow || null
    window._pendingPdfWindow = null

    // Segurança: no iOS/Safari, window.open() capturado após awaits pode retornar
    // a própria janela corrente. Escrever sobre ela apaga a página (tela branca).
    function isSafePopup(w){
      if(!w || w.closed) return false
      try{ return w !== window && w !== window.top && w !== window.parent }catch(_){ return false }
    }

    if(!isSafePopup(previewWindow)){
      previewWindow = window.open('', '_blank')
    }
    // Segunda verificação após o segundo window.open
    if(!isSafePopup(previewWindow)) previewWindow = null

    if(!previewWindow){
      window.open(url, '_blank', 'noopener')
      setTimeout(() => {
        try{ URL.revokeObjectURL(url) }catch(_){ }
      }, 60000)
      return { ok:true, mode:'fallback-open', fileName }
    }

    const safeTitle = escapeHtml(title || fileName || 'PDF')
    const safeFileNameText = escapeHtml(fileName || 'documento.pdf')

    previewWindow.document.open()
    previewWindow.document.write(`<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${safeTitle}</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; font-family: Arial, sans-serif; background: #0f172a; color: #e2e8f0; }
    .topbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 14px; background: #1e293b; }
    .title { font-size: 14px; font-weight: 700; }
    .subtitle { font-size: 12px; opacity: .75; }
    .actions { display: flex; align-items: center; gap: 8px; }
    .btn { border: 0; border-radius: 999px; padding: 10px 14px; font: inherit; cursor: pointer; }
    .btn-primary { background: #4a67a1; color: #fff; }
    .btn-light { background: #e2e8f0; color: #0f172a; }
    iframe { display: block; width: 100%; height: calc(100vh - 60px); border: 0; background: #cbd5e1; }
  </style>
</head>
<body>
  <div class="topbar">
    <div>
      <div class="title">${safeTitle}</div>
      <div class="subtitle">Visualização do arquivo ${safeFileNameText}</div>
    </div>
    <div class="actions">
      <button class="btn btn-light" id="downloadBtn">Baixar</button>
      <button class="btn btn-primary" id="closeBtn">Fechar</button>
    </div>
  </div>
  <iframe id="pdfFrame" title="${safeTitle}"></iframe>
  <script>
    const pdfUrl = ${JSON.stringify(url)}
    const fileName = ${JSON.stringify(fileName || 'documento.pdf')}
    const frame = document.getElementById('pdfFrame')
    frame.src = pdfUrl + '#toolbar=1&navpanes=0&scrollbar=1&view=FitH'
    document.getElementById('downloadBtn').addEventListener('click', () => {
      const link = document.createElement('a')
      link.href = pdfUrl
      link.download = fileName
      link.rel = 'noopener'
      document.body.appendChild(link)
      link.click()
      link.remove()
    })
    document.getElementById('closeBtn').addEventListener('click', () => window.close())
    window.addEventListener('beforeunload', () => {
      try{ URL.revokeObjectURL(pdfUrl) }catch(_){ }
    })
  <\/script>
</body>
</html>`)
    previewWindow.document.close()
    return { ok:true, mode:'preview', fileName }
  }

  function loadPdfConfig(type){
    try{
      const arr = JSON.parse(localStorage.getItem('pdf_config_v1') || '[]')
      return Array.isArray(arr) ? (arr.find(c => c.type === type) || null) : null
    }catch(_){ return null }
  }

  function defaultTemplate(type){
    const pedido = type === 'pedido'
    return {
      companyName: 'Estofaria Digital',
      documentTitle: pedido ? 'Pedido' : 'Orçamento',
      subtitle: pedido ? 'Documento de produção e entrega' : 'Proposta comercial personalizada',
      primaryColor: pedido ? '#1d4ed8' : '#4c64a8',
      secondaryColor: '#f3f4f6',
      footerText: 'Obrigado pela preferência.',
      notesTitle: 'Observações',
      notesText: pedido ? 'Pedido confirmado. Verificar tecido, medidas e prazo.' : 'Orçamento sujeito a confirmação de medidas e tecido.',
      termsText: pedido ? 'Produção iniciada após confirmação.' : 'Valores podem variar conforme personalização.',
      pixText: '',
      showPix: false,
      logoDataUrl: '',
      preset: pedido ? 'pedido' : 'orcamento'
    }
  }

  function getQuotePdfOverride(input){
    const payload = (input && input.payload) || {}
    const override = payload.pdf_override
    return override && typeof override === 'object' ? override : {}
  }

  async function apiJson(path, init = {}){
    const res = await fetch(API + path, {
      cache:'no-store',
      ...init,
      headers: authHeaders(init.headers || {})
    })
    if(!res.ok){
      const err = await res.json().catch(()=>({}))
      throw new Error(err.error || ('Erro ' + res.status))
    }
    return await res.json()
  }

  async function fetchTemplates(type){
    return await apiJson('/pdf-templates' + (type ? ('?type=' + encodeURIComponent(type)) : ''))
  }

  async function fetchDefaultTemplate(type){
    try{
      const row = await apiJson('/pdf-templates/default/' + encodeURIComponent(type))
      return { ...defaultTemplate(type), ...(row.config || {}), id: row.id, name: row.name, is_default: row.is_default }
    }catch(_){
      return { ...defaultTemplate(type) }
    }
  }

  async function saveTemplate(payload){
    return await apiJson('/pdf-templates', {
      method:'POST',
      headers:{ 'Content-Type':'application/json' },
      body: JSON.stringify(payload)
    })
  }

  async function updateTemplate(id, payload){
    return await apiJson('/pdf-templates/' + id, {
      method:'PATCH',
      headers:{ 'Content-Type':'application/json' },
      body: JSON.stringify(payload)
    })
  }

  async function deleteTemplate(id){
    return await apiJson('/pdf-templates/' + id, { method:'DELETE' })
  }

  async function getQuote(id){
    return await apiJson('/quotes/' + id)
  }

  function calcModelSubtotal(m){
    return Number(m.preco || 0) + (Array.isArray(m.itens) ? m.itens.reduce((t,i)=>t + Number(i.valor || 0), 0) : 0)
  }

  function normalizeQuote(input, forcedType){
    const payload = input.payload || {}
    const modelos = Array.isArray(payload.modelos) ? payload.modelos : []
    const total = Number(payload.total || 0) || (Number(input.total_cents || 0) / 100)
    return {
      id: input.id,
      cliente:   input.cliente || payload.cliente || 'Cliente',
      telefone:  payload.telefone  || '',
      endereco:  payload.endereco  || '',
      observacao: payload.observacao || '',
      status: forcedType || input.status || 'orcamento',
      created_at: payload.created_at_local || input.created_at || new Date().toLocaleString('pt-BR'),
      modelos,
      total,
      total_cents: Math.round(total * 100),
      payload,
      pdf_override: getQuotePdfOverride(input)
    }
  }

  function resolveLogoDataUrl(template){
    return String(template?.logoDataUrl || template?.logo || '').trim()
  }

  function resolveModelImageDataUrl(model){
    const direct = model?.image_data_url ?? model?.imageDataUrl ?? model?.photo_data_url ?? model?.photoDataUrl ?? model?.foto_data_url ?? model?.fotoDataUrl ?? model?.image ?? model?.photo ?? model?.foto ?? ''
    if(typeof direct === 'string' && direct.trim()) return direct.trim()

    const storageKeys = [
      'precificacao_modelos',
      'catalogo_modelos',
      'itens_personalizacao_models_cache_v1'
    ]

    const modelId = String(model?.model_id ?? model?.id ?? '').trim()
    const modelName = String(model?.modelo ?? model?.name ?? '').trim().toLowerCase()

    for(const key of storageKeys){
      try{
        const raw = JSON.parse(localStorage.getItem(key) || '[]')
        const arr = Array.isArray(raw) ? raw : (Array.isArray(raw?.models) ? raw.models : [])
        const found = arr.find(item => {
          const itemId = String(item?.id ?? item?._id ?? item?.model_id ?? '').trim()
          const itemName = String(item?.name ?? item?.nome ?? item?.modelo ?? '').trim().toLowerCase()
          return (modelId && itemId && itemId === modelId) || (modelName && itemName && itemName === modelName)
        })
        const fallback = found?.image_data_url ?? found?.imageDataUrl ?? found?.photo_data_url ?? found?.photoDataUrl ?? found?.foto_data_url ?? found?.fotoDataUrl ?? found?.image ?? found?.photo ?? found?.foto ?? ''
        if(typeof fallback === 'string' && fallback.trim()) return fallback.trim()
      }catch(_){ }
    }

    return ''
  }

  function triggerPdfDownload(doc, fileName){
    const blob = doc.output('blob')
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = fileName
    link.rel = 'noopener'
    link.style.display = 'none'
    document.body.appendChild(link)
    link.click()
    setTimeout(() => {
      try{ link.remove() }catch(_){ }
      try{ URL.revokeObjectURL(url) }catch(_){ }
    }, 2000)
    return { ok:true, fileName }
  }

  function buildPdf(quoteInput, templateInput, override = {}){
    const { jsPDF } = window.jspdf
    const quote = normalizeQuote(quoteInput, override.type)
    const recordOverride = getQuotePdfOverride(quoteInput)
    const template = { ...defaultTemplate(quote.status), ...(templateInput || {}), ...(recordOverride || {}), ...(override || {}) }
    const cfg = loadPdfConfig(quote.status) || {}
    const hasCfg = !!(cfg.nomeFantasia || cfg.logo)
    const logoDataUrl = (cfg.logo && cfg.logo.trim()) ? cfg.logo.trim() : resolveLogoDataUrl(template)
    const logoFormat = /data:image\/jpe?g/i.test(logoDataUrl) ? 'JPEG' : 'PNG'
    const doc = new jsPDF({ unit:'mm', format:'a4' })
    const emitidoEm = quote.created_at || new Date().toLocaleString('pt-BR')
    const W = 210
    const H = 297
    const margin = 14
    const lw = W - margin * 2
    const [pr, pg, pb] = parseHex(template.primaryColor)
    const [sr, sg, sb] = parseHex(template.secondaryColor)
    let y = 0

    // ── CABEÇALHO ─────────────────────────────────────────────────────────────
    const headerH = 46
    doc.setFillColor(pr, pg, pb)
    doc.rect(0, 0, W, headerH, 'F')

    const logoSize = 28
    const logoY = (headerH - logoSize) / 2
    if(logoDataUrl){
      try{ doc.addImage(logoDataUrl, logoFormat, margin, logoY, logoSize, logoSize) }catch(_){
        try{ doc.addImage(logoDataUrl, logoFormat === 'PNG' ? 'JPEG' : 'PNG', margin, logoY, logoSize, logoSize) }catch(__){}
      }
    }
    const textX = logoDataUrl ? margin + logoSize + 5 : margin

    const cfgName     = cfg.nomeFantasia || template.companyName || 'Estofaria'
    const cfgSubline  = cfg.razaoSocial  || (cfg.nomeFantasia ? '' : (template.subtitle || ''))
    const cfgContact  = [cfg.cnpj, cfg.telefone || cfg.whatsapp, cfg.email].filter(Boolean).join('   ·   ')
    const headerLines = [cfgSubline, cfgContact].filter(Boolean).length

    doc.setTextColor(255, 255, 255)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(headerLines >= 2 ? 16 : 20)
    const nameY = headerLines >= 2 ? 16 : 22
    doc.text(cfgName, textX, nameY)

    if(cfgSubline){
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(9)
      doc.setTextColor(200, 215, 240)
      doc.text(cfgSubline, textX, nameY + 7)
    }
    if(cfgContact){
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(7.5)
      doc.setTextColor(170, 190, 225)
      doc.text(cfgContact, textX, nameY + (cfgSubline ? 14 : 7))
    }

    // Data discreta no canto superior direito
    doc.setFontSize(8)
    doc.setTextColor(170, 190, 225)
    doc.text('Emitido em: ' + emitidoEm, W - margin, 10, { align:'right' })

    y = headerH + 8

    const ensureSpace = (amount = 12) => {
      if(y + amount > H - 24){ doc.addPage(); y = 18 }
    }

    // ── CARTÃO DE IDENTIFICAÇÃO ────────────────────────────────────────────────
    const hasExtra = !!(quote.telefone || quote.endereco)
    const infoH = hasExtra ? 34 : 26
    doc.setFillColor(sr, sg, sb)
    doc.roundedRect(margin, y, lw, infoH, 3, 3, 'F')

    // Label "CLIENTE"
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.5)
    doc.setTextColor(140, 140, 150)
    doc.text('CLIENTE', margin + 4, y + 6)

    // Nome do cliente em destaque
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(14)
    doc.setTextColor(pr, pg, pb)
    doc.text(String(quote.cliente || 'Cliente'), margin + 4, y + 13)

    if(hasExtra){
      const extraParts = []
      if(quote.telefone) extraParts.push('Tel: ' + quote.telefone)
      if(quote.endereco) extraParts.push(quote.endereco)
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(8.5)
      doc.setTextColor(90, 90, 100)
      doc.text(extraParts.join('   '), margin + 4, y + 20)
    }

    // Coluna direita: data · validade · nº
    const rx = W - margin - 4
    const ry = y + 5
    const quoteNum = quote.id ? String(quote.id) : ''

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.5)
    doc.setTextColor(140, 140, 150)
    doc.text('DATA', rx, ry, { align:'right' })
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.setTextColor(40, 40, 50)
    doc.text(String(emitidoEm).split(' ')[0] || emitidoEm, rx, ry + 5, { align:'right' })

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.5)
    doc.setTextColor(140, 140, 150)
    doc.text('VALIDADE', rx, ry + 11, { align:'right' })
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.setTextColor(40, 40, 50)
    doc.text(String(cfg.validadeOrcamento || '7 dias'), rx, ry + 16, { align:'right' })

    if(quoteNum){
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(7.5)
      doc.setTextColor(140, 140, 150)
      doc.text('Nº ORÇAMENTO', rx, ry + 22, { align:'right' })
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(9)
      doc.setTextColor(40, 40, 50)
      doc.text('#' + quoteNum, rx, ry + 27, { align:'right' })
    }

    y += infoH + 10

    // ── MENSAGEM INICIAL ──────────────────────────────────────────────────────
    if(cfg.mensagemInicial){
      ensureSpace(20)
      const miLines = doc.splitTextToSize(String(cfg.mensagemInicial), lw - 8)
      const miH = 10 + miLines.length * 4.5
      doc.setFillColor(245, 247, 252)
      doc.setDrawColor(pr, pg, pb)
      doc.setLineWidth(0.4)
      doc.roundedRect(margin, y, lw, miH, 2, 2, 'FD')
      doc.setFont('helvetica', 'italic')
      doc.setFontSize(9)
      doc.setTextColor(60, 70, 100)
      let miY = y + 6
      miLines.forEach(line => { ensureSpace(5); doc.text(line, margin + 4, miY); miY += 4.5 })
      y = miY + 4
    }

    // ── INFO DO PEDIDO (toggles) ──────────────────────────────────────────────
    if(quote.status === 'pedido'){
      const qPayload = quoteInput.payload || {}
      const infoRows = []
      if(cfg.showDataPedido !== false && quote.created_at)
        infoRows.push(['Data do pedido', String(quote.created_at).split(' ')[0] || quote.created_at])
      if(cfg.showDataEntrega !== false){
        const de = qPayload.data_entrega || qPayload.dataEntrega || ''
        if(de) infoRows.push(['Data de entrega', de])
      }
      if(cfg.showMeioFechamento !== false){
        const mf = qPayload.meio_fechamento || qPayload.meioFechamento || ''
        if(mf) infoRows.push(['Meio de fechamento', mf])
      }
      if(cfg.showFormaPagamento !== false){
        const fp = qPayload.forma_pagamento || qPayload.formaPagamento || ''
        if(fp) infoRows.push(['Forma de pagamento', fp])
      }
      if(cfg.showValorEntrada !== false){
        const ve = qPayload.valor_entrada || qPayload.valorEntrada || 0
        if(ve) infoRows.push(['Valor de entrada', money(ve)])
      }
      if(cfg.showSaldoRestante !== false){
        const sr = qPayload.saldo_restante || qPayload.saldoRestante || 0
        if(sr) infoRows.push(['Saldo restante', money(sr)])
      }
      if(cfg.showQuantidadeParcelas !== false){
        const qp = qPayload.qtd_parcelas || qPayload.quantidade_parcelas || qPayload.quantidadeParcelas || ''
        if(qp) infoRows.push(['Qtd. parcelas', String(qp)])
      }
      if(cfg.showNomeVendedor !== false){
        const nv = qPayload.nome_vendedor || qPayload.nomeVendedor || ''
        if(nv) infoRows.push(['Vendedor', nv])
      }
      if(infoRows.length){
        ensureSpace(infoRows.length * 6 + 8)
        const irH = infoRows.length * 6 + 6
        doc.setFillColor(sr, sg, sb)
        doc.roundedRect(margin, y, lw, irH, 2, 2, 'F')
        let iry = y + 6
        infoRows.forEach(([label, val]) => {
          doc.setFont('helvetica', 'normal')
          doc.setFontSize(8.5)
          doc.setTextColor(100, 100, 110)
          doc.text(label + ':', margin + 4, iry)
          doc.setFont('helvetica', 'bold')
          doc.setTextColor(40, 40, 50)
          doc.text(val, W - margin - 4, iry, { align:'right' })
          iry += 6
        })
        y = iry + 4
      }
    }

    // ── SEÇÃO: PRODUTOS ───────────────────────────────────────────────────────
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.setTextColor(pr, pg, pb)
    doc.text('PRODUTOS / SERVIÇOS', margin, y)
    doc.setDrawColor(pr, pg, pb)
    doc.setLineWidth(0.5)
    doc.line(margin, y + 1.8, margin + 52, y + 1.8)
    y += 7

    if(!quote.modelos.length){
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(10)
      doc.setTextColor(140, 140, 140)
      doc.text('Nenhum produto informado.', margin, y)
      y += 8
    }

    quote.modelos.forEach((m, idx) => {
      const modelImageDataUrl = resolveModelImageDataUrl(m)
      const modelImageFormat = /data:image\/jpe?g/i.test(modelImageDataUrl) ? 'JPEG' : 'PNG'
      const hasMetragem = Number(m.metragem || 0) > 0
      const subtotal = calcModelSubtotal(m)
      const hasImg = !!modelImageDataUrl
      const imgW = 26, imgH = 26

      // Cabeçalho do produto (strip colorida)
      ensureSpace(20)
      const stripH = 10
      doc.setFillColor(pr, pg, pb)
      doc.roundedRect(margin, y, lw, stripH, 2, 2, 'F')
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(10.5)
      doc.setTextColor(255, 255, 255)
      doc.text(String(m.modelo || ('Produto ' + (idx + 1))), margin + 4, y + 7)
      doc.text(money(subtotal), W - margin - 4, y + 7, { align:'right' })
      y += stripH + 2

      // Corpo do produto — foto à esquerda se disponível
      const cx = hasImg ? margin + imgW + 6 : margin + 4
      const cw = lw - (hasImg ? imgW + 6 : 4)

      if(hasImg){
        ensureSpace(imgH + 4)
        try{
          doc.addImage(modelImageDataUrl, modelImageFormat, margin + 2, y + 1, imgW, imgH)
        }catch(_){
          try{ doc.addImage(modelImageDataUrl, modelImageFormat === 'PNG' ? 'JPEG' : 'PNG', margin + 2, y + 1, imgW, imgH) }catch(__){}
        }
      }

      // Metragem + valor base
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(9)
      doc.setTextColor(80, 80, 90)
      const metValStr = [
        hasMetragem ? 'Metragem: ' + m.metragem + 'm' : '',
        'Valor base: ' + money(m.preco || 0)
      ].filter(Boolean).join('   ·   ')
      doc.text(metValStr, cx, y + 6)

      // Descrição
      const descStr = String(m.descricao || m.description || '').trim()
      let dy = y + 12
      if(descStr){
        doc.setFont('helvetica', 'normal')
        doc.setFontSize(8)
        doc.setTextColor(110, 110, 120)
        doc.splitTextToSize(descStr, cw - 4).forEach(line => {
          ensureSpace(5); doc.text(line, cx, dy); dy += 4
        })
        dy += 1
      }

      if(hasImg) y = Math.max(dy, y + imgH + 4)
      else y = dy

      // Itens incluídos no modelo
      const incl = Array.isArray(m.itens_incluidos) ? m.itens_incluidos.filter(Boolean) : []
      if(incl.length){
        ensureSpace(6)
        doc.setFont('helvetica', 'bold')
        doc.setFontSize(8)
        doc.setTextColor(pr, pg, pb)
        doc.splitTextToSize('Incluso: ' + incl.join(' / '), lw - 8).forEach(line => {
          doc.text(line, margin + 4, y); y += 4.5
        })
        doc.setTextColor(20, 20, 20)
      }

      // Personalizações
      if(Array.isArray(m.itens) && m.itens.length){
        m.itens.forEach(item => {
          ensureSpace(6)
          const isIncluido = item.incluido_no_modelo === true
          doc.setFont('helvetica', 'normal')
          doc.setFontSize(9)
          doc.setTextColor(65, 65, 75)
          doc.text('+ ' + String(item.nome || '') + (isIncluido ? ' (incluído)' : ''), margin + 4, y)
          if(!isIncluido){
            doc.setFont('helvetica', 'bold')
            doc.setTextColor(40, 40, 50)
            doc.text(money(item.valor || 0), W - margin - 4, y, { align:'right' })
          }
          y += 5.5
        })
      }

      // Observação do modelo
      const obsModelo = String(m.observacao || m.obs || '').trim()
      if(obsModelo){
        ensureSpace(8)
        doc.setFont('helvetica', 'italic')
        doc.setFontSize(8)
        doc.setTextColor(130, 130, 130)
        doc.splitTextToSize('Obs: ' + obsModelo, lw - 8).forEach(line => {
          ensureSpace(5); doc.text(line, margin + 4, y); y += 4.5
        })
      }

      // Separador entre produtos
      y += 4
      if(idx < quote.modelos.length - 1){
        doc.setDrawColor(225, 228, 240)
        doc.setLineWidth(0.3)
        doc.line(margin, y, W - margin, y)
        y += 5
      }
    })

    // ── TOTAL ─────────────────────────────────────────────────────────────────
    ensureSpace(32)
    y += 6

    const qPayload = quoteInput.payload || {}
    const totalAvista = Number(qPayload.total_avista || 0) || quote.total
    const totalCartao = Number(qPayload.total_cartao || 0)
    const showCartao  = totalCartao > 0 && Math.abs(totalCartao - totalAvista) > 0.01
    const totalBlockH = showCartao ? 26 : 16

    doc.setFillColor(pr, pg, pb)
    doc.roundedRect(margin, y, lw, totalBlockH, 3, 3, 'F')
    doc.setTextColor(255, 255, 255)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(13)
    doc.text('Total à vista', margin + 5, y + (showCartao ? 10 : 10))
    doc.text(money(totalAvista), W - margin - 5, y + (showCartao ? 10 : 10), { align:'right' })
    if(showCartao){
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(10)
      doc.setTextColor(200, 215, 240)
      doc.text('Total no cartão', margin + 5, y + 20)
      doc.text(money(totalCartao), W - margin - 5, y + 20, { align:'right' })
    }
    y += totalBlockH + 10

    doc.setTextColor(20, 20, 20)

    // ── OBSERVAÇÃO DO PEDIDO ──────────────────────────────────────────────────
    if(quote.observacao){
      ensureSpace(20)
      doc.setFillColor(248, 249, 252)
      doc.setDrawColor(225, 228, 240)
      doc.setLineWidth(0.3)
      const obsLines = doc.splitTextToSize(quote.observacao, lw - 8)
      const obsBoxH = 14 + obsLines.length * 4.5
      doc.roundedRect(margin, y, lw, obsBoxH, 2, 2, 'FD')
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(8.5)
      doc.setTextColor(80, 80, 90)
      doc.text('Observações', margin + 4, y + 6)
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(9)
      doc.setTextColor(60, 60, 70)
      let oy = y + 11
      obsLines.forEach(line => { doc.text(line, margin + 4, oy); oy += 4.5 })
      y += obsBoxH + 6
    }

    // ── SEÇÕES DO CFG (quando configuradas) ──────────────────────────────────
    const renderSection = (title, text) => {
      if(!text) return
      ensureSpace(16)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(9)
      doc.setTextColor(80, 80, 90)
      doc.text(title, margin, y)
      y += 5
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(8.5)
      doc.setTextColor(100, 100, 110)
      doc.splitTextToSize(String(text), lw).forEach(line => {
        ensureSpace(5); doc.text(line, margin, y); y += 4.5
      })
      y += 3
    }

    if(hasCfg){
      // Pedido: observações finais, garantia, info adicionais, termos, assinaturas
      if(quote.status === 'pedido'){
        renderSection('Observações finais', cfg.observacoesFinais)
        renderSection('Garantia', cfg.garantia)
        renderSection('Informações adicionais', cfg.infoAdicionais)
        renderSection('Termos de venda', cfg.termoVenda)
        renderSection('Termos de entrega', cfg.termoEntrega)

        const showSigCli = cfg.showAssinaturaCliente !== false && cfg.showAssinaturaCliente
        const showSigEmp = cfg.showAssinaturaEmpresa !== false && cfg.showAssinaturaEmpresa
        const showLD    = cfg.showLocalData !== false && cfg.showLocalData
        if(showSigCli || showSigEmp || showLD){
          ensureSpace(30)
          y += 6
          const sigW = showSigCli && showSigEmp ? (lw - 10) / 2 : lw - 8
          const sigH = 18
          if(showLD){
            doc.setFont('helvetica', 'normal')
            doc.setFontSize(8)
            doc.setTextColor(120, 120, 120)
            doc.text('Local e data: ____________________________________', margin, y)
            y += 10
          }
          if(showSigCli){
            const x1 = margin
            doc.setDrawColor(180, 180, 190)
            doc.setLineWidth(0.3)
            doc.line(x1, y + sigH, x1 + sigW, y + sigH)
            doc.setFont('helvetica', 'normal')
            doc.setFontSize(8)
            doc.setTextColor(100, 100, 110)
            doc.text('Assinatura do cliente', x1 + sigW / 2, y + sigH + 5, { align:'center' })
          }
          if(showSigEmp){
            const x2 = showSigCli ? margin + sigW + 10 : margin
            const ew  = showSigCli ? sigW : lw - 8
            doc.setDrawColor(180, 180, 190)
            doc.setLineWidth(0.3)
            doc.line(x2, y + sigH, x2 + ew, y + sigH)
            doc.setFont('helvetica', 'normal')
            doc.setFontSize(8)
            doc.setTextColor(100, 100, 110)
            doc.text(cfg.nomeFantasia || 'Empresa', x2 + ew / 2, y + sigH + 5, { align:'center' })
          }
          if(showSigCli || showSigEmp) y += sigH + 10
        }
      } else {
        // Orçamento: info adicionais
        renderSection('Informações adicionais', cfg.infoAdicionais)
      }
    } else {
      // Sem cfg: mantém seções do template (legado)
      renderSection(template.notesTitle || 'Observações', template.notesText)
      renderSection('Condições', template.termsText)
      if(template.showPix && template.pixText) renderSection('Pagamento / PIX', template.pixText)
    }

    // ── VALIDADE ──────────────────────────────────────────────────────────────
    if(quote.status !== 'pedido'){
      ensureSpace(8)
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(8.5)
      doc.setTextColor(160, 160, 165)
      doc.text('Proposta valida por ' + (cfg.validadeOrcamento || '7 dias') + ' a partir da data de emissao.', margin, y)
      y += 6
    }

    // ── RODAPÉ ────────────────────────────────────────────────────────────────
    const totalPages = doc.getNumberOfPages()
    for(let i = 1; i <= totalPages; i++){
      doc.setPage(i)
      doc.setFontSize(8)
      doc.setTextColor(160, 160, 160)
      doc.setFont('helvetica', 'normal')
      const footerMainText = cfg.rodape || template.footerText || ''
      const footerContact  = [cfg.site, cfg.instagram].filter(Boolean).join('   ·   ')
      if(footerContact){
        doc.setFontSize(7.5)
        doc.text(footerContact, margin, H - 13)
      }
      if(footerMainText){
        doc.setFontSize(8)
        doc.text(footerMainText, margin, H - 8)
      }
      doc.setFontSize(8)
      doc.text('Pagina ' + i + ' de ' + totalPages, W - margin, H - 8, { align:'right' })
    }

    return doc
  }

  async function downloadQuotePdf(quoteInput, type, override = {}){
    try{
      const template = await fetchDefaultTemplate(type || quoteInput?.status || 'orcamento')
      const quote = normalizeQuote(quoteInput, type)
      const doc = buildPdf(quoteInput, template, { type, ...override })
      const fileName = (type === 'pedido' ? 'pedido' : 'orcamento') + '-' + safeFileName(quote.cliente) + '-' + Date.now() + '.pdf'
      const title = (type === 'pedido' ? 'Pedido' : 'Orçamento') + ' — ' + (quote.cliente || '')
      return openPdfPreview(doc, fileName, title)
    }catch(e){
      console.error('downloadQuotePdf', e)
      alert('Não foi possível gerar o PDF: ' + (e.message || e))
      return { ok:false, error: e.message }
    }
  }

  async function shareQuotePdf(quoteInput, type, override = {}){
    try{
      const template = await fetchDefaultTemplate(type || quoteInput?.status || 'orcamento')
      const quote = normalizeQuote(quoteInput, type)
      const doc = buildPdf(quoteInput, template, { type, ...override })
      const fileName = (type === 'pedido' ? 'pedido' : 'orcamento') + '-' + safeFileName(quote.cliente) + '.pdf'
      const blob = doc.output('blob')

      const file = typeof File === 'function'
        ? new File([blob], fileName, { type:'application/pdf' })
        : null

      if(file && navigator.canShare && navigator.canShare({ files:[file] })){
        await navigator.share({ title: fileName, files:[file] })
        return { ok:true, mode:'native-share' }
      }

      return triggerPdfDownload(doc, fileName)
    }catch(e){
      console.error('shareQuotePdf', e)
      alert('Não foi possível compartilhar o PDF: ' + (e.message || e))
      return { ok:false, error: e.message }
    }
  }

  return {
    defaultTemplate,
    fetchTemplates,
    fetchDefaultTemplate,
    saveTemplate,
    updateTemplate,
    deleteTemplate,
    getQuote,
    buildPdf,
    openPdfPreview,
    downloadQuotePdf,
    shareQuotePdf,
    parseHex,
    resolveModelImageDataUrl
  }
})()
