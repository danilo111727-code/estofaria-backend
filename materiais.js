
let units=["metro","unidade"]
let materials=[]
let locked=true

function refreshUnits(){
let select=document.getElementById("materialUnidade")
select.innerHTML=""
units.forEach(u=>{
let opt=document.createElement("option")
opt.textContent=u
select.appendChild(opt)
})
renderUnits()
}

function renderUnits(){
let container=document.getElementById("unitsContainer")
container.innerHTML=""
units.forEach((u,i)=>{
let chip=document.createElement("div")
chip.className="unit-chip"
chip.innerHTML=`${u} <span class="delete-x">×</span>`
chip.querySelector(".delete-x").onclick=()=>{
units.splice(i,1)
refreshUnits()
}
container.appendChild(chip)
})
}

function addUnit(){
let val=document.getElementById("novaUnidade").value
if(!val)return
units.push(val)
document.getElementById("novaUnidade").value=""
refreshUnits()
}

function addMaterial(){
if(locked)return
let name=document.getElementById("materialNome").value
let unit=document.getElementById("materialUnidade").value
let value=document.getElementById("materialValor").value
if(!name)return
materials.push({name,unit,value})
document.getElementById("materialNome").value=""
document.getElementById("materialValor").value=""
renderMaterials()
}

function renderMaterials(){
let table=document.getElementById("materialsTable")
table.innerHTML=""
materials.forEach((m,i)=>{
let tr=document.createElement("tr")
let nameCell=document.createElement("td")
let unitCell=document.createElement("td")
let valueCell=document.createElement("td")
let delCell=document.createElement("td")

nameCell.textContent=m.name
unitCell.textContent=m.unit
valueCell.textContent=m.value
delCell.innerHTML='<span class="delete-x">×</span>'

if(!locked){
nameCell.contentEditable=true
unitCell.contentEditable=true
valueCell.contentEditable=true
nameCell.oninput=()=>m.name=nameCell.textContent
unitCell.oninput=()=>m.unit=unitCell.textContent
valueCell.oninput=()=>m.value=valueCell.textContent
}else{
tr.classList.add("locked")
}

delCell.onclick=()=>{
materials.splice(i,1)
renderMaterials()
}

tr.appendChild(nameCell)
tr.appendChild(unitCell)
tr.appendChild(valueCell)
tr.appendChild(delCell)

table.appendChild(tr)
})
}

function toggleLock(){
locked=!locked
let btn=document.getElementById("lockBtn")
btn.textContent = locked ? "🔒 Tabela trancada" : "🔓 Tabela destrancada"
renderMaterials()
}

function filterTable(){
let term=document.getElementById("search").value.toLowerCase()
let rows=document.querySelectorAll("#materialsTable tr")
rows.forEach(r=>{
let name=r.children[0].textContent.toLowerCase()
r.style.display=name.includes(term)?"":"none"
})
}

function formatCurrency(input){
let value=input.value.replace(/\D/g,"")
value=(value/100).toFixed(2)+""
value=value.replace(".",",")
value=value.replace(/(\d)(?=(\d{3})+(?!\d))/g,"$1.")
input.value="R$ "+value
}

refreshUnits()
renderMaterials()
