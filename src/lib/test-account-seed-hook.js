'use strict'

if(String(process.env.TEST_ACCOUNT_SEED_ON_START || '') === '1'){
  const email = String(process.env.TEST_ACCOUNT_SEED_EMAIL || '').trim().toLowerCase()
  const password = String(process.env.TEST_ACCOUNT_SEED_PASSWORD || '')
  const empresa = String(process.env.TEST_ACCOUNT_SEED_COMPANY || 'Teste Problema 08').trim()
  const nome = String(process.env.TEST_ACCOUNT_SEED_NAME || 'Teste Assinante').trim()

  setTimeout(async () => {
    try{
      const response = await fetch(`http://127.0.0.1:${Number(process.env.PORT || 10000)}/api/auth/register`, {
        method:'POST',
        headers:{ 'Content-Type':'application/json', Accept:'application/json' },
        body:JSON.stringify({ empresa, nome, email, password })
      })
      const body = await response.json().catch(() => ({}))
      console.log(`[test-account-seed-hook] HTTP ${response.status} | ${email} | ${body?.user?.id || body?.error || 'sem-id'}`)
    }catch(error){
      console.error('[test-account-seed-hook] Falha:', error.message)
    }
  }, 15000)
}
