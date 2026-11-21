'use strict'
const {randomUUID}=require('node:crypto')
const list=store=>Array.isArray(store.globalAnnouncements)?store.globalAnnouncements:[]
function publish(store,input,userId){
 const title=typeof input?.title==='string'?input.title.trim():''
 const message=typeof input?.message==='string'?input.message.trim():''
 if(!title||!message||title.length>120||message.length>3000)throw Object.assign(new Error('Informe título (até 120 caracteres) e mensagem (até 3000).'),{status:400})
 const item={id:randomUUID(),title,message,published_at:new Date().toISOString(),published_by:String(userId)}
 store.globalAnnouncements=[item,...list(store)]
 return item
}
function pending(store,userId){
 const read=store.globalAnnouncementReads||[]
 const ids=new Set(read.filter(x=>String(x.user_id)===String(userId)).map(x=>x.announcement_id))
 return list(store).filter(x=>!ids.has(x.id)).map(({id,title,message,published_at})=>({id,title,message,published_at})).reverse()
}
function acknowledge(store,id,userId){
 if(!list(store).some(x=>x.id===id))return false
 const reads=Array.isArray(store.globalAnnouncementReads)?store.globalAnnouncementReads:[]
 if(!reads.some(x=>x.announcement_id===id&&String(x.user_id)===String(userId)))reads.push({announcement_id:id,user_id:String(userId),read_at:new Date().toISOString()})
 store.globalAnnouncementReads=reads
 return true
}
module.exports={list,publish,pending,acknowledge}
