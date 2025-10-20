// Nodes slideout population (Basic Nodes)
import { listNodes } from "../core/plugins.js";
import { addNode, snap, getGraph } from "../core/store.js";
import { getWorldCenter } from "../core/renderer.js";

const nodesList = document.getElementById("nodesList");

function spawn(def){
  const { cx, cy } = getWorldCenter();
  const grid  = getGraph().settings.gridSize || 20;
  const snapOn = !!getGraph().settings.snapToGrid;

  // default size hint (used only for initial centering)
  const w = Math.max(180, def.width || 220);
  const h = Math.max(70,  def.height || 86);

  // jitter so multiple spawns don’t perfectly overlap
  const jitter = 24;
  let x = cx - w / 2 + (Math.random() * jitter - jitter/2);
  let y = cy - h / 2 + (Math.random() * jitter - jitter/2);
  if (snapOn) { x = snap(x, grid); y = snap(y, grid); }

  const n = {
    id: crypto.randomUUID(),
    type: def.type,
    title: def.title,
    x, y, width: def.width || 220, height: def.height || undefined,
    inputs: (def.inputs||[]).map(p=>({ ...p })),
    outputs:(def.outputs||[]).map(p=>({ ...p })),
    state: {},
    ui: def.ui || { inspector: def.inspector || [] }
  };
  addNode(n);
}

function render(){
  if(!nodesList) return;
  nodesList.innerHTML = "";
  const defs = listNodes().sort((a,b)=>a.title.localeCompare(b.title));
  for(const def of defs){
    const row = document.createElement("button");
    row.className = "btn";
    row.textContent = def.title;
    row.title = def.type;
    row.addEventListener("click", ()=> spawn(def));
    nodesList.appendChild(row);
  }
}

window.addEventListener("gridflow:node-registered", render);
document.addEventListener("DOMContentLoaded", render);