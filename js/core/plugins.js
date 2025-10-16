// Plugin API: nodes, port types, validators, adapters; wiring rules + sandbox nodes + option resolvers
import { getGraph, connectWire } from "./store.js";

const registry = new Map(); // type -> def
const portTypes = new Map([
  ["number",{name:"number"}],
  ["string",{name:"string"}],
  ["boolean",{name:"boolean"}],
  ["any",{name:"any"}],
  ["exec",{name:"exec"}],
]);
const adapters = new Map(); // "number->string" => fn

// ---- Option resolvers (async) for inspector select fields ----
const optionResolvers = new Map();
/** Register an async options resolver by key, e.g., "ollamaModels" */
export function registerOptionResolver(key, fn){ optionResolvers.set(key, fn); }
export function listOptionResolvers(){ return [...optionResolvers.keys()]; }
export async function resolveOptions(key){
  const fn = optionResolvers.get(key);
  if(!fn) return [];
  try{ return await fn(); }catch{ return []; }
}

// ---- Node registration ----
export function registerPortType(key, def){ portTypes.set(key, def); }
export function registerAdapter(from, to, fn){ adapters.set(`${from}->${to}`, fn); }
export function registerNode(def){
  registry.set(def.type, def);
  window.dispatchEvent(new CustomEvent("gridflow:node-registered", { detail: def }));
}
export function getNodeDefinition(type){ return registry.get(type); }
export function listNodes(){ return [...registry.values()]; }

// ---- Sandbox nodes ----
let worker = null;
let msgId = 0;
function getWorker(){
  if(worker) return worker;
  worker = new Worker("./js/sandbox/sandbox_worker.js", { type: "module" });
  return worker;
}

/** Register a node whose `run` executes in a Web Worker using user-provided `code` */
export function registerSandboxNode({ type, title, inputs=[], outputs=[], inspector=[], code }){
  registerNode({
    type, title, inputs, outputs, inspector,
    run: async (ctx) => {
      const w = getWorker();
      const id = ++msgId;
      return await new Promise((resolve, reject)=>{
        const onMsg = (e)=>{
          if(e.data?.msgId !== id) return;
          w.removeEventListener("message", onMsg);
          if(e.data.ok) resolve(e.data.result || {}); else reject(new Error(e.data.error));
        };
        w.addEventListener("message", onMsg);
        w.postMessage({ msgId:id, code, ctx });
      });
    }
  });
}

/** Validate port compatibility depending on kind (data vs exec). */
export function isPortCompatible(from, to, kind){
  const g = getGraph();
  const fromNode = g.nodes.find(n=>n.id===from.nodeId);
  const toNode = g.nodes.find(n=>n.id===to.nodeId);
  if(!fromNode || !toNode) return false;

  const out = fromNode.outputs.find(p=>p.id===from.portId);
  const inp = toNode.inputs.find(p=>p.id===to.portId);
  if(!out || !inp) return false;

  const isExec = (out.dataType==="exec" && inp.dataType==="exec");
  if(kind === "exec" || isExec){
    return out.direction==="out" && inp.direction==="in";
  }
  if(out.dataType === "any" || inp.dataType === "any") return true;
  if(out.dataType === inp.dataType) return true;
  return adapters.has(`${out.dataType}->${inp.dataType}`);
}

// Handle connection attempts from renderer
window.addEventListener("gridflow:wire-attempt", e => {
  const { from, to, kind } = e.detail;
  if(!isPortCompatible(from, to, kind)) return toast("Incompatible ports", "error");

  const g = getGraph();
  const toNode = g.nodes.find(n=>n.id===to.nodeId);
  const inp = toNode.inputs.find(p=>p.id===to.portId);

  if((inp.dataType==="exec" || kind==="exec") && g.wires.some(w=>w.kind==="exec" && w.to.nodeId===to.nodeId && w.to.portId===to.portId)){
    return toast("Exec input already connected", "error");
  }
  if(inp.dataType!=="exec" && !inp?.multi){
    if(g.wires.some(w=>w.kind==="data" && w.to.nodeId===to.nodeId && w.to.portId===to.portId)){
      return toast("Input already connected", "error");
    }
  }
  connectWire(from, to, (kind || (inp.dataType==="exec" ? "exec":"data")));
  toast("Connected", "ok");
});

// Toast helper
const toastEl = document.getElementById("toast");
export function toast(msg, type="ok"){
  if(!toastEl) return console.log(msg);
  toastEl.textContent = msg;
  toastEl.style.display = "block";
  toastEl.style.borderColor = type==="error" ? "var(--danger)" : "var(--accent)";
  setTimeout(()=> toastEl.style.display="none", 1200);
}