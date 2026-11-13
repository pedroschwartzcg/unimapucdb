/*
  CONFIGURAÇÃO DO CAMPUS
  A equipe de desenvolvimento deve:
  1) substituir campus-map.svg pela planta oficial do pavimento;
  2) ajustar o array floors e as coordenadas x/y dos locais;
  3) trocar o nome da universidade em campusName.

  x e y são percentuais da planta (0 a 100), medidos a partir do canto
  superior esquerdo. Os dados abaixo são apenas demonstrativos.
*/
const campusConfig = {
  campusName: "Universidade Exemplo",
  floors: [
    { id: "terreo", name: "Térreo", map: "campus-map.svg" },
    { id: "primeiro", name: "1º andar", map: "campus-map.svg" }
  ],
  locations: [
    { id:"recepcao", name:"Recepção", code:"REC", category:"Serviços", floor:"terreo", x:18, y:51, icon:"⌂", description:"Atendimento e informações gerais para estudantes e visitantes." },
    { id:"biblioteca", name:"Biblioteca Central", code:"BIB", category:"Estudo", floor:"terreo", x:37, y:27, icon:"▤", description:"Acervo, mesas de estudo e atendimento da biblioteca." },
    { id:"secretaria", name:"Secretaria Acadêmica", code:"SEC", category:"Serviços", floor:"terreo", x:24, y:72, icon:"▣", description:"Atendimento acadêmico e solicitações administrativas." },
    { id:"lab01", name:"Laboratório de Informática 01", code:"LAB 01", category:"Laboratórios", floor:"terreo", x:64, y:25, icon:"⌘", description:"Laboratório de informática." },
    { id:"sala204", name:"Sala de aula 204", code:"204", category:"Salas de aula", floor:"primeiro", x:55, y:42, icon:"▦", description:"Sala de aula do bloco acadêmico." },
    { id:"auditorio", name:"Auditório", code:"AUD", category:"Salas de aula", floor:"terreo", x:78, y:68, icon:"▤", description:"Espaço para palestras, eventos e apresentações." },
    { id:"cantina", name:"Cantina", code:"CAN", category:"Alimentação", floor:"terreo", x:48, y:79, icon:"☕", description:"Área de alimentação e convivência." },
    { id:"banheiro", name:"Banheiros", code:"WC", category:"Serviços", floor:"terreo", x:84, y:35, icon:"♙", description:"Sanitários do pavimento térreo." }
  ]
};

const $ = id => document.getElementById(id);
let activeCategory = "Todos";
let selectedId = null;
let zoomLevel = 1;
let routeTarget = null;

