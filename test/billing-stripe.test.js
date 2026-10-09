'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')
const express = require('express')
const Stripe = require('stripe')
process.env.JWT_SECRET = 'fixture-only-secret-not-for-deployment'
process.env.STRIPE_SECRET_KEY = 'sk_test_fixture_never_sent'
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_fixture'
process.env.STRIPE_PRICE_ID = 'price_fixture'
delete process.env.DATABASE_URL
const { issueToken } = require('../src/lib/auth')
const day = 86400000
function company(extra = {}) { return { id:'co_test', name:'Fictícia', owner_email:'fixture@example.invalid', plan_code:'gestao', billing_mode:'courtesy', access_status:'courtesy_active', financial_status:'active', courtesy_until:new Date(Date.now()+60*day).toISOString(), ...extra } }
async function fixture(t, extra = {}, options = {}) {
  let state = { companies:[company(extra)], users:[{id:'u_test',company_id:'co_test',email:'fixture@example.invalid',is_active:true}], companyUsers:[], billingConfig:options.billingConfig || {}, billingLeads:[], webhookEvents:[], auditLogs:[] }
  const calls = { sessions:[], customers:[], lists:[] }
  const stripeDelay = () => options.stripeDelayMs ? new Promise(r=>setTimeout(r,options.stripeDelayMs)) : Promise.resolve()
  const subscriptions = new Map()
  const sessions = new Map()
  const invoices = new Map()
  const store = { readStore:()=>structuredClone(state), writeStore:v=>{ state=structuredClone(v) }, findCompanyById:(s,id)=>s.companies.find(c=>c.id===id), upsertAudit:(s,v)=>s.auditLogs.push(v), nowIso:()=>new Date().toISOString(), planPreset:()=>({code:'gestao',name:'Gestão',monthly_price_cents:14900,seats_limit:2}) }
  const fake = {
    customers:{ list:async()=>{await stripeDelay();return {data:options.customers || [],has_more:false}}, create:async(p,o)=>{ await stripeDelay(); calls.customers.push({p,o}); return {id:'cus_fixture'} } },
    subscriptions:{ list:async p=>{ await stripeDelay(); calls.lists.push(p); return options.list ? options.list(p) : {data:[...subscriptions.values()].filter(s=>s.customer===p.customer),has_more:false} }, retrieve:async id=>{ await stripeDelay(); if(options.retrieveError) throw Error('simulated timeout'); if(!subscriptions.has(id)) throw Error('missing fixture subscription '+id); return structuredClone(subscriptions.get(id)) } },
    invoices:{retrieve:async id=>structuredClone(invoices.get(id))},
    checkout:{ sessions:{ create:async(p,o)=>{ await stripeDelay(); calls.sessions.push({p,o}); await new Promise(r=>setImmediate(r)); const s={id:'cs_fixture_'+calls.sessions.length,url:'https://checkout.example.invalid/'+calls.sessions.length,status:'open',mode:'subscription',customer:p.customer,metadata:p.metadata,expires_at:Math.floor(Date.now()/1000)+86400}; sessions.set(s.id,s); if(options.checkoutTimeoutOnce){options.checkoutTimeoutOnce=false;throw Error('simulated lost Stripe response')} return structuredClone(s) }, retrieve:async id=>{ await stripeDelay(); if(!sessions.has(id)) throw Error('missing fixture session '+id); return structuredClone(sessions.get(id)) },list:async p=>{await stripeDelay();return {data:[...sessions.values()].filter(s=>s.customer===p.customer&&s.status==='open'),has_more:false}} } },
    webhooks:{constructEvent:(...args)=>Stripe.webhooks.constructEvent(...args)}
  }
  if(options.atomic){
    store.updateStore = mutator => { const next = mutator(store.readStore()); if(next) store.writeStore(next) }
    store._pg = {pool:{connect:async()=>{
      let staged
      return {query:async(sql,params=[])=>{
        if(sql.startsWith('SELECT value')) return {rows:[{value:structuredClone(state)}]}
        if(sql.includes('INSERT INTO kv_store')) staged=JSON.parse(params[0])
        if(sql === 'COMMIT'){
          if(options.failCommitOnce){options.failCommitOnce=false;throw Error('simulated DB commit failure')}
          if(staged) state=staged
          staged=undefined
        }
        if(sql === 'ROLLBACK') staged=undefined
        return {rows:[]}
      },release(){}}
    }},flushNow:async()=>{}}
    delete require.cache[require.resolve('../src/lib/atomic-store')]
    const atomic = require('../src/lib/atomic-store')
    atomic.install(store)
    store.atomicMiddleware = atomic.middleware
    t.after(async()=>store._pg.flushNow())
  }
  const storePath = require.resolve('../src/lib/store')
  const oldStore = require.cache[storePath]
  require.cache[storePath] = {id:storePath,filename:storePath,loaded:true,exports:store}
  delete require.cache[require.resolve('../src/middleware/auth')]
  delete require.cache[require.resolve('../src/routes/billing')]
  const load = Module._load
  Module._load = function(name,...args){ return name==='stripe' ? (key,config)=>{calls.sdkOptions=config;return fake} : load.call(this,name,...args) }
  let router
  try { router=require('../src/routes/billing') } finally { Module._load=load }
  const { requireAuth } = require('../src/middleware/auth')
  const app = express()
  app.use((req,res,next)=>req.path.endsWith('/webhooks/stripe')?next():express.json()(req,res,next))
  if(options.atomic) app.use(store.atomicMiddleware)
  app.use('/api/billing',router)
  app.post('/api/test-mutation',(req,res)=>{
    const latest=store.readStore();latest.latency_probe=Number(latest.latency_probe||0)+1;store.writeStore(latest);res.json({ok:true})
  })
  app.get('/api/protected',requireAuth,(req,res)=>res.json({ok:true}))
  const server=app.listen(0,'127.0.0.1')
  await new Promise(r=>server.once('listening',r))
  t.after(()=>{server.close(); if(oldStore)require.cache[storePath]=oldStore; else delete require.cache[storePath]})
  let token=issueToken(state.users[0])
  async function request(path,body, signed=true){ const raw=JSON.stringify(body); const headers={ 'content-type':'application/json',authorization:'Bearer '+token }; if(path.endsWith('webhooks/stripe')) headers['stripe-signature']=signed?Stripe.webhooks.generateTestHeaderString({payload:raw,secret:process.env.STRIPE_WEBHOOK_SECRET}):'invalid'; const res=await fetch('http://127.0.0.1:'+server.address().port+path,{method:body?'POST':'GET',headers,body:body?raw:undefined}); return {status:res.status,body:await res.json()} }
  return { calls,subscriptions,sessions,invoices,refreshSession:()=>{token=issueToken(state.users[0])},flush:async()=>options.atomic&&store._pg.flushNow(),get persisted(){return state},get state(){return options.atomic?store.readStore():state},get company(){return (options.atomic?store.readStore():state).companies[0]}, request, checkout:()=>request('/api/billing/stripe/create-checkout',{}), webhook:(type,obj,id='evt_'+Math.random())=>request('/api/billing/webhooks/stripe',{id,type,data:{object:obj}}), complete:(id,sub)=>{sessions.set(id,{id,mode:'subscription',status:'complete',payment_status:'paid',metadata:{company_id:'co_test'},customer:sub.customer,subscription:sub.id})} }
}
function sub(extra={}) { return {id:'sub_current',object:'subscription',customer:'cus_fixture',status:'active',metadata:{company_id:'co_test'},current_period_end:Math.floor(Date.now()/1000)+30*86400,...extra} }
const checkoutPath='/api/billing/stripe/confirm-checkout'
test('public billing reports the effective 60-day courtesy even with legacy 30-day config',async t=>{const f=await fixture(t,{}, {billingConfig:{trial_days:30}});const r=await f.request('/api/billing/public');assert.equal(r.status,200);assert.equal(r.body.trial_days,60)})
test('repeated checkout reuses one open session',async t=>{const f=await fixture(t);const a=await f.checkout(),b=await f.checkout();assert.equal(a.status,200);assert.equal(b.body.session_id,a.body.session_id);assert.equal(f.calls.sessions.length,1)})
test('concurrent checkout creates only one session',async t=>{const f=await fixture(t);const r=await Promise.all(Array.from({length:8},()=>f.checkout()));assert.equal(new Set(r.map(x=>x.body.session_id)).size,1);assert.equal(f.calls.sessions.length,1)})
test('creates and persists an explicit Stripe customer',async t=>{const f=await fixture(t);await f.checkout();assert.equal(f.company.stripe_customer_id,'cus_fixture');assert.equal(f.calls.sessions[0].p.customer,'cus_fixture');assert.ok(f.calls.customers[0].o.idempotencyKey)})
test('existing customer reused without email creation',async t=>{const f=await fixture(t,{stripe_customer_id:'cus_fixture'});await f.checkout();assert.equal(f.calls.sessions[0].p.customer,'cus_fixture');assert.equal(f.calls.customers.length,0);assert.equal(f.calls.sessions[0].p.customer_email,undefined)})
test('active linked subscription blocks new checkout',async t=>{const f=await fixture(t,{stripe_subscription_id:'sub_current'});assert.equal((await f.checkout()).status,409);assert.equal(f.calls.sessions.length,0)})
for(const status of ['active','trialing','past_due','unpaid','incomplete','paused'])test('existing '+status+' subscription prevents duplicate',async t=>{const f=await fixture(t,{stripe_customer_id:'cus_fixture'});f.subscriptions.set('sub_current',sub({status}));assert.equal((await f.checkout()).status,409)})
test('subscription pagination checks later pages',async t=>{const f=await fixture(t,{stripe_customer_id:'cus_fixture'},{list:p=>p.starting_after?{data:[sub()],has_more:false}:{data:[sub({id:'sub_old',status:'canceled'})],has_more:true}});assert.equal((await f.checkout()).status,409)})
test('full courtesy end preserved exactly',async t=>{const f=await fixture(t);const until=f.company.courtesy_until;await f.checkout();assert.equal(f.calls.sessions[0].p.subscription_data.trial_end,Math.ceil(Date.parse(until)/1000));assert.equal(f.company.courtesy_until,until)})
test('last 24 hours of courtesy cannot charge early',async t=>{const f=await fixture(t,{courtesy_until:new Date(Date.now()+day).toISOString()});assert.equal((await f.checkout()).status,409);assert.equal(f.calls.sessions.length,0)})
test('expired courtesy checkout has no new trial',async t=>{const f=await fixture(t,{courtesy_until:new Date(Date.now()-day).toISOString()});await f.checkout();assert.equal(f.calls.sessions[0].p.subscription_data.trial_end,undefined)})
test('legacy checkout request preserves courtesy mode',async t=>{const f=await fixture(t);await f.request('/api/billing/checkout',{accepted_terms:true});assert.equal(f.company.billing_mode,'courtesy');assert.equal(f.company.access_status,'courtesy_active')})
test('old subscription cannot block linked current subscription',async t=>{const f=await fixture(t,{stripe_customer_id:'cus_fixture',stripe_subscription_id:'sub_current',billing_mode:'stripe',access_status:'active'});await f.webhook('customer.subscription.deleted',sub({id:'sub_old',status:'canceled'}));assert.equal(f.company.access_status,'active')})
test('modern invoice recognizes subscription ID',async t=>{const f=await fixture(t,{stripe_customer_id:'cus_fixture',stripe_subscription_id:'sub_current',billing_mode:'stripe',access_status:'blocked',financial_status:'unpaid'});f.subscriptions.set('sub_current',sub());await f.webhook('invoice.paid',{id:'in_new',object:'invoice',customer:{id:'cus_fixture'},parent:{subscription_details:{subscription:{id:'sub_current'}}},status:'paid'});assert.equal(f.company.access_status,'active')})
test('expanded checkout IDs are stored as strings',async t=>{const f=await fixture(t,{stripe_customer_id:'cus_fixture'});f.subscriptions.set('sub_current',sub());await f.webhook('checkout.session.completed',{id:'cs_done',mode:'subscription',status:'complete',payment_status:'paid',metadata:{company_id:'co_test'},customer:{id:'cus_fixture'},subscription:{id:'sub_current'}});assert.equal(f.company.stripe_subscription_id,'sub_current');assert.equal(f.company.stripe_customer_id,'cus_fixture')})
test('cancellation preserves courtesy without professional flag',async t=>{const f=await fixture(t,{stripe_customer_id:'cus_fixture',stripe_subscription_id:'sub_current'});f.subscriptions.set('sub_current',sub({status:'canceled'}));await f.webhook('customer.subscription.deleted',sub({status:'canceled'}));assert.equal(f.company.access_status,'courtesy_active')})
test('stale event uses current subscription state',async t=>{const f=await fixture(t,{stripe_customer_id:'cus_fixture',stripe_subscription_id:'sub_current',billing_mode:'stripe',access_status:'active'});f.subscriptions.set('sub_current',sub());await f.webhook('customer.subscription.updated',sub({status:'unpaid'}));assert.equal(f.company.access_status,'active');assert.equal(f.company.financial_status,'active')})
test('old paid invoice cannot reactivate canceled subscription',async t=>{const f=await fixture(t,{stripe_customer_id:'cus_fixture',stripe_subscription_id:'sub_current',billing_mode:'stripe',access_status:'blocked'});f.subscriptions.set('sub_current',sub({status:'canceled'}));await f.webhook('invoice.paid',{id:'in_old',object:'invoice',subscription:'sub_current',customer:'cus_fixture',status:'paid'});assert.equal(f.company.access_status,'blocked')})
test('confirmation cannot replace current subscription with an old one',async t=>{const f=await fixture(t,{stripe_customer_id:'cus_fixture',stripe_subscription_id:'sub_current'});f.subscriptions.set('sub_old',sub({id:'sub_old'}));f.complete('cs_old',sub({id:'sub_old'}));assert.equal((await f.request(checkoutPath,{session_id:'cs_old'})).status,409);assert.equal(f.company.stripe_subscription_id,'sub_current')})
test('confirmation verifies customer ownership',async t=>{const f=await fixture(t,{stripe_customer_id:'cus_fixture'});f.subscriptions.set('sub_current',sub({customer:'cus_other'}));f.complete('cs_other',sub({customer:'cus_other'}));assert.equal((await f.request(checkoutPath,{session_id:'cs_other'})).status,403)})
test('duplicate event is processed once',async t=>{const f=await fixture(t,{stripe_customer_id:'cus_fixture',stripe_subscription_id:'sub_current'});f.subscriptions.set('sub_current',sub());await f.webhook('invoice.paid',{subscription:'sub_current',customer:'cus_fixture'},'evt_once');const r=await f.webhook('invoice.paid',{subscription:'sub_current',customer:'cus_fixture'},'evt_once');assert.equal(r.body.duplicate,true);assert.equal(f.state.webhookEvents.length,1)})
test('invalid signature rejected without mutations',async t=>{const f=await fixture(t);const before=structuredClone(f.state);const r=await f.request('/api/billing/webhooks/stripe',{id:'evt_fake',type:'invoice.paid'},false);assert.equal(r.status,400);assert.deepEqual(f.state,before)})
test('API failure returns retryable webhook without recording success',async t=>{const f=await fixture(t,{stripe_customer_id:'cus_fixture',stripe_subscription_id:'sub_current'},{retrieveError:true});const r=await f.webhook('customer.subscription.updated',sub());assert.equal(r.status,500);assert.equal(f.state.webhookEvents.length,0)})
test('unrelated invoice cannot alter company by customer alone',async t=>{const f=await fixture(t,{stripe_customer_id:'cus_fixture',stripe_subscription_id:'sub_current',billing_mode:'stripe',access_status:'blocked'});await f.webhook('invoice.paid',{id:'in_once',customer:'cus_fixture',object:'invoice'});assert.equal(f.company.access_status,'blocked')})
test('confirmed subscription preserves courtesy and links access',async t=>{const f=await fixture(t,{stripe_customer_id:'cus_fixture'});f.subscriptions.set('sub_current',sub({status:'trialing'}));f.complete('cs_current',sub({status:'trialing'}));assert.equal((await f.request(checkoutPath,{session_id:'cs_current'})).status,200);assert.equal(f.company.access_status,'courtesy_active');assert.equal((await f.request('/api/protected')).status,200)})
test('blocked customer can access billing recovery checkout',async t=>{const f=await fixture(t,{billing_mode:'stripe',access_status:'blocked',courtesy_until:''});assert.equal((await f.checkout()).status,200)})
test('foreign company selector cannot change checkout owner',async t=>{const f=await fixture(t);f.state.companies.push(company({id:'co_other'}));const r=await f.request('/api/billing/stripe/create-checkout?company_id=co_other',{});assert.equal(r.status,200);assert.equal(f.calls.sessions[0].p.metadata.company_id,'co_test')})
test('past due remains accessible by existing grace policy',async t=>{const f=await fixture(t,{stripe_customer_id:'cus_fixture',stripe_subscription_id:'sub_current',billing_mode:'stripe',access_status:'active'});f.subscriptions.set('sub_current',sub({status:'past_due'}));await f.webhook('invoice.payment_failed',{id:'in_failed',subscription:'sub_current',customer:'cus_fixture'});assert.equal(f.company.financial_status,'past_due');assert.equal((await f.request('/api/protected')).status,200)})
test('current unpaid subscription blocks application',async t=>{const f=await fixture(t,{stripe_customer_id:'cus_fixture',stripe_subscription_id:'sub_current',billing_mode:'stripe',access_status:'active'});f.subscriptions.set('sub_current',sub({status:'unpaid'}));await f.webhook('customer.subscription.updated',sub({status:'unpaid'}));assert.equal((await f.request('/api/protected')).status,402)})
test('courtesy expires with linked active subscription without blocking',async t=>{const f=await fixture(t,{stripe_customer_id:'cus_fixture',stripe_subscription_id:'sub_current',courtesy_until:new Date(Date.now()-day).toISOString(),financial_status:'active'});await f.request('/api/billing/subscription');assert.equal(f.company.access_status,'active');assert.equal(f.company.billing_mode,'stripe')})
test('trial next charge uses trial end with modern period fields',async t=>{const f=await fixture(t,{stripe_customer_id:'cus_fixture'});const trialEnd=Math.ceil(Date.parse(f.company.courtesy_until)/1000);f.subscriptions.set('sub_current',sub({status:'trialing',trial_end:trialEnd,current_period_end:undefined,items:{data:[{current_period_end:trialEnd}]}}));f.complete('cs_current',sub());await f.request(checkoutPath,{session_id:'cs_current'});assert.equal(f.company.next_charge_at,new Date(trialEnd*1000).toISOString())})
test('legacy invoice recognizes string subscription ID',async t=>{const f=await fixture(t,{stripe_customer_id:'cus_fixture',stripe_subscription_id:'sub_current',billing_mode:'stripe',access_status:'blocked'});f.subscriptions.set('sub_current',sub());await f.webhook('invoice.paid',{id:'in_legacy',subscription:'sub_current',customer:'cus_fixture'});assert.equal(f.company.access_status,'active')})
test('conflicting webhook metadata cannot change matching subscription',async t=>{const f=await fixture(t,{stripe_customer_id:'cus_fixture',stripe_subscription_id:'sub_current',billing_mode:'stripe',access_status:'active'});f.subscriptions.set('sub_current',sub({status:'unpaid'}));await f.webhook('customer.subscription.updated',sub({status:'unpaid',metadata:{company_id:'co_other'}}));assert.equal(f.company.access_status,'active')})
test('legacy Stripe customer without saved ID cannot create duplicate',async t=>{const f=await fixture(t,{}, {customers:[{id:'cus_legacy',email:'fixture@example.invalid',metadata:{}}]});assert.equal((await f.checkout()).status,409);assert.equal(f.calls.customers.length,0);assert.equal(f.calls.sessions.length,0)})
test('customer found by company metadata is reused',async t=>{const f=await fixture(t,{}, {customers:[{id:'cus_fixture',metadata:{company_id:'co_test'}}]});assert.equal((await f.checkout()).status,200);assert.equal(f.calls.customers.length,0);assert.equal(f.company.stripe_customer_id,'cus_fixture')})
test('expired session gets a different idempotency generation',async t=>{const f=await fixture(t);const a=await f.checkout();f.sessions.get(a.body.session_id).status='expired';const b=await f.checkout();assert.equal(b.status,200);assert.notEqual(a.body.session_id,b.body.session_id);assert.notEqual(f.calls.sessions[0].o.idempotencyKey,f.calls.sessions[1].o.idempotencyKey)})
test('lost session write recovers open session from Stripe',async t=>{const f=await fixture(t,{stripe_customer_id:'cus_fixture'});f.sessions.set('cs_recovered',{id:'cs_recovered',url:'https://example.invalid',mode:'subscription',status:'open',metadata:{company_id:'co_test'},customer:'cus_fixture'});const r=await f.checkout();assert.equal(r.body.session_id,'cs_recovered');assert.equal(f.calls.sessions.length,0)})
test('unpaid completed checkout cannot confirm paid access',async t=>{const f=await fixture(t,{stripe_customer_id:'cus_fixture',billing_mode:'stripe',access_status:'pending_payment',courtesy_until:''});f.subscriptions.set('sub_current',sub());f.complete('cs_unpaid',sub());f.sessions.get('cs_unpaid').payment_status='unpaid';assert.equal((await f.request(checkoutPath,{session_id:'cs_unpaid'})).status,409);assert.equal(f.company.access_status,'pending_payment')})

