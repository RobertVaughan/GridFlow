// Plugin API: register nodes, port types, validators, adapters; wiring rules
import { getGraph, connectWire } from "./store.js";

const registry = new Map(); // type -> def
const portTypes = new Map([
  ["number",{name:"number"}],
  ["string",{name:"string"}],
  ["boolean",{name:"boolean"}],
  ["any",{name:"any"}]
]);
const adapters = new Map(); // key like "number->string" => fn(val)=>converted

export function registerPortType(key, def){ portTypes.set(key, def); }
export function registerAdapter(from, to, fn){ adapters.set(`${from}->${to}`, fn); }
export function registerNode(def){
  registry.set(def.type, def);
  const evt = new CustomEvent("gridflow:node-registered", { detail: def });
  window.dispatchEvent(evt);
}
export function getNodeDefinition(type){ return registry.get(type); }
export function listNodes(){ return [...registry.values()]; }

export function isPortCompatible(from, to){
  // Validate using dataType match or adapters
  const g = getGraph();
  const fromNode = g.nodes.find(n=>n.id===from.nodeId);
  const toNode = g.nodes.find(n=>n.id===to.nodeId);
  if(!fromNode || !toNode) return false;
  const out = fromNode.outputs.find(p=>p.id===from.portId);
  const inp = toNode.inputs.find(p=>p.id===to.portId);
  if(!out || !inp) return false;
  if(out.dataType === "any" || inp.dataType === "any") return true;
  if(out.dataType === inp.dataType) return true;
  return adapters.has(`${out.dataType}->${inp.dataType}`);
}

// Wire attempt handler: enforce multi=false and cycles avoidance (basic)
window.addEventListener("gridflow:wire-attempt", e => {
  const { from, to } = e.detail;
  if(!isPortCompatible(from, to)) return toast("Incompatible ports", "error");
  // Prevent multiple wires into single non-multi input
  const g = getGraph();
  const toNode = g.nodes.find(n=>n.id===to.nodeId);
  const inp = toNode.inputs.find(p=>p.id===to.portId);
  if(!inp?.multi){
    if(g.wires.some(w=>w.to.nodeId===to.nodeId && w.to.portId===to.portId)){
      return toast("Input already connected", "error");
    }
  }
  // Naive cycle detection: disallow connecting if it would make to reach from => simple DFS
  const reach = new Set();
  function dfs(id){ if(reach.has(id)) return; reach.add(id); for(const w of g.wires.filter(w=>w.from.nodeId===id)) dfs(w.to.nodeId); }
  dfs(to.nodeId);
  if(reach.has(from.nodeId)) return toast("Cycle blocked", "error");
  connectWire(from, to);
  toast("Connected", "ok");
});

// Toast helper
const toastEl = document.getElementById("toast");
export function toast(msg, type="ok"){
  if(!toastEl) return alert(msg);
  toastEl.textContent = msg;
  toastEl.style.display = "block";
  toastEl.style.borderColor = type==="error" ? "var(--danger)" : "var(--accent)";
  setTimeout(()=> toastEl.style.display="none", 1200);
}
