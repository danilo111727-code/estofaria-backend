
let itens=[]
let colunaSelecionada=null
let tabelaTravada=false

function gerarMetragens(){
let lista=[]
for(let i=100;i<=500;i+=10){
lista.push((i/100).toFixed(2))
}
return lista
}

function exibirTabela(){
let body=document.getElementById("bodyRows")
body.innerHTML=""

gerarMetragens().forEach(m=>{
let tr=document.createElement("tr")
let td=document.createElement("td")
td.innerText=m
tr.appendChild(td)

itens.forEach(()=>{
let cell=document.createElement("td")
cell.contentEditable=!tabelaTravada
cell.innerText="0"
if(tabelaTravada) cell.classList.add("locked")
tr.appendChild(cell)
})

body.appendChild(tr)
})
}

function adicionarItem(){
let nome=document.getElementById("nomeItem").value
if(!nome) return

itens.push(nome)

let header=document.getElementById("headerRow")
let th=document.createElement("th")
th.innerText=nome
header.appendChild(th)

exibirTabela()
}

function editarColuna(){}

function deletarColuna(){}

function salvarTabela(){
tabelaTravada=true
alert("Tabela salva")
}

function formatCurrency(input){
let value=input.value.replace(/\D/g,"")
value=(value/100).toFixed(2)+""
value=value.replace(".",",")
value=value.replace(/(\d)(?=(\d{3})+(?!\d))/g,"$1.")
input.value="R$ "+value
}
