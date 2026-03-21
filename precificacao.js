
let materiais=[]
let modelos=[]

const valoresMateriais={
"Espuma":40,
"Cola":0.5,
"Percinta":8,
"Madeira":18
}

const unidadeMateriais={
"Espuma":"metro",
"Cola":"unidade",
"Percinta":"metro",
"Madeira":"metro"
}

function addMaterial(){

let mat=document.getElementById("materialSelect").value
let qtd=Number(document.getElementById("materialQtd").value)

if(!qtd)return

let valor=valoresMateriais[mat]
let total=qtd*valor

materiais.push({mat,qtd,valor,total})

renderMateriais()

}

function renderMateriais(){

let table=document.getElementById("materiaisTabela")
table.innerHTML=""

let custo=0

materiais.forEach((m,i)=>{

custo+=m.total

let tr=document.createElement("tr")

tr.innerHTML=`
<td>${m.mat}</td>
<td>${unidadeMateriais[m.mat]}</td>
<td>${m.qtd}</td>
<td>R$ ${m.valor}</td>
<td>R$ ${m.total}</td>
<td class="delete" onclick="deleteMaterial(${i})">×</td>
`

table.appendChild(tr)

})

updateResumo(custo)

}

function deleteMaterial(i){

materiais.splice(i,1)
renderMateriais()

}

function updateResumo(custo){

let lucro=parseCurrency(document.getElementById("lucroDesejado").value)

let venda=custo+lucro

let margem=custo?((lucro/venda)*100).toFixed(1):0

document.getElementById("custoTotal").innerText=formatBRL(custo)
document.getElementById("lucroTotal").innerText=formatBRL(lucro)
document.getElementById("valorVenda").innerText=formatBRL(venda)
document.getElementById("margem").innerText=margem+"%"

}

function salvarModelo(){

let nome=document.getElementById("modeloNome").value
let base=document.getElementById("baseMedida").value
let venda=document.getElementById("valorVenda").innerText

if(!nome)return

let data=new Date().toLocaleDateString()

modelos.push({nome,base,venda,data})

renderModelos()

}

function renderModelos(){

let table=document.getElementById("listaModelos")
table.innerHTML=""

modelos.forEach((m,i)=>{

let tr=document.createElement("tr")

tr.innerHTML=`
<td>${m.nome}</td>
<td>${m.base}</td>
<td>${m.venda}</td>
<td>${m.data}</td>
<td class="delete" onclick="deleteModelo(${i})">×</td>
`

table.appendChild(tr)

})

}

function deleteModelo(i){

if(confirm("Deletar modelo?")){

modelos.splice(i,1)
renderModelos()

}

}

function filtrarModelos(){

let term=document.getElementById("searchModelo").value.toLowerCase()
let rows=document.querySelectorAll("#listaModelos tr")

rows.forEach(r=>{

let nome=r.children[0].textContent.toLowerCase()

r.style.display=nome.includes(term)?'':'none'

})

}

function gerarPDF(){

alert("PDF incluirá modelo, materiais, resumo e espaçamento (implementação completa na próxima versão).")

}

function formatCurrency(input){

let value=input.value.replace(/\D/g,"")

value=(value/100).toFixed(2)+""
value=value.replace(".",",")
value=value.replace(/(\d)(?=(\d{3})+(?!\d))/g,"$1.")
input.value="R$ "+value

}

function parseCurrency(v){

return Number(v.replace(/[^0-9]/g,''))/100 || 0

}

function formatBRL(v){

return "R$ "+v.toFixed(2).replace(".",",")

}
