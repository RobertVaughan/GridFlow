// Plugin API: register nodes, port types, validators, adapters; wiring rules
// Merged/extended to include exec ports, compatibility checks, custom packs, and helpers.
import { getGraph, connectWire } from "./store.js";

/**
 * NodeDef:
 * {
 *   type: string,
 *   title: string,
 *   inputs:  PortDef[], // include exec-in as {dataType:"exec"}
 *   outputs: PortDef[], // include exec-out as {dataType:"exec"}
 *   ui?: { inspector?: InspectorField[] },
 *   run: async (ctx) => ({[outPortId]: value})
 * }
 * PortDef = { id, name, dataType: "exec"|"number"|"integer"|"string"|"boolean"|"any", multi?:boolean, default?:any }
 */

const registry = new Map(); // type -> def

// Data type registry (extensible). Include exec and common scalar types.
const portTypes = new Map([
  ["exec",   { name: "exec",   accepts: ["exec"] }],
  ["number", { name: "number", accepts: ["number", "integer"] }],
  ["integer",{ name: "integer",accepts: ["integer"] }],
  ["string", { name: "string", accepts: ["string"] }],
  ["boolean",{ name: "boolean",accepts: ["boolean"] }],
  ["any",    { name: "any",    accepts: ["any", "number", "integer", "string", "boolean", "exec"] }],
]);

// Optional value adapters (number->string, etc.)
const adapters = new Map(); // key like "number->string" => fn(val)=>converted

export function registerPortType(key, def){ portTypes.set(key, def); }
export function registerAdapter(from, to, fn){ adapters.set(`${from}->${to}`, fn); }

/** Register a node definition (basic normalization applied). */
export function registerNode(def){
  if(!def?.type) throw new Error("registerNode: def.type required");
  if(registry.has(def.type)) throw new Error(`Node type already registered: ${def.type}`);
  def.inputs  = Array.isArray(def.inputs)  ? def.inputs  : [];
  def.outputs = Array.isArray(def.outputs) ? def.outputs : [];
  registry.set(def.type, def);
  window.dispatchEvent(new CustomEvent("gridflow:nodes-changed"));
}

export function getNodeDefinition(type){ return registry.get(type); }
export function listNodes(){ return [...registry.values()]; }

/** Port compatibility using type equality, accept lists, or adapters. */
export function isPortCompatible(fromType, toType){
  if(fromType === toType) return true;
  const to = portTypes.get(toType);
  if(to?.accepts?.includes(fromType)) return true;
  return adapters.has(`${fromType}->${toType}`);
}

/** Try to adapt a value if needed, otherwise return original. */
export function adaptValue(fromType, toType, value){
  if(fromType === toType) return value;
  const key = `${fromType}->${toType}`;
  if(adapters.has(key)) return adapters.get(key)(value);
  return value;
}

/** Small cycle check following EXEC wires (prevent feedback without a delay). */
function wouldCreateExecCycle(g, from, to){
  // from = {nodeId, portId}  (out) ; to = {nodeId, portId} (in)
  const execWires = g.wires.filter(w=>w.kind==="exec");
  const succ = new Map();
  for(const w of execWires){
    const arr = succ.get(w.from.nodeId) || [];
    arr.push(w.to.nodeId);
    succ.set(w.from.nodeId, arr);
  }
  // adding edge from.nodeId -> to.nodeId
  const start = to.nodeId;
  const target = from.nodeId;
  // DFS from 'start' to see if we can reach 'target'
  const stack = [start];
  const seen = new Set();
  while(stack.length){
    const cur = stack.pop();
    if(cur === target) return true;
    if(seen.has(cur)) continue;
    seen.add(cur);
    const next = succ.get(cur) || [];
    for(const n of next) stack.push(n);
  }
  return false;
}

/** Validate wire connection (type + exec rules + cycle prevention). */
export function canConnect(from, to, kind="data"){
  const g = getGraph();
  const fromNode = g.nodes.find(n => n.id === from.nodeId);
  const toNode   = g.nodes.find(n => n.id === to.nodeId);
  if(!fromNode || !toNode) return { ok:false, reason:"Missing nodes" };

  const outPort = (fromNode.outputs||[]).find(p=>p.id===from.portId);
  const inPort  = (toNode.inputs||[]).find(p=>p.id===to.portId);
  if(!outPort || !inPort) return { ok:false, reason:"Missing ports" };

  // Direction & kind checks
  if(outPort.dataType==="exec" && inPort.dataType!=="exec") return { ok:false, reason:"Exec→Data not allowed" };
  if(outPort.dataType!=="exec" && inPort.dataType==="exec") return { ok:false, reason:"Data→Exec not allowed" };
  const inferredKind = outPort.dataType==="exec" ? "exec" : "data";
  if(kind !== inferredKind) return { ok:false, reason:"Wire kind mismatch" };

  // Exec cycle
  if(inferredKind==="exec" && wouldCreateExecCycle(g, from, to)) return { ok:false, reason:"Cycle" };

  // Data types
  if(inferredKind==="data" && !isPortCompatible(outPort.dataType, inPort.dataType)){
    return { ok:false, reason:`Type ${outPort.dataType} → ${inPort.dataType} not compatible` };
  }

  // Single vs multi
  if(!inPort.multi){
    const exists = g.wires.some(w => w.to.nodeId===to.nodeId && w.to.portId===to.portId);
    if(exists) return { ok:false, reason:"Input already connected" };
  }
  if(!outPort.multi){
    const exists = g.wires.some(w => w.from.nodeId===from.nodeId && w.from.portId===from.portId);
    if(exists) return { ok:false, reason:"Output already connected" };
  }

  return { ok:true };
}

/** Validate and connect helper, with UI toast. */
export function validateAndConnect(from, to){
  const res = canConnect(from, to);
  if(!res.ok) return toast(`Cannot connect: ${res.reason}`, "error");
  connectWire(from, to, (from && to) ? ((() => {
    const g = getGraph();
    const fromNode = g.nodes.find(n => n.id === from.nodeId);
    const outPort  = (fromNode?.outputs||[]).find(p=>p.id===from.portId);
    return outPort?.dataType==="exec" ? "exec" : "data";
  })()) : "data");
  toast("Connected", "ok");
}

/* -------------------- Custom Packs -------------------- */
/** Runtime list (populated by app boot) + helper to register a pack and its nodes. */
export function registerCustomPack(pack){
  if(!window.gridflowCustomNodes) window.gridflowCustomNodes = [];
  window.gridflowCustomNodes.push(pack);
  if(Array.isArray(pack.nodes)){
    for(const def of pack.nodes) registerNode(def);
  }
}

/* -------------------- Event helpers -------------------- */
export function fireEvent(name, detail){ window.dispatchEvent(new CustomEvent(name, { detail })); }

/* -------------------- Toast helper -------------------- */
const toastEl = document.getElementById("toast");
export function toast(msg, type="ok"){
  if(!toastEl) { console[type==="error"?"error":"log"]("[GridFlow]", msg); return; }
  toastEl.textContent = msg;
  toastEl.style.display = "block";
  toastEl.style.borderColor = type==="error" ? "var(--danger)" : "var(--accent)";
  setTimeout(()=> toastEl.style.display="none", 1200);
}
