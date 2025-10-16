// Palette + search (Cmd+/) to add nodes at cursor
import { listNodes } from "../core/plugins.js";
import { addNode, getGraph, snap } from "../core/store.js";

const listEl = document.getElementById("paletteList");
const search = document.getElementById("search");

function render(){
  const items = listNodes().sort((a,b)=> a.title.localeCompare(b.title));
  listEl.innerHTML = items.map(d => `<button class="btn btn-node" data-type="${d.type}" title="${d.type}">${d.title}</button>`).join("");
  listEl.querySelectorAll("button").forEach(b => {
    b.addEventListener("click", () => spawnNode(b.dataset.type));
  });
}
function spawnNode(type){
  const def = listNodes().find(d=>d.type===type);
  const g = getGraph();
  const x = snap(80 + Math.random()*400, g.settings.gridSize);
  const y = snap(80 + Math.random()*400, g.settings.gridSize);
  const n = {
    id: crypto.randomUUID(),
    type: def.type,
    title: def.title,
    x, y,
    inputs: def.inputs?.map(p=>({...p})) || [],
    outputs: def.outputs?.map(p=>({...p})) || [],
    state: def.initialState || {},
    ui: { inspector: def.inspector || [] }
  };
  addNode(n);
}
render();
window.addEventListener("gridflow:node-registered", render);
search.addEventListener("keydown", e => {
  if(e.key === "Enter" && search.value){
    const hit = listNodes().find(d => d.title.toLowerCase().includes(search.value.toLowerCase()) || d.type.includes(search.value));
    if(hit){ spawnNode(hit.type); search.value=""; }
  }
});
document.addEventListener("keydown", e => {
  if(e.key === "/" && document.activeElement.tagName !== "INPUT"){ e.preventDefault(); search.focus(); }
});
