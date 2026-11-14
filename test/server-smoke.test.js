'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const {spawn} = require('node:child_process')
const {mkdtempSync, readFileSync, rmSync} = require('node:fs')
const {tmpdir} = require('node:os')
const path = require('node:path')
const net = require('node:net')

for(const configured of [false,true])test('real server: courtesy, authenticated billing and '+(configured?'signed Stripe webhooks':'unconfigured Stripe webhooks'), async t => {
  const directory=mkdtempSync(path.join(tmpdir(),'estofaria-smoke-'))
  const reserve=net.createServer()
  await new Promise(r=>reserve.listen(0,'127.0.0.1',r))
  const port=reserve.address().port
  await new Promise(r=>reserve.close(r))
  // Only local fixtures: no inherited production service keys or database URL.
  const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>! /^(STRIPE_|DATABASE_|PG|R2_|AWS_|RESEND_|MASTER_|BOOTSTRAP_)/.test(k)))
  Object.assign(env,{DATA_DIR:directory,PORT:String(port),JWT_SECRET:'local-smoke-fixture-secret',NODE_ENV:'test',BOOTSTRAP_MASTER:'1',MASTER_EMAIL:'master@example.invalid',MASTER_PASSWORD:'Fixture-only-password-1234!'})
  if(configured)Object.assign(env,{STRIPE_SECRET_KEY:'sk_test_fixture_not_a_real_key',STRIPE_WEBHOOK_SECRET:'whsec_local_smoke_fixture'})
  const server=spawn(process.execPath,['server.js'],{cwd:path.join(__dirname,'..'),env,stdio:['ignore','pipe','pipe']})
  let logs=''
  server.stdout.on('data',b=>{logs+=b});server.stderr.on('data',b=>{logs+=b})
  t.after(async()=>{if(server.exitCode===null){server.kill('SIGTERM');await new Promise(r=>server.once('exit',r))}rmSync(directory,{recursive:true,force:true})})
  const base='http://127.0.0.1:'+port
  let health
  for(let attempt=0;attempt<60;attempt++){
    try{health=await fetch(base+'/api/health');break}catch(err){if(server.exitCode!==null)throw Error(logs);await new Promise(r=>setTimeout(r,100))}
  }
  assert.ok(health,logs)
  assert.equal(health.status,200)
  assert.equal((await health.json()).ok,true)
  const response=await fetch(base+'/api/auth/register',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({empresa:'Empresa Fictícia',nome:'Responsável Fictício',email:'smoke@example.invalid',password:'Fixture-user-pass-123!',whatsapp:'00000000000',accepted_terms:true,accepted_privacy:true})})
  assert.equal(response.status,201)
  const registered=await response.json()
  const store=JSON.parse(readFileSync(path.join(directory,'store.json'),'utf8'))
  const company=store.companies.find(c=>c.id===registered.user.company_id)
  assert.ok(Math.abs(Date.parse(company.courtesy_until)-Date.parse(company.courtesy_started_at)-60*86400000)<1000)
  const subscription=await fetch(base+'/api/billing/subscription',{headers:{authorization:'Bearer '+registered.token}})
  assert.equal(subscription.status,200)
  assert.equal((await subscription.json()).subscription.access_status,'courtesy_active')
  for(const alias of ['billing','subscription']){
    const status=await fetch(base+`/api/${alias}/status`,{headers:{authorization:'Bearer '+registered.token}})
    assert.equal(status.status,200)
    assert.equal((await status.json()).subscription.access_status,'courtesy_active')
    const webhook=await fetch(base+`/api/${alias}/webhooks/stripe`,{method:'POST',headers:{'content-type':'application/json'},body:'{"id":"evt_unsigned"}'})
    assert.equal(webhook.status,configured?400:503)
    if(configured){
      assert.equal((await webhook.json()).error,'invalid_signature')
      const crypto=require('node:crypto'),timestamp=Math.floor(Date.now()/1000)
      const body=JSON.stringify({id:'evt_smoke_'+alias,type:'customer.updated',data:{object:{id:'cus_fixture',name:'Cliente fictício — ação'}}},null,2)
      const signature=crypto.createHmac('sha256',env.STRIPE_WEBHOOK_SECRET).update(timestamp+'.'+body).digest('hex')
      const signed=await fetch(base+`/api/${alias}/webhooks/stripe`,{method:'POST',headers:{'content-type':'application/json','stripe-signature':`t=${timestamp},v1=${signature}`},body})
      assert.equal(signed.status,200);assert.equal((await signed.json()).ok,true)
      const persisted=JSON.parse(readFileSync(path.join(directory,'store.json'),'utf8'))
      assert.equal(persisted.webhookEvents.find(e=>e.id==='evt_smoke_'+alias).status,'ignored')
      const unsignedStatus=await fetch(base+`/api/${alias}/status`)
      assert.equal(unsignedStatus.status,401,'Demais rotas continuam exigindo login')
    }
  }
})
