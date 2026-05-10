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

    if(!previewWindow || previewWindow.closed){
      previewWindow = window.open('', '_blank')
    }

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
    const logoDataUrl = resolveLogoDataUrl(template)
    const logoFormat = /data:image\/jpe?g/i.test(logoDataUrl) ? 'JPEG' : 'PNG'
    const doc = new jsPDF({ unit:'mm', format:'a4' })
    const emitidoEm = quote.created_at || new Date().toLocaleString('pt-BR')
    const pageWidth = 210
    const pageHeight = 297
    const margin = 14
    const [pr, pg, pb] = parseHex(template.primaryColor)
    const [sr, sg, sb] = parseHex(template.secondaryColor)
    let y = margin

    doc.setFillColor(pr, pg, pb)
    doc.rect(0, 0, pageWidth, 30, 'F')

    if(logoDataUrl){
      try{ doc.addImage(logoDataUrl, logoFormat, margin, 6, 18, 18) }catch(_){
        try{ doc.addImage(logoDataUrl, logoFormat === 'PNG' ? 'JPEG' : 'PNG', margin, 6, 18, 18) }catch(__){}
      }
    }

    doc.setTextColor(255,255,255)
    doc.setFont('helvetica','bold')
    doc.setFontSize(18)
    doc.text(template.companyName || 'Estofaria', logoDataUrl ? 38 : margin, 14)
    doc.setFont('helvetica','normal')
    doc.setFontSize(10)
    doc.text(template.subtitle || '', logoDataUrl ? 38 : margin, 21)
    doc.text('Emitido em: ' + emitidoEm, pageWidth - margin, 14, { align:'right' })

    y = 38
    doc.setTextColor(20,20,20)
    doc.setFillColor(sr, sg, sb)

    const hasExtra = !!(quote.telefone || quote.endereco)
    const clientBoxH = hasExtra ? 28 : 18
    doc.roundedRect(margin, y, pageWidth - margin * 2, clientBoxH, 3, 3, 'F')
    doc.setFont('helvetica','bold')
    doc.setFontSize(16)
    doc.text(template.documentTitle || 'Documento', margin + 4, y + 7)
    doc.setFont('helvetica','normal')
    doc.setFontSize(10)
    doc.text('Cliente: ' + quote.cliente, margin + 4, y + 13)
    doc.text('Status: ' + (quote.status === 'pedido' ? 'Pedido' : 'Orçamento'), pageWidth - margin - 4, y + 13, { align:'right' })
    if(hasExtra){
      const extraParts = []
      if(quote.telefone) extraParts.push('Tel: ' + quote.telefone)
      if(quote.endereco) extraParts.push('End: ' + quote.endereco)
      doc.setFontSize(9)
      doc.text(extraParts.join('   '), margin + 4, y + 20)
    }

    y += clientBoxH + 8
    doc.setFont('helvetica','bold')
    doc.setFontSize(11)
    doc.text('Resumo dos modelos', margin, y)
    y += 6

    const ensureSpace = (amount = 12) => {
      if(y + amount > pageHeight - 24){
        doc.addPage()
        y = 18
      }
    }

    if(!quote.modelos.length){
      doc.setFont('helvetica','normal')
      doc.text('Nenhum modelo informado.', margin, y)
      y += 8
    }

    quote.modelos.forEach((m, idx) => {
      const modelImageDataUrl = resolveModelImageDataUrl(m)
      const modelImageFormat = /data:image\/jpe?g/i.test(modelImageDataUrl) ? 'JPEG' : 'PNG'
      const boxHeight = modelImageDataUrl ? 28 : 12
      const textX = modelImageDataUrl ? margin + 29 : margin + 3

      ensureSpace(boxHeight + 10)
      doc.setDrawColor(225)
      doc.roundedRect(margin, y, pageWidth - margin * 2, boxHeight, 2, 2)

      if(modelImageDataUrl){
        try{
          doc.addImage(modelImageDataUrl, modelImageFormat, margin + 2, y + 2, 24, 24)
        }catch(_){
          try{
            doc.addImage(modelImageDataUrl, modelImageFormat === 'PNG' ? 'JPEG' : 'PNG', margin + 2, y + 2, 24, 24)
          }catch(__){}
        }
      }

      doc.setFont('helvetica','bold')
      doc.setFontSize(10)
      doc.setTextColor(20,20,20)
      doc.text(String(m.modelo || 'Modelo ' + (idx + 1)), textX, y + 5)

      doc.setFont('helvetica','normal')
      doc.setFontSize(9)
      if(m.metragem) doc.text('Metragem: ' + m.metragem + 'm', textX, y + 10)
      doc.text('Valor base: ' + money(m.preco || 0), textX, y + (m.metragem ? 15 : 10))

      const subtotal = calcModelSubtotal(m)
      doc.setFont('helvetica','bold')
      doc.text('Subtotal: ' + money(subtotal), pageWidth - margin - 4, y + 7, { align:'right' })

      y += boxHeight + 2

      const descStr = String(m.descricao || m.description || '').trim()
      if(descStr){
        ensureSpace(8)
        doc.setFont('helvetica','normal')
        doc.setFontSize(8)
        doc.setTextColor(80,80,80)
        doc.splitTextToSize(descStr, pageWidth - margin * 2 - 6).forEach(line => {
          ensureSpace(5); doc.text(line, margin + 4, y); y += 4
        })
        y += 1
      }

      const incl = Array.isArray(m.itens_incluidos) ? m.itens_incluidos.filter(Boolean) : []
      if(incl.length){
        ensureSpace(6)
        doc.setFont('helvetica','bold')
        doc.setFontSize(8)
        doc.setTextColor(74,103,161)
        doc.text('Incluso: ' + incl.join(' / '), margin + 4, y)
        y += 5
        doc.setTextColor(20,20,20)
      }

      if(Array.isArray(m.itens) && m.itens.length){
        m.itens.forEach(item => {
          ensureSpace(6)
          doc.setFont('helvetica','normal')
          doc.setFontSize(9)
          doc.setTextColor(80,80,80)
          const isIncluido = item.incluido_no_modelo === true
          const itemLabel = '  + ' + String(item.nome || '') + (isIncluido ? ' (incluído)' : '')
          doc.text(itemLabel, margin + 4, y + 4)
          if(!isIncluido){
            doc.text(money(item.valor || 0), pageWidth - margin - 4, y + 4, { align:'right' })
          }
          y += 6
        })
      }

      const obsModelo = String(m.observacao || m.obs || '').trim()
      if(obsModelo){
        ensureSpace(10)
        doc.setFont('helvetica','italic')
        doc.setFontSize(8)
        doc.setTextColor(100,100,100)
        doc.splitTextToSize('Obs: ' + obsModelo, pageWidth - margin * 2 - 6).forEach(line => {
          ensureSpace(5)
          doc.text(line, margin + 4, y + 4)
          y += 4.5
        })
        doc.setTextColor(20,20,20)
      }

      y += 4
    })

    ensureSpace(16)
    doc.setFillColor(pr, pg, pb)
    doc.roundedRect(margin, y, pageWidth - margin * 2, 12, 2, 2, 'F')
    doc.setTextColor(255,255,255)
    doc.setFont('helvetica','bold')
    doc.setFontSize(11)
    doc.text('Total geral: ' + money(quote.total), pageWidth - margin - 4, y + 8, { align:'right' })
    doc.text(quote.status === 'pedido' ? 'PEDIDO CONFIRMADO' : 'ORÇAMENTO', margin + 4, y + 8)
    y += 18

    doc.setTextColor(20,20,20)

    if(quote.observacao){
      ensureSpace(18)
      doc.setFont('helvetica','bold')
      doc.setFontSize(10)
      doc.text('Observação do pedido', margin, y)
      y += 5
      doc.setFont('helvetica','normal')
      doc.setFontSize(9)
      const obsLines = doc.splitTextToSize(quote.observacao, pageWidth - margin * 2)
      obsLines.forEach(line => {
        ensureSpace(5)
        doc.text(line, margin, y)
        y += 4.5
      })
      y += 4
    }

    if(template.notesText){
      ensureSpace(18)
      doc.setFont('helvetica','bold')
      doc.setFontSize(10)
      doc.text(template.notesTitle || 'Observações', margin, y)
      y += 5
      doc.setFont('helvetica','normal')
      doc.setFontSize(9)
      const notesLines = doc.splitTextToSize(template.notesText, pageWidth - margin * 2)
      notesLines.forEach(line => {
        ensureSpace(5)
        doc.text(line, margin, y)
        y += 4.5
      })
      y += 4
    }

    if(template.termsText){
      ensureSpace(18)
      doc.setFont('helvetica','bold')
      doc.setFontSize(10)
      doc.text('Condições', margin, y)
      y += 5
      doc.setFont('helvetica','normal')
      doc.setFontSize(9)
      const termsLines = doc.splitTextToSize(template.termsText, pageWidth - margin * 2)
      termsLines.forEach(line => {
        ensureSpace(5)
        doc.text(line, margin, y)
        y += 4.5
      })
      y += 4
    }

    if(template.showPix && template.pixText){
      ensureSpace(18)
      doc.setFont('helvetica','bold')
      doc.setFontSize(10)
      doc.text('Pagamento / PIX', margin, y)
      y += 5
      doc.setFont('helvetica','normal')
      doc.setFontSize(9)
      const pixLines = doc.splitTextToSize(template.pixText, pageWidth - margin * 2)
      pixLines.forEach(line => {
        ensureSpace(5)
        doc.text(line, margin, y)
        y += 4.5
      })
      y += 4
    }

    if(quote.status !== 'pedido'){
      ensureSpace(10)
      doc.setFont('helvetica','normal')
      doc.setFontSize(9)
      doc.setTextColor(100,100,100)
      doc.text('Orçamento válido por 7 dias', margin, y)
      y += 6
    }

    const totalPages = doc.getNumberOfPages()
    for(let i = 1; i <= totalPages; i++){
      doc.setPage(i)
      doc.setFontSize(8)
      doc.setTextColor(150,150,150)
      doc.setFont('helvetica','normal')
      if(template.footerText){
        doc.text(template.footerText, margin, pageHeight - 8)
      }
      doc.text('Página ' + i + ' de ' + totalPages, pageWidth - margin, pageHeight - 8, { align:'right' })
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
    shareQuotePdf
  }
})()