test('PostgreSQL transaction wrapper commits webhook access and event together',async t=>{
  const f=await fixture(t,{stripe_customer_id:'cus_fixture',stripe_subscription_id:'sub_current',billing_mode:'stripe',access_status:'blocked'}, {atomic:true})
  f.subscriptions.set('sub_current',sub())
  assert.equal((await f.webhook('invoice.paid',{id:'in_atomic',subscription:'sub_current',customer:'cus_fixture'})).status,200)
  assert.equal(f.persisted.companies[0].access_status,'active')
  assert.equal(f.persisted.webhookEvents.length,1)
})
test('PostgreSQL deferred checkout write preserves customer and session after flush',async t=>{
  const f=await fixture(t,{}, {atomic:true})
  const r=await f.checkout()
  await f.flush()
  assert.equal(r.status,200)
  assert.equal(f.persisted.companies[0].stripe_customer_id,'cus_fixture')
  assert.equal(f.persisted.companies[0].stripe_checkout_session_id,r.body.session_id)
})

test('lost Stripe create response recovers session without a second subscription checkout',async t=>{
  const f=await fixture(t,{}, {checkoutTimeoutOnce:true})
  assert.equal((await f.checkout()).status,500)
  const retry=await f.checkout()
  assert.equal(retry.status,200)
  assert.equal(retry.body.session_id,'cs_fixture_1')
  assert.equal(f.calls.sessions.length,1)
})

