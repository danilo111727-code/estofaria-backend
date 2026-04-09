const APP_NAME = 'Estofaria Digital'
const APP_URL = process.env.APP_URL || 'https://estofaria-digital.pages.dev'
const RESEND_API_KEY = process.env.RESEND_API_KEY || ''
const FROM = `${APP_NAME} <onboarding@resend.dev>`

function baseHtml(title, bodyContent) {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
</head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:32px 16px;">
  <tr><td align="center">
    <table width="100%" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08);">
      <tr>
        <td style="background:linear-gradient(135deg,#1a2e6e 0%,#2563eb 100%);padding:32px 40px;text-align:center;">
          <div style="font-size:36px;margin-bottom:8px;">🛋️</div>
          <div style="color:#ffffff;font-size:22px;font-weight:700;letter-spacing:-.3px;">${APP_NAME}</div>
        </td>
      </tr>
      <tr>
        <td style="padding:36px 40px;">
          ${bodyContent}
        </td>
      </tr>
      <tr>
        <td style="background:#f8fafc;padding:20px 40px;text-align:center;border-top:1px solid #e2e8f0;">
          <p style="margin:0;color:#94a3b8;font-size:12px;">© ${new Date().getFullYear()} ${APP_NAME} · <a href="${APP_URL}" style="color:#2563eb;text-decoration:none;">${APP_URL.replace('https://','')}</a></p>
        </td>
      </tr>
    </table>
  </td></tr>
</table>
</body>
</html>`
}

function buildWelcomeHtml(name, empresa) {
  const body = `
    <h1 style="margin:0 0 8px;font-size:24px;font-weight:700;color:#0f172a;">Bem-vindo, ${name}! 🎉</h1>
    <p style="margin:0 0 24px;color:#64748b;font-size:15px;line-height:1.6;">Sua conta na <strong>${APP_NAME}</strong> foi criada com sucesso para a empresa <strong>${empresa}</strong>. Você tem <strong>30 dias gratuitos</strong> para explorar tudo!</p>

    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
      <tr>
        <td style="background:#f0f9ff;border-radius:8px;padding:20px 24px;border-left:4px solid #2563eb;">
          <p style="margin:0 0 12px;font-weight:700;color:#0f172a;font-size:14px;">O que você pode fazer agora:</p>
          <ul style="margin:0;padding-left:18px;color:#334155;font-size:14px;line-height:2;">
            <li>📅 Adicionar pedidos à agenda de produção</li>
            <li>💰 Configurar tabela de precificação</li>
            <li>🧵 Cadastrar materiais e calcular custos</li>
            <li>🛋️ Criar catálogo de produtos</li>
            <li>🤝 Convidar vendedores para a equipe</li>
          </ul>
        </td>
      </tr>
    </table>

    <table width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td align="center">
          <a href="${APP_URL}/login/" style="display:inline-block;background:linear-gradient(135deg,#1a2e6e,#2563eb);color:#ffffff;font-size:16px;font-weight:700;padding:14px 36px;border-radius:8px;text-decoration:none;letter-spacing:-.2px;">Acessar minha conta →</a>
        </td>
      </tr>
    </table>

    <p style="margin:28px 0 0;color:#94a3b8;font-size:13px;text-align:center;">Precisa de ajuda? Responda este e-mail a qualquer momento.</p>
  `
  return baseHtml(`Bem-vindo ao ${APP_NAME}`, body)
}

function buildPasswordResetHtml(name, token, expiresMinutes) {
  const resetUrl = `${APP_URL}/recuperar-senha/?token=${encodeURIComponent(token)}`
  const body = `
    <h1 style="margin:0 0 8px;font-size:24px;font-weight:700;color:#0f172a;">Redefinir senha</h1>
    <p style="margin:0 0 24px;color:#64748b;font-size:15px;line-height:1.6;">Olá, <strong>${name}</strong>! Recebemos uma solicitação para redefinir a senha da sua conta. Clique no botão abaixo para criar uma nova senha.</p>

    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
      <tr>
        <td align="center">
          <a href="${resetUrl}" style="display:inline-block;background:linear-gradient(135deg,#1a2e6e,#2563eb);color:#ffffff;font-size:16px;font-weight:700;padding:14px 36px;border-radius:8px;text-decoration:none;letter-spacing:-.2px;">Redefinir minha senha →</a>
        </td>
      </tr>
    </table>

    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;">
      <tr>
        <td style="background:#fef9c3;border-radius:8px;padding:16px 20px;border-left:4px solid #eab308;">
          <p style="margin:0;color:#713f12;font-size:13px;line-height:1.5;">⏰ <strong>Este link expira em ${expiresMinutes} minutos.</strong> Se você não solicitou a troca de senha, pode ignorar este e-mail.</p>
        </td>
      </tr>
    </table>

    <p style="margin:0;color:#94a3b8;font-size:12px;word-break:break-all;">Ou cole este link no navegador:<br><a href="${resetUrl}" style="color:#2563eb;">${resetUrl}</a></p>
  `
  return baseHtml('Redefinir senha — Estofaria Digital', body)
}

async function sendEmail({ to, type, data }) {
  if (!RESEND_API_KEY) {
    console.log('[EMAIL-SKIPPED] RESEND_API_KEY not set. To:', to, '| Type:', type)
    return { ok: false, skipped: true }
  }

  let subject, html
  if (type === 'welcome') {
    subject = `Bem-vindo ao ${APP_NAME}! Sua conta está pronta 🎉`
    html = buildWelcomeHtml(data.name || 'Cliente', data.empresa || '')
  } else if (type === 'password_reset') {
    subject = `Redefinição de senha — ${APP_NAME}`
    html = buildPasswordResetHtml(data.name || 'Cliente', data.token, data.expires_minutes || '30')
  } else {
    console.log('[EMAIL-SKIPPED] Unknown type:', type)
    return { ok: false, skipped: true }
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ from: FROM, to: [to], subject, html })
    })
    const result = await res.json()
    if (!res.ok) {
      console.error('[EMAIL-ERROR]', result)
      return { ok: false, error: result }
    }
    console.log('[EMAIL-SENT]', type, 'to:', to, 'id:', result.id)
    return { ok: true, id: result.id }
  } catch (e) {
    console.error('[EMAIL-EXCEPTION]', e.message)
    return { ok: false, error: e.message }
  }
}

function welcomeEmail(name, empresa) {
  return { type: 'welcome', data: { name, empresa } }
}

function passwordResetEmail(name, token, expiresMinutes = 30) {
  return { type: 'password_reset', data: { name, token, expires_minutes: String(expiresMinutes) } }
}

module.exports = { sendEmail, welcomeEmail, passwordResetEmail }