// ── Integração com Modelos de PDF (localStorage) ──────────────────────────────
;(function(){
  const STORAGE_KEY = 'pdf_templates_v1'

  function getLocalTemplate(type){
    try{
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]').find(t => t.type === type) || null
    }catch(_){ return null }
  }

  function sfn(text){
    return String(text || 'documento')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9-_]+/g, '-')
      .replace(/-+/g, '-').replace(/^-|-$/g, '').toLowerCase()
  }

  function fmt(v){
    return Number(v || 0).toLocaleString('pt-BR', { style:'currency', currency:'BRL' })
  }

  function buildLocalPdf(quoteInput, localTemplate){
    const { jsPDF } = window.jspdf
    const payload  = quoteInput?.payload || {}
    const modelos  = Array.isArray(payload.modelos) ? payload.modelos : []
    const cliente  = quoteInput.cliente || 'Cliente'
    const dataStr  = payload.created_at_local || quoteInput.created_at || new Date().toLocaleDateString('pt-BR')
    const tipo     = quoteInput.status || 'orcamento'

    const subtotal = modelos.reduce((t, m) => {
      const base  = Number(m.preco || 0)
      const itens = Array.isArray(m.itens) ? m.itens.reduce((s, i) => s + Number(i.valor || 0), 0) : 0
      return t + base + itens
    }, 0) || Number(payload.total || 0) || (Number(quoteInput.total_cents || 0) / 100)

    const totalAvista   = Number(payload.total_avista   || 0) || (subtotal * 1.10)
    const totalCartao   = Number(payload.total_cartao   || 0) || (subtotal * 1.20)

    const doc    = new jsPDF({ unit:'mm', format:'a4' })
    const W      = 210
    const margin = 18
    const lw     = W - margin * 2
    let y        = 14

    const ensureSpace = (need) => {
      if(y + need > 278){ doc.addPage(); y = 14 }
    }

    const divider = (light) => {
      doc.setDrawColor(light ? 210 : 160, light ? 210 : 160, light ? 210 : 160)
      doc.setLineWidth(0.3)
      doc.line(margin, y, W - margin, y)
      y += 6
    }

    const rowLR = (left, right, bold, sz) => {
      ensureSpace(6)
      doc.setFont('helvetica', bold ? 'bold' : 'normal')
      doc.setFontSize(sz || 10)
      doc.setTextColor(30, 30, 30)
      doc.text(String(left), margin, y)
      doc.text(String(right), W - margin, y, { align:'right' })
      y += 6
    }

    const textLine = (txt, indent, color, sz) => {
      ensureSpace(5)
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(sz || 9)
      doc.setTextColor(color || 80, color || 80, color || 80)
      doc.text(String(txt), margin + (indent || 0), y)
      y += 4.5
    }

    // Logo
    const logo = localTemplate?.logo || ''
    if(logo){
      try{
        const imgW = 52
        const imgX = (W - imgW) / 2
        doc.addImage(logo, /jpe?g/i.test(logo) ? 'JPEG' : 'PNG', imgX, y, imgW, 16)
        y += 22
      }catch(_){ y += 4 }
    }

    // Cliente
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(11)
    doc.setTextColor(30, 30, 30)
    doc.text('Cliente: ' + cliente, margin, y)
    y += 10

    // Modelos
    modelos.forEach(m => {
      const header = String(m.modelo || 'Modelo') + (m.metragem ? ' — ' + m.metragem + 'm' : '')
      ensureSpace(16)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(11)
      doc.setTextColor(20, 20, 20)
      doc.text(header, margin, y)
      y += 6

      const desc = String(m.descricao || m.description || '').trim()
      if(desc){
        doc.splitTextToSize(desc, lw).forEach(line => textLine(line, 0, 90, 9))
      }
      if(m.espuma){
        textLine('Espuma ' + m.espuma, 0, 90, 9)
      }

      const inclP2 = Array.isArray(m.itens_incluidos) ? m.itens_incluidos.filter(Boolean) : []
      if(inclP2.length){
        ensureSpace(6)
        doc.setFont('helvetica', 'bold')
        doc.setFontSize(8)
        doc.setTextColor(74, 103, 161)
        doc.splitTextToSize('Incluso: ' + inclP2.join(' / '), lw).forEach(line => {
          ensureSpace(5); doc.text(line, margin, y); y += 4.5
        })
        doc.setTextColor(20, 20, 20)
      }

      y += 2

      divider(true)

      rowLR('Modelo base', fmt(m.preco || 0))
      if(Array.isArray(m.itens)){
        m.itens.forEach(item => {
          const isIncluido = item.incluido_no_modelo === true
          rowLR(
            String(item.nome || '') + (isIncluido ? ' (incluído)' : ''),
            isIncluido ? '—' : fmt(item.valor || 0)
          )
        })
      }

      const obsM = String(m.observacao || m.obs || '').trim()
      if(obsM){
        ensureSpace(8)
        doc.setFont('helvetica', 'italic')
        doc.setFontSize(8)
        doc.setTextColor(100, 100, 100)
        doc.splitTextToSize('Obs: ' + obsM, lw).forEach(line => textLine(line, 0, 100, 8))
        doc.setTextColor(20, 20, 20)
      }

      y += 2
    })

    // Bloco de totais
    ensureSpace(50)
    divider(true)
    rowLR('Subtotal', fmt(subtotal), true, 10)
    y += 2
    rowLR('Total à vista',        fmt(totalAvista))
    rowLR('Total cartão',          fmt(totalCartao))

    // Data e validade
    y += 2
    divider(true)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(10)
    doc.setTextColor(100, 100, 100)
    doc.text('Data: ' + dataStr, margin, y)
    y += 6
    if(tipo !== 'pedido'){
      doc.text('Orçamento válido por 7 dias', margin, y)
      y += 8
    }

    // Extras do template (complementos)
    ;(localTemplate?.extras || []).forEach(ex => {
      ensureSpace(14)
      if(ex.type === 'divider'){
        divider(false)
      } else if(ex.type === 'signature'){
        const sigW = W * 0.55
        const sigX = (W - sigW) / 2
        doc.setDrawColor(80, 80, 80)
        doc.setLineWidth(0.6)
        doc.line(sigX, y, sigX + sigW, y)
        doc.setFontSize(9)
        doc.setTextColor(100, 100, 100)
        doc.text('Assinatura', W / 2, y + 5, { align:'center' })
        y += 13
      } else if(ex.type === 'text'){
        doc.setFont('helvetica', 'normal')
        doc.setFontSize(10)
        doc.setTextColor(50, 50, 50)
        doc.splitTextToSize(String(ex.text || ''), lw).forEach(line => {
          ensureSpace(5)
          doc.text(line, margin, y)
          y += 5
        })
        y += 2
      }
    })

    // Rodapé com numeração
    const totalPages = doc.getNumberOfPages()
    for(let i = 1; i <= totalPages; i++){
      doc.setPage(i)
      doc.setFontSize(8)
      doc.setTextColor(180, 180, 180)
      doc.text('Página ' + i + ' de ' + totalPages, W - margin, 290, { align:'right' })
      doc.text(tipo === 'pedido' ? 'Pedido de serviço' : 'Orçamento comercial', margin, 290)
    }

    return doc
  }

  function buildPedidoLocalPdf(quoteInput, localTemplate){
    const { jsPDF } = window.jspdf
    const payload  = quoteInput?.payload || {}
    const modelos  = Array.isArray(payload.modelos) ? payload.modelos : []
    const cliente  = quoteInput.cliente || '—'
    const dataStr  = payload.created_at_local || quoteInput.created_at || new Date().toLocaleDateString('pt-BR')
    const empresa  = localTemplate?.empresa || {}
    const DIM_FB   = 'Consultar padrão da fábrica'

    const doc    = new jsPDF({ unit:'mm', format:'a4' })
    const W      = 210
    const margin = 18
    const lw     = W - margin * 2
    let y        = 14

    const ensureSpace = (need) => {
      if(y + need > 278){ doc.addPage(); y = 14 }
    }

    const divider = () => {
      ensureSpace(4)
      doc.setDrawColor(180, 180, 180)
      doc.setLineWidth(0.3)
      doc.line(margin, y, W - margin, y)
      y += 6
    }

    const textRow = (txt, bold, sz, color) => {
      ensureSpace(6)
      doc.setFont('helvetica', bold ? 'bold' : 'normal')
      doc.setFontSize(sz || 10)
      doc.setTextColor(color || 30, color || 30, color || 30)
      doc.text(String(txt), margin, y)
      y += 6
    }

    const field = (label, value, indent) => {
      ensureSpace(6)
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(10)
      doc.setTextColor(30, 30, 30)
      doc.text(label + ': ' + String(value || '—'), margin + (indent || 0), y)
      y += 6
    }

    const rowLR = (left, right, bold) => {
      ensureSpace(6)
      doc.setFont('helvetica', bold ? 'bold' : 'normal')
      doc.setFontSize(10)
      doc.setTextColor(30, 30, 30)
      doc.text(String(left), margin, y)
      doc.text(String(right), W - margin, y, { align:'right' })
      y += 6
    }

    // Logo
    const logo = localTemplate?.logo || ''
    if(logo){
      try{
        const imgW = 52
        doc.addImage(logo, /jpe?g/i.test(logo) ? 'JPEG' : 'PNG', (W - imgW) / 2, y, imgW, 16)
        y += 22
      }catch(_){ y += 4 }
    }

    // Empresa
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(10)
    doc.setTextColor(60, 60, 60)
    if(empresa.cnpj){     doc.text('CNPJ: ' + empresa.cnpj, margin, y);     y += 6 }
    if(empresa.endereco){ doc.text('Endereço: ' + empresa.endereco, margin, y); y += 6 }

    divider()

    // Cliente
    field('Cliente',  cliente)
    field('Endereço', payload.endereco       || quoteInput.endereco)
    field('Telefone', payload.telefone       || quoteInput.telefone)
    field('Data do pedido',       dataStr)
    field('Data de entrega',      payload.data_entrega    || quoteInput.data_entrega)
    field('Meio de fechamento',   payload.meio_fechamento || quoteInput.meio_fechamento)

    // Produtos
    modelos.forEach((m, idx) => {
      divider()
      textRow('Produto ' + (idx + 1), true, 11)

      const comprimento = m.comprimento || (m.metragem ? m.metragem + 'm' : null) || DIM_FB
      const largura     = m.largura  || DIM_FB
      const altura      = m.altura   || DIM_FB

      field('Modelo',     (m.modelo || '—') + (m.metragem ? ' — ' + m.metragem + 'm' : ''))
      field('Quantidade', m.quantidade || 1)

      const descP3 = String(m.descricao || m.description || '').trim()
      if(descP3){
        y += 1
        doc.setFont('helvetica', 'normal')
        doc.setFontSize(8)
        doc.setTextColor(80, 80, 80)
        doc.splitTextToSize(descP3, pageWidth - margin * 2 - 60).forEach(line => {
          ensureSpace(5); doc.text(line, margin + 60, y); y += 4
        })
        doc.setTextColor(60, 60, 60)
      }

      const inclP3 = Array.isArray(m.itens_incluidos) ? m.itens_incluidos.filter(Boolean) : []
      if(inclP3.length){
        ensureSpace(6)
        doc.setFont('helvetica', 'bold')
        doc.setFontSize(8)
        doc.setTextColor(74, 103, 161)
        doc.splitTextToSize('Incluso: ' + inclP3.join(' / '), pageWidth - margin * 2).forEach(line => {
          ensureSpace(5); doc.text(line, margin, y); y += 4.5
        })
        doc.setTextColor(60, 60, 60)
      }

      y += 2
      textRow('Dimensões:', false, 9, 60)
      field('- Comprimento', comprimento, 2)
      field('- Largura',     largura,     2)
      field('- Altura',      altura,      2)

      y += 2
      textRow('Materiais:', false, 9, 60)
      field('- Tecido', m.tecido || '—', 2)
      field('- Espuma', m.espuma || '—', 2)

      const mSub     = Number(m.preco || 0) + (Array.isArray(m.itens) ? m.itens.reduce((s, i) => s + Number(i.valor || 0), 0) : 0)
      const mCartao  = mSub * 1.10

      y += 2
      textRow('Valores:', false, 9, 60)
      rowLR('À vista:', fmt(mSub))
      rowLR('Cartão:',  fmt(mCartao))

      y += 2
      textRow('Observação:', false, 9, 60)
      const obs = String(m.observacao || m.obs || '').trim()
      if(obs){
        doc.setFont('helvetica', 'normal')
        doc.setFontSize(9)
        doc.setTextColor(60, 60, 60)
        doc.splitTextToSize(obs, lw).forEach(line => {
          ensureSpace(5); doc.text(line, margin, y); y += 4.5
        })
      } else {
        ensureSpace(8)
        doc.setDrawColor(180, 180, 180)
        doc.setLineWidth(0.3)
        doc.line(margin, y + 2, margin + lw * 0.7, y + 2)
        y += 8
      }
    })

    // Totais gerais
    const subtotalGeral = modelos.reduce((t, m) => {
      return t + Number(m.preco || 0) + (Array.isArray(m.itens) ? m.itens.reduce((s, i) => s + Number(i.valor || 0), 0) : 0)
    }, 0)

    divider()
    rowLR('Subtotal geral:', fmt(subtotalGeral), true)
    y += 2
    rowLR('Total à vista:',   fmt(subtotalGeral * 1.10))
    rowLR('Total no cartão:', fmt(subtotalGeral * 1.20))

    // Observações gerais (opcional)
    const obsGerais = String(payload.observacoes || quoteInput.observacoes || '').trim()
    if(obsGerais){
      divider()
      textRow('Observações gerais:', true, 10)
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(9)
      doc.setTextColor(60, 60, 60)
      doc.splitTextToSize(obsGerais, lw).forEach(line => {
        ensureSpace(5); doc.text(line, margin, y); y += 4.5
      })
    }

    // Assinatura (obrigatório)
    ensureSpace(65)
    divider()

    doc.setFont('helvetica', 'italic')
    doc.setFontSize(9)
    doc.setTextColor(60, 60, 60)
    const disc = doc.splitTextToSize('Em caso de desistência, o valor será convertido em saldo para uma próxima compra.', lw)
    disc.forEach(line => { ensureSpace(5); doc.text(line, margin, y); y += 5 })
    y += 10

    const sigW = lw * 0.45
    const drawSig = (label) => {
      ensureSpace(22)
      doc.setDrawColor(80, 80, 80)
      doc.setLineWidth(0.5)
      doc.line(margin, y, margin + sigW, y)
      y += 5
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(9)
      doc.setTextColor(100, 100, 100)
      doc.text(label, margin, y)
      y += 14
    }

    drawSig('Assinatura do cliente')
    drawSig('Assinatura da empresa')

    // Rodapé
    const totalPages = doc.getNumberOfPages()
    for(let i = 1; i <= totalPages; i++){
      doc.setPage(i)
      doc.setFontSize(8)
      doc.setTextColor(180, 180, 180)
      doc.text('Página ' + i + ' de ' + totalPages, W - margin, 290, { align:'right' })
      doc.text('Pedido de serviço', margin, 290)
    }

    return doc
  }

  async function downloadComTemplateLocal(quoteInput, type, override){
    const effectiveType = type || quoteInput?.status || 'orcamento'
    if(effectiveType === 'pedido'){
      try{
        const localTemplate = getLocalTemplate('pedido')
        const doc = buildPedidoLocalPdf(quoteInput, localTemplate)
        const fileName = 'pedido-' + sfn(quoteInput.cliente) + '.pdf'
        const title    = 'Pedido — ' + (quoteInput.cliente || '')
        return window.VendedorPDF.openPdfPreview(doc, fileName, title)
      }catch(e){
        console.error('[buildPedidoLocalPdf]', e)
        return null
      }
    }
    const localTemplate = getLocalTemplate(effectiveType)
    if(!localTemplate) return null
    try{
      const doc = buildLocalPdf(quoteInput, localTemplate)
      const fileName = (type === 'pedido' ? 'pedido' : 'orcamento') + '-' + sfn(quoteInput.cliente) + '.pdf'
      const title    = (type === 'pedido' ? 'Pedido' : 'Orçamento') + ' — ' + (quoteInput.cliente || '')
      return window.VendedorPDF.openPdfPreview(doc, fileName, title)
    }catch(e){
      console.error('[buildLocalPdf] erro, usando PDF padrão', e)
      return null
    }
  }

  async function shareComTemplateLocal(quoteInput, type, override){
    const effectiveType = type || quoteInput?.status || 'orcamento'
    try{
      let doc, fileName
      if(effectiveType === 'pedido'){
        const localTemplate = getLocalTemplate('pedido')
        doc      = buildPedidoLocalPdf(quoteInput, localTemplate)
        fileName = 'pedido-' + sfn(quoteInput.cliente) + '.pdf'
      } else {
        const localTemplate = getLocalTemplate(effectiveType)
        if(!localTemplate) return null
        doc      = buildLocalPdf(quoteInput, localTemplate)
        fileName = 'orcamento-' + sfn(quoteInput.cliente) + '.pdf'
      }
      const blob = doc.output('blob')
      const file = typeof File === 'function' ? new File([blob], fileName, { type:'application/pdf' }) : null
      if(file && navigator.canShare && navigator.canShare({ files:[file] })){
        await navigator.share({ title: fileName, files:[file] })
        return { ok:true, mode:'native-share' }
      }
      doc.save(fileName)
      return { ok:true }
    }catch(e){
      console.error('[shareComTemplateLocal]', e)
      return null
    }
  }

  const _download = window.VendedorPDF.downloadQuotePdf
  window.VendedorPDF.downloadQuotePdf = async function(quoteInput, type, override){
    const result = await downloadComTemplateLocal(quoteInput, type, override)
    if(result) return result
    return _download.call(this, quoteInput, type, override)
  }

  const _share = window.VendedorPDF.shareQuotePdf
  window.VendedorPDF.shareQuotePdf = async function(quoteInput, type, override){
    const result = await shareComTemplateLocal(quoteInput, type, override)
    if(result) return result
    return _share.call(this, quoteInput, type, override)
  }

  window.VendedorPDF.getLocalTemplate     = getLocalTemplate
  window.VendedorPDF.buildLocalPdf        = buildLocalPdf
  window.VendedorPDF.buildPedidoLocalPdf  = buildPedidoLocalPdf
})()
// ── fim integração Modelos de PDF ─────────────────────────────────────────────