test('checkout success must persist Stripe identifiers before returning HTTP 200',async t=>{
  const f=await fixture(t,{}, {atomic:true})
  const response=await f.checkout()
  assert.equal(response.status,200)
  assert.equal(f.persisted.companies[0].stripe_customer_id,'cus_fixture')
  assert.equal(f.persisted.companies[0].stripe_checkout_session_id,response.body.session_id)
})

test('database commit failure cannot acknowledge successful checkout',async t=>{
  const f=await fixture(t,{}, {atomic:true,failCommitOnce:true})
  const first=await f.checkout()
  assert.equal(first.status,503)
  assert.equal(f.persisted.companies[0].stripe_customer_id,undefined)
  const retry=await f.checkout()
  assert.equal(retry.status,200)
  assert.equal(f.calls.sessions.length,1)
  assert.equal(f.persisted.companies[0].stripe_checkout_session_id,retry.body.session_id)
})
test('database commit failure cannot acknowledge successful webhook',async t=>{
  const f=await fixture(t,{stripe_customer_id:'cus_fixture',stripe_subscription_id:'sub_current',billing_mode:'stripe',access_status:'blocked'}, {atomic:true,failCommitOnce:true})
  f.subscriptions.set('sub_current',sub())
  const event={subscription:'sub_current',customer:'cus_fixture'}
  assert.equal((await f.webhook('invoice.paid',event,'evt_commit_retry')).status,503)
  assert.equal(f.persisted.webhookEvents.length,0)
  assert.equal(f.persisted.companies[0].access_status,'blocked')
  assert.equal((await f.webhook('invoice.paid',event,'evt_commit_retry')).status,200)
  assert.equal(f.persisted.webhookEvents.length,1)
})
test('Stripe calls have bounded timeout with explicit application retry',async t=>{
  const f=await fixture(t)
  assert.equal(f.calls.sdkOptions.timeout,5000)
  assert.equal(f.calls.sdkOptions.maxNetworkRetries,0)
})
test('simulated 60-day trial progresses to first paid invoice without losing access',async t=>{
  const f=await fixture(t,{stripe_customer_id:'cus_fixture'})
  const originalNow=Date.now
  t.after(()=>{Date.now=originalNow})
  const end=Math.ceil(Date.parse(f.company.courtesy_until)/1000)
  const trial=sub({status:'trialing',trial_end:end,current_period_end:end})
  f.subscriptions.set(trial.id,trial)
  await f.webhook('customer.subscription.created',trial,'evt_trial_created')
  assert.equal(f.company.access_status,'courtesy_active')
  assert.equal(f.company.next_charge_at,new Date(end*1000).toISOString())
  Date.now=()=>end*1000+1000
  f.refreshSession() // A 60-day-old JWT is expected to expire; simulate signing in again.
  f.subscriptions.set(trial.id,sub({status:'active',trial_end:end,current_period_end:end+30*86400}))
  assert.equal((await f.webhook('invoice.paid',{id:'in_first_paid',object:'invoice',customer:'cus_fixture',parent:{subscription_details:{subscription:trial.id}},amount_paid:14900},'evt_first_paid')).status,200)
  assert.equal(f.company.access_status,'active')
  assert.equal(f.company.billing_mode,'stripe')
  assert.equal(f.company.financial_status,'active')
  assert.equal((await f.request('/api/protected')).status,200)
  assert.equal((await f.checkout()).status,409)
})

