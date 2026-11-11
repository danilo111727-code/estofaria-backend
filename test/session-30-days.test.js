'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),Module=require('node:module')
process.env.JWT_SECRET='session-test-only-secret'
process.env.JWT_EXPIRES_IN='48h'
delete process.env.DATABASE_URL
const {issueToken,decodeToken}=require('../src/lib/auth')
const jwt=require('jsonwebtoken'),ttl=30*24*60*60
const user={id:'fixture-user',company_id:'fixture-company',is_active:true,session_version:3}
test('new login lasts exactly 30 days despite the old 48h environment setting',()=>{
 const p=decodeToken(issueToken(user));assert.equal(p.exp-p.iat,ttl)
})
test('token is accepted on day 29 and rejected at the 30-day boundary',()=>{
 const token=issueToken(user),p=decodeToken(token)
 assert.equal(jwt.verify(token,process.env.JWT_SECRET,{clockTimestamp:p.iat+29*86400}).id,user.id)
 assert.throws(()=>jwt.verify(token,process.env.JWT_SECRET,{clockTimestamp:p.exp}),e=>e.name==='TokenExpiredError')
})
test('verification does not renew the expiration; old 48h tokens keep their deadline',()=>{
 const token=issueToken(user),p=decodeToken(token);assert.equal(decodeToken(token).exp,p.exp)
 const old=jwt.sign(user,process.env.JWT_SECRET,{expiresIn:'48h'}),oldP=decodeToken(old)
 assert.equal(oldP.exp-oldP.iat,48*3600)
 assert.throws(()=>jwt.verify(old,process.env.JWT_SECRET,{clockTimestamp:oldP.exp}),e=>e.name==='TokenExpiredError')
})
function gate(state,token){
 const load=Module._load,key=require.resolve('../src/middleware/auth');delete require.cache[key]
 Module._load=function(n,p,m){if(p?.filename===key&&n==='../lib/store')return {readStore:()=>state};return load.apply(this,arguments)}
 let middleware;try{middleware=require(key).requireAuth}finally{Module._load=load;delete require.cache[key]}
 const req={headers:{authorization:token?'Bearer '+token:''},path:'/painel',query:{},body:{}},res={status(n){this.code=n;return this},json(v){this.body=v;return this}}
 let passed=false;middleware(req,res,()=>{passed=true});return {res,passed}
}
function state(){return {users:[{...user}],companies:[{id:user.company_id,access_status:'active'}],companyUsers:[]}}
test('active user remains authorized with a 30-day token',()=>assert.equal(gate(state(),issueToken(user)).passed,true))
test('disabled user is denied immediately with an unexpired token',()=>{const s=state();s.users[0].is_active=false;assert.equal(gate(s,issueToken(user)).res.code,401)})
test('password change or administrative revocation invalidates an unexpired token',()=>{const s=state();s.users[0].session_version++;assert.equal(gate(s,issueToken(user)).res.body.error,'session_revoked')})
test('inactive membership is denied immediately',()=>{const s=state();s.companyUsers=[{user_id:user.id,company_id:user.company_id,status:'inactive'}];assert.equal(gate(s,issueToken(user)).res.code,401)})
test('blocked subscription is still denied before the session expires',()=>{const s=state();s.companies[0].access_status='blocked';assert.equal(gate(s,issueToken(user)).res.code,402)})
test('missing or altered token never authorizes access',()=>{assert.equal(gate(state(),'').res.code,401);assert.equal(gate(state(),'invalid').res.code,401)})
