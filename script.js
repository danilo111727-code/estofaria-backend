function load(){
render()
}

function abrirFull(id){
document.getElementById(id).classList.add('ativo')
}

function fecharFull(id){
document.getElementById(id).classList.remove('ativo')
}

function salvarConfig(){
let c={
prazo:Number(document.getElementById('prazo').value),
vagas:Number(document.getElementById('vagas').value),
tipoDias:document.getElementById('tipoDias').value
}
localStorage.setItem("agenda_config",JSON.stringify(c))
render()
}

function getConfig(){
return JSON.parse(localStorage.getItem("agenda_config")||'{"prazo":5,"vagas":10,"tipoDias":"corrido"}')
}

function getAgenda(){
return JSON.parse(localStorage.getItem("agenda_dados")||"[]")
}

function setAgenda(a){
localStorage.setItem("agenda_dados",JSON.stringify(a))
}

function getHistorico(){
return JSON.parse(localStorage.getItem("agenda_hist")||"[]")
}

function setHistorico(h){
localStorage.setItem("agenda_hist",JSON.stringify(h))
}

function format(d){
let dt=new Date(d)
return dt.toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'})
}

function calcularDatas(){
let hoje=new Date()
let prod=new Date(hoje)
let c=getConfig()
let ent=new Date(prod)

if(c.tipoDias==="uteis"){
let dias=0
while(dias<c.prazo){
ent.setDate(ent.getDate()+1)
let dia=ent.getDay()
if(dia!==0 && dia!==6) dias++
}
}else{
ent.setDate(prod.getDate()+c.prazo)
}

return {prod,ent}
}

function novoPedido(){
let cliente=document.getElementById('cliente').value
let desc=document.getElementById('descricao').value
let tecido=document.getElementById('tecido').value
let qtd=Number(document.getElementById('qtd').value)

let datas=calcularDatas()

let a=getAgenda()

for(let i=0;i<qtd;i++){
a.push({
prod:datas.prod,
ent:datas.ent,
cliente:cliente,
desc:desc,
tecido:tecido,
tecidoComprado:false,
status:"pendente"
})
}

setAgenda(a)
render()
}

function mudarStatus(i,val){
let a=getAgenda()
a[i].status=val

if(val==="entregue"){
let h=getHistorico()
h.push(a[i])
setHistorico(h)
a.splice(i,1)
}

setAgenda(a)
render()
}

function menuPedido(i){
let op=prompt("1 Editar  |  2 Excluir  |  3 Bloquear")
if(op=="2"){ excluir(i) }
if(op=="3"){
let a=getAgenda()
a[i].status="cancelado"
setAgenda(a)
render()
}
}

function excluir(i){
let a=getAgenda()
a.splice(i,1)
setAgenda(a)
render()
}

function resgatar(i){
let h=getHistorico()
let a=getAgenda()
a.push(h[i])
h.splice(i,1)
setHistorico(h)
setAgenda(a)
render()
}

function render(){
let a=getAgenda()
let h=getHistorico()
let conf=getConfig()

document.getElementById("agendaTabela").innerHTML=""

a.forEach((p,i)=>{
let tr=document.createElement("tr")
tr.className="status-"+p.status
tr.innerHTML=`
<td>${format(p.prod)}</td>
<td>${format(p.ent)}</td>
<td>${p.cliente}</td>
<td>${p.desc}</td>
<td>
<input type="checkbox" ${p.tecidoComprado?'checked':''}
onclick="toggleTecido(${i})">
${p.tecido}
</td>
<td>
<select onchange="mudarStatus(${i},this.value)">
<option value="pendente" ${p.status=="pendente"?'selected':''}>Pendente</option>
<option value="producao" ${p.status=="producao"?'selected':''}>Em produção</option>
<option value="entregue">Entregue</option>
<option value="cancelado">Cancelado</option>
</select>
</td>
<td><button onclick="menuPedido(${i})">⋮</button></td>
`
document.getElementById("agendaTabela").appendChild(tr)
})

for(let j=a.length;j<conf.vagas;j++){
let datas=calcularDatas()
let tr=document.createElement("tr")
tr.innerHTML=`
<td>${format(datas.prod)}</td>
<td>${format(datas.ent)}</td>
<td></td>
<td></td>
<td></td>
<td>desocupado</td>
<td><button>⋮</button></td>
`
document.getElementById("agendaTabela").appendChild(tr)
}

document.getElementById("historicoTabela").innerHTML=""

h.forEach((p,i)=>{
let tr=document.createElement("tr")
tr.innerHTML=`
<td>${format(p.prod)}</td>
<td>${format(p.ent)}</td>
<td>${p.cliente}</td>
<td>${p.desc}</td>
<td>${p.tecido}</td>
<td>${p.status}</td>
<td><button onclick="resgatar(${i})">Resgatar</button></td>
`
document.getElementById("historicoTabela").appendChild(tr)
})

renderSemana()
renderVagas()
}

function toggleTecido(i){
let a=getAgenda()
a[i].tecidoComprado=!a[i].tecidoComprado
setAgenda(a)
render()
}

function renderSemana(){
let lista=document.getElementById("pedidosSemana")
lista.innerHTML=""
let a=getAgenda()

let hoje=new Date()
let inicio=new Date(hoje)
inicio.setDate(hoje.getDate()-hoje.getDay())
let fim=new Date(inicio)
fim.setDate(inicio.getDate()+6)

a.forEach(p=>{
let d=new Date(p.prod)
if(d>=inicio && d<=fim){
let tr=document.createElement("tr")
tr.innerHTML=`
<td>${format(p.prod)}</td>
<td>${p.cliente}</td>
<td>${p.desc}</td>
<td>1</td>
`
lista.appendChild(tr)
}
})

if(lista.innerHTML===""){
lista.innerHTML="<tr><td colspan='4'>Nenhum pedido programado</td></tr>"
}
}

function renderVagas(){
let conf=getConfig()
let a=getAgenda()

let vagas=conf.vagas
let ocupadas=a.length
let percent=(ocupadas/vagas)*100

document.getElementById("barra").style.width=percent+"%"
document.getElementById("barraTexto").innerText=ocupadas+" / "+vagas+" vagas"

let datas=calcularDatas()
document.getElementById("nextProd").innerText=format(datas.prod)
document.getElementById("nextEnt").innerText=format(datas.ent)
}

load()