test('frontend subscription status endpoint returns the same billing payload',async t=>{
  const f=await fixture(t,{stripe_customer_id:'cus_fixture'})
  const current=await f.request('/api/billing/subscription')
  const status=await f.request('/api/billing/status')
  assert.equal(status.status,200)
  assert.deepEqual(status.body,current.body)
})

test('slow Stripe checkout does not hold the global PostgreSQL mutation queue',async t=>{
  const f=await fixture(t,{}, {atomic:true,stripeDelayMs:80})
  const started=Date.now()
  const checkout=f.checkout()
  await new Promise(r=>setTimeout(r,20))
  const mutationStarted=Date.now()
  const mutation=await f.request('/api/test-mutation',{})
  const mutationMs=Date.now()-mutationStarted
  const checkoutResult=await checkout
  const checkoutMs=Date.now()-started
  assert.equal(mutation.status,200)
  assert.equal(checkoutResult.status,200)
  assert.ok(mutationMs < 200, `mutation waited ${mutationMs}ms`)
  assert.ok(checkoutMs >= 300, `checkout finished too quickly for fixture: ${checkoutMs}ms`)
  t.diagnostic(`checkout=${checkoutMs}ms concurrent_mutation=${mutationMs}ms`)
})

test('slow Stripe confirmation does not hold the global PostgreSQL mutation queue',async t=>{
  const f=await fixture(t,{stripe_customer_id:'cus_fixture'}, {atomic:true,stripeDelayMs:100})
  const subscription=sub({status:'trialing',trial_end:Math.floor(Date.now()/1000)+60*86400})
  f.subscriptions.set(subscription.id,subscription)
  f.complete('cs_confirm_slow',subscription)
  const started=Date.now()
  const confirmation=f.request(checkoutPath,{session_id:'cs_confirm_slow'})
  await new Promise(r=>setTimeout(r,20))
  const mutationStarted=Date.now()
  const mutation=await f.request('/api/test-mutation',{})
  const mutationMs=Date.now()-mutationStarted
  const confirmationResult=await confirmation
  const confirmationMs=Date.now()-started
  assert.equal(mutation.status,200)
  assert.equal(confirmationResult.status,200)
  assert.ok(mutationMs < 200, `mutation waited ${mutationMs}ms`)
  assert.ok(confirmationMs >= 180, `confirmation finished too quickly for fixture: ${confirmationMs}ms`)
  t.diagnostic(`confirmation=${confirmationMs}ms concurrent_mutation=${mutationMs}ms`)
})

test('slow Stripe webhook does not hold the global PostgreSQL mutation queue',async t=>{
  const subscription=sub({status:'active'})
  const f=await fixture(t,{stripe_customer_id:'cus_fixture',stripe_subscription_id:subscription.id}, {atomic:true,stripeDelayMs:200})
  f.subscriptions.set(subscription.id,subscription)
  const started=Date.now()
  const webhook=f.webhook('customer.subscription.updated',subscription,'evt_slow_webhook')
  await new Promise(r=>setTimeout(r,20))
  const mutationStarted=Date.now()
  const mutation=await f.request('/api/test-mutation',{})
  const mutationMs=Date.now()-mutationStarted
  const webhookResult=await webhook
  const webhookMs=Date.now()-started
  assert.equal(mutation.status,200)
  assert.equal(webhookResult.status,200)
  assert.ok(mutationMs < 200, `mutation waited ${mutationMs}ms`)
  assert.ok(webhookMs >= 180, `webhook finished too quickly for fixture: ${webhookMs}ms`)
  t.diagnostic(`webhook=${webhookMs}ms concurrent_mutation=${mutationMs}ms`)
})