function init() {
  $("campusName").textContent = campusConfig.campusName;
  $("mapHeading").textContent = "Campus principal";
  $("floorSelect").innerHTML = campusConfig.floors.map(f => `<option value="${f.id}">${f.name}</option>`).join("");
  $("floorSelect").addEventListener("change", changeFloor);
  $("searchInput").addEventListener("input", renderResults);
  $("resetMap").addEventListener("click", () => { zoomLevel=1; applyZoom(); });
  $("zoomIn").addEventListener("click", () => { zoomLevel=Math.min(1.8,zoomLevel+.15); applyZoom(); });
  $("zoomOut").addEventListener("click", () => { zoomLevel=Math.max(.75,zoomLevel-.15); applyZoom(); });
  $("clearFilter").addEventListener("click", () => { activeCategory="Todos"; renderFilters(); renderResults(); });
  $("floorPlan").addEventListener("error", () => {
    $("mapHeading").textContent = "Planta do campus não encontrada";
  });
  renderFilters(); renderResults(); renderMarkers();
}
function currentFloor(){ return $("floorSelect").value; }
function visibleLocations(){ return campusConfig.locations.filter(p => p.floor===currentFloor()); }
function changeFloor(){
  const floor=campusConfig.floors.find(f=>f.id===currentFloor());
  $("floorPlan").src=floor.map;
  selectedId=null; routeTarget=null;
  renderMarkers(); renderResults(); showEmptyDetails();
}
function renderFilters(){
  const cats=["Todos",...new Set(campusConfig.locations.map(p=>p.category))];
  $("filters").innerHTML=cats.map(c=>`<button class="filter-chip ${c===activeCategory?"active":""}" data-category="${c}">${c}</button>`).join("");
  $("filters").querySelectorAll("button").forEach(b=>b.addEventListener("click",()=>{
    activeCategory=b.dataset.category;renderFilters();renderResults();
  }));
}
function renderResults(){
  const query=$("searchInput").value.trim().toLocaleLowerCase("pt-BR");
  const list=visibleLocations().filter(p=>(activeCategory==="Todos"||p.category===activeCategory)&&
    (p.name+" "+p.code+" "+p.category).toLocaleLowerCase("pt-BR").includes(query));
  $("resultCount").textContent=`${list.length} ${list.length===1?"resultado":"resultados"}`;
  $("results").innerHTML=list.length?list.map(p=>`
    <button class="result-item ${selectedId===p.id?"selected":""}" data-id="${p.id}">
      <span class="result-icon">${p.icon}</span><span class="result-copy"><b>${esc(p.name)}</b><small>${esc(p.category)} · ${esc(p.code)}</small></span><span class="result-arrow">›</span>
    </button>`).join(""):`<div class="empty-results">Nenhum local encontrado neste pavimento.</div>`;
  $("results").querySelectorAll("[data-id]").forEach(b=>b.addEventListener("click",()=>selectLocation(b.dataset.id)));
}
function renderMarkers(){
  $("markers").innerHTML=visibleLocations().map(p=>`
    <button class="marker ${selectedId===p.id?"selected":""}" style="left:${p.x}%;top:${p.y}%" title="${esc(p.name)}" aria-label="${esc(p.name)}" data-id="${p.id}">${esc(p.code)}</button>`).join("");
  $("markers").querySelectorAll("[data-id]").forEach(b=>b.addEventListener("click",()=>selectLocation(b.dataset.id)));
  drawRoute();
}
function selectLocation(id){
  const p=campusConfig.locations.find(x=>x.id===id);if(!p)return;
  selectedId=id;renderMarkers();renderResults();showDetails(p);
}
function showDetails(p){
  $("detailsPanel").innerHTML=`
    <div class="detail-kicker">LOCAL SELECIONADO</div>
    <div class="detail-icon">${p.icon}</div>
    <h3 class="detail-name">${esc(p.name)}</h3>
    <p class="detail-code">${esc(p.code)} · ${esc(p.category)}</p>
    <span class="detail-tag">${esc(p.category)}</span>
    <p class="detail-description">${esc(p.description||"Informações deste espaço.")}</p>
    <div class="detail-meta"><small>PAVIMENTO</small><b>${esc(campusConfig.floors.find(f=>f.id===p.floor)?.name||p.floor)}</b></div>
    <div class="detail-meta"><small>IDENTIFICAÇÃO</small><b>${esc(p.code)}</b></div>
    <button class="directions-btn" id="routeButton">Como chegar neste local ↗</button>`;
  $("routeButton").addEventListener("click",()=> {
    routeTarget=p.id;
    $("detailsPanel").querySelector(".detail-description").textContent="Local de destino selecionado. Para navegação real, a universidade precisa cadastrar corredores, acessos e conexões entre pavimentos.";
    drawRoute();
  });
}
function showEmptyDetails(){
  $("detailsPanel").innerHTML=`<div class="details-empty"><div class="pin-illustration">⌖</div><h3>Explore o mapa</h3><p>Ao selecionar uma sala ou local, as informações aparecerão aqui.</p></div>`;
}
function drawRoute(){
  const svg=$("routeLayer");svg.innerHTML="";
  if(!routeTarget)return;
  const p=campusConfig.locations.find(x=>x.id===routeTarget);
  if(!p||p.floor!==currentFloor())return;
  const ns="http://www.w3.org/2000/svg",circle=document.createElementNS(ns,"circle");
  circle.setAttribute("cx",p.x);circle.setAttribute("cy",p.y);circle.setAttribute("r","2.4");circle.setAttribute("fill","none");circle.setAttribute("stroke","#ef8b45");circle.setAttribute("stroke-width",".55");
  svg.appendChild(circle);
}
function applyZoom(){ $("mapCanvas").style.transform=`scale(${zoomLevel})`; }
function esc(value){return String(value).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
document.addEventListener("keydown",e=>{if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==="k"){e.preventDefault();$("searchInput").focus();}});
init();
