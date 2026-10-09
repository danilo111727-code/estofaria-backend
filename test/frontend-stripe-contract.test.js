'use strict'
const test=require('node:test')
const assert=require('node:assert/strict')
const vm=require('node:vm')
const source=require('./fixtures/frontend-stripe-20261009.json')
function page(hostname='estofaria-frontend.pages.dev', response={status:409,body:{error:'courtesy_ending',message:'Sua cortesia continua ativa. Contrate ao encerrar o período para evitar cobrança antecipada.',retry_at:'2026-12-08T12:00:00Z'}}){
  const nodes=new Map()
  const storage=new Map()
  const requests=[]
  let redirected=''
  const location={hostname,host:hostname,protocol:'https:',search:'?session_id=cs_fixture',replace:p=>{redirected=p}}
  const context={URLSearchParams,Date,Promise,JSON,Math,console:{error(){}},Headers,atob,
    localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},
    sessionStorage:{getItem:()=>null,setItem(){},removeItem(){}},
    setTimeout:()=>0,clearTimeout(){},setInterval:()=>0,
    document:{visibilityState:'hidden',addEventListener(){},getElementById:id=>{if(!nodes.has(id))nodes.set(id,{style:{},classList:{add(){}},textContent:'',className:''});return nodes.get(id)}},
    fetch:async(url,options)=>{requests.push({url,options});return {status:response.status,ok:response.status<400,headers:{get:()=> 'application/json'},json:async()=>response.body}}
  }
  context.window={location,top:{location:{href:''}},parent:{},addEventListener(){},setTimeout:context.setTimeout}
  vm.createContext(context)
  vm.runInContext(source.config,context)
  return {context,nodes,requests,get redirected(){return redirected}}
}
for(const hostname of ['estofaria-frontend.pages.dev','preview.estofaria-frontend.pages.dev'])test('frontend '+hostname+' chooses only dev backend',()=>{const p=page(hostname);assert.equal(p.context.window.API_BASE,'https://estofaria-backend-dev.onrender.com')})
test('production frontend selects production backend',()=>{const p=page('estofariadigital.com.br');assert.equal(p.context.window.API_BASE,'https://estofaria-backend.onrender.com')})
test('HTTP layer preserves courtesy_ending status, message and retry_at',async()=>{const p=page();await assert.rejects(p.context.window.ESTOFARIA_HTTP.fetchJson('https://example.invalid/api'),err=>{assert.equal(err.status,409);assert.equal(err.payload.error,'courtesy_ending');assert.equal(err.payload.retry_at,'2026-12-08T12:00:00Z');return true})})
test('actual frontend checkout displays courtesy message without redirect or access change',async()=>{
  const p=page()
  p.context.getPlanPreset=()=>({code:'gestao'})
  p.context.getSelectedPlanCode=()=> 'gestao'
  p.context.apiSend=(method,path,body)=>p.context.window.ESTOFARIA_HTTP.fetchJson(p.context.window.API_BASE+'/api'+path,{method,body:JSON.stringify(body)})
  p.context.setNotice=(type,text)=>p.nodes.set('notice',{type,text})
  vm.runInContext(source.checkout,p.context)
  await p.context.iniciarCheckoutStripe('gestao')
  assert.equal(p.nodes.get('notice').type,'warn')
  assert.match(p.nodes.get('notice').text,/cortesia continua ativa/)
  assert.equal(p.context.window.top.location.href,'')
  assert.equal(p.requests.length,1)
})
test('frontend persists chosen plan before create-checkout and preserves legal flags',async()=>{
  const p=page()
  const calls=[]
  Object.assign(p.context,{API:p.context.window.API_BASE+'/api',http:p.context.window.ESTOFARIA_HTTP,getPlanPreset:()=>({name:'Gestão'}),originalFetchJson:async(url,options)=>{calls.push({url,body:JSON.parse(options.body)});return {url:'https://checkout.example.invalid'}}})
  vm.runInContext(source.planPersist,p.context)
  await p.context.http.fetchJson(p.context.API+'/subscription/stripe/create-checkout',{method:'POST',body:'{"plan_code":"gestao"}'})
  assert.equal(calls[0].url,p.context.API+'/subscription/checkout')
  assert.equal(calls[1].url,p.context.API+'/subscription/stripe/create-checkout')
  assert.equal(calls[0].body.accepted_terms,true)
  assert.equal(calls[1].body.accepted_privacy,true)
})
test('Stripe return pending payment shows backend message without entering app',async()=>{
  const p=page('estofaria-frontend.pages.dev',{status:409,body:{error:'checkout_payment_pending',message:'Aguarde a confirmação do pagamento pela Stripe.'}})
  p.context.window.ESTOFARIA_AUTH.getToken=()=> 'fixture-token'
  vm.runInContext(source.returnScript,p.context)
  await new Promise(r=>setImmediate(r))
  assert.equal(p.redirected,'')
  assert.equal(p.nodes.get('title').textContent,'Não foi possível confirmar a assinatura')
  assert.match(p.nodes.get('message').textContent,/confirmação do pagamento/)
  assert.match(p.requests[0].url,/estofaria-backend-dev/)
})
