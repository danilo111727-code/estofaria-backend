const APP_NAME = 'Estofaria Digital'
const APP_URL = process.env.APP_URL || 'https://estofaria-digital.pages.dev'

const PROXY_URL = process.env.EMAIL_PROXY_URL || 'https://7b9eeca1-2ca3-4144-be6b-a99d2de66139-00-3agah2v43nbw4.kirk.replit.dev/api/email/send'
const PROXY_SECRET = process.env.EMAIL_PROXY_SECRET || 'ep7f3d9a2b6c1e4f8d0a5b3c7e1f2d9'

async function sendEmail({ to, type, data }){
  if(!PROXY_URL || !PROXY_SECRET){
    console.log('[EMAIL-SKIPPED] Proxy not configured. To:', to, '| Type:', type)
    return { ok:false, skipped:true }
  }
  try {
    const res = await fetch(PROXY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-email-proxy-secret': PROXY_SECRET
      },
      body: JSON.stringify({ to, type, data })
    })
    const result = await res.json()
    if(!res.ok){
      console.error('[EMAIL-ERROR]', result)
      return { ok:false, error:result }
    }
    return { ok:true, id: result.id }
  } catch(e){
    console.error('[EMAIL-EXCEPTION]', e.message)
    return { ok:false, error: e.message }
  }
}

function welcomeEmail(name, empresa){
  return { type: 'welcome', data: { name, empresa } }
}

function passwordResetEmail(name, token, expiresMinutes = 30){
  return { type: 'password_reset', data: { name, token, expires_minutes: String(expiresMinutes) } }
}

module.exports = { sendEmail, welcomeEmail, passwordResetEmail }
