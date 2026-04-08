const APP_NAME = 'Estofaria Digital'
const APP_URL = process.env.APP_URL || 'https://estofaria-digital.pages.dev'
const FROM_EMAIL = process.env.FROM_EMAIL || 'noreply@estofaria.digital'
const RESEND_KEY = process.env.RESEND_API_KEY || ''

async function sendEmail({ to, subject, html, text }){
  if(!RESEND_KEY){
    console.log(`[EMAIL-SKIPPED] To: ${to} | Subject: ${subject}`)
    return { ok:false, skipped:true }
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method:'POST',
      headers:{ 'Content-Type':'application/json', 'Authorization':`Bearer ${RESEND_KEY}` },
      body: JSON.stringify({ from:`${APP_NAME} <${FROM_EMAIL}>`, to, subject, html, text })
    })
    const data = await res.json()
    if(!res.ok){ console.error('[EMAIL-ERROR]', data); return { ok:false, error:data } }
    return { ok:true, id: data.id }
  } catch(e){
    console.error('[EMAIL-EXCEPTION]', e.message)
    return { ok:false, error:e.message }
  }
}

function emailBase(body){
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f5f7fb;font-family:system-ui,-apple-system,sans-serif">
<div style="max-width:520px;margin:40px auto;background:#fff;border-radius:20px;box-shadow:0 8px 32px rgba(20,37,63,.10);overflow:hidden">
  <div style="background:linear-gradient(135deg,#4267b2,#7ea3ff);padding:28px 32px">
    <span style="color:#fff;font-weight:800;font-size:20px">🛋️ ${APP_NAME}</span>
  </div>
  <div style="padding:32px">${body}</div>
  <div style="padding:16px 32px 24px;border-top:1px solid #e8eef8">
    <p style="margin:0;color:#8290ab;font-size:12px">${APP_NAME} &middot; <a href="${APP_URL}" style="color:#4267b2">estofaria.digital</a></p>
  </div>
</div>
</body></html>`
}

function btnPrimary(url, label){
  return `<a href="${url}" style="display:inline-block;background:#4267b2;color:#fff;padding:14px 28px;border-radius:12px;font-weight:700;text-decoration:none;font-size:15px">${label}</a>`
}

function welcomeEmail(name, empresa){
  return {
    subject:`Bem-vindo ao ${APP_NAME}! 🛋️`,
    html: emailBase(`
      <h2 style="margin:0 0 12px;color:#172033;font-size:22px">Bem-vindo, ${name}!</h2>
      <p style="color:#5d6983;line-height:1.7;margin:0 0 20px">Sua estofaria <strong>${empresa}</strong> foi cadastrada com sucesso. Você tem <strong>30 dias gratuitos</strong> para explorar tudo.</p>
      ${btnPrimary(APP_URL + '/painel/', 'Acessar minha conta')}
      <p style="color:#8290ab;font-size:13px;margin:20px 0 0">Dúvidas? Responda este e-mail ou acesse o suporte dentro do app.</p>
    `),
    text:`Bem-vindo ao ${APP_NAME}!\n\nOlá, ${name}!\nSua estofaria ${empresa} foi cadastrada com sucesso.\n\nAcesse: ${APP_URL}/painel/`
  }
}

function passwordResetEmail(name, token, expiresMinutes = 30){
  const resetUrl = `${APP_URL}/recuperar-senha/?token=${token}`
  return {
    subject:`${APP_NAME} — Redefinição de senha`,
    html: emailBase(`
      <h2 style="margin:0 0 12px;color:#172033;font-size:22px">Redefinição de senha</h2>
      <p style="color:#5d6983;line-height:1.7;margin:0 0 20px">Olá, <strong>${name}</strong>! Recebemos uma solicitação para redefinir a senha da sua conta.</p>
      ${btnPrimary(resetUrl, 'Redefinir minha senha')}
      <p style="color:#8290ab;font-size:13px;margin:20px 0 0">Este link expira em <strong>${expiresMinutes} minutos</strong>. Se você não solicitou isso, ignore este e-mail.</p>
    `),
    text:`Redefinição de senha\n\nOlá, ${name}!\n\nClique no link para redefinir sua senha:\n${resetUrl}\n\nEste link expira em ${expiresMinutes} minutos.`
  }
}

function subscriptionAlertEmail(name, empresa, daysLeft){
  return {
    subject:`${APP_NAME} — Assinatura vence em ${daysLeft} dias`,
    html: emailBase(`
      <h2 style="margin:0 0 12px;color:#172033;font-size:22px">Assinatura próxima do vencimento</h2>
      <p style="color:#5d6983;line-height:1.7;margin:0 0 20px">Olá, <strong>${name}</strong>! A assinatura de <strong>${empresa}</strong> vence em <strong>${daysLeft} dias</strong>.</p>
      ${btnPrimary(APP_URL + '/assinatura/', 'Renovar assinatura')}
    `),
    text:`Olá, ${name}! A assinatura de ${empresa} vence em ${daysLeft} dias.\n\nAcesse: ${APP_URL}/assinatura/`
  }
}

module.exports = { sendEmail, welcomeEmail, passwordResetEmail, subscriptionAlertEmail }
