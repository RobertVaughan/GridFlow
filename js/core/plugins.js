// Plugin API: node/port registries, adapters, compatibility & connection helpers.
// Backward-compatible with your previous file; extends with a richer type system.

import { getGraph, connectWire } from "./store.js";

/** @typedef {{ id:string, name:string, direction:"in"|"out", dataType:string, multi?:boolean, default?:any }} Port */
/** @typedef {{ type:string, title:string, inputs:Port[], outputs:Port[], ui?:any, run?:(ctx:any)=>any }} NodeDef */

// -------------------------------------------------------------------------------------
// Registries
// -------------------------------------------------------------------------------------

/** @type {Map<string, NodeDef>} */
const NODE_REGISTRY = new Map();
/** adapters[from][to] = fn(value) */
const ADAPTERS = Object.create(null);

/** Port Type Registry entry:
 * { name, aliases:string[], parents:string[], generic?:{kind:string, arity:number} }
 */
const PORT_TYPES = new Map();
const TYPE_ALIAS = new Map(); // alias -> canonical

// -------------------------------------------------------------------------------------
// Utilities: type normalization / generics
// -------------------------------------------------------------------------------------

function normType(t) {
  if (!t || typeof t !== "string") return "any";
  t = t.trim().replace(/\s+/g, "").toLowerCase();
  if (TYPE_ALIAS.has(t)) return TYPE_ALIAS.get(t);
  return t;
}

function parseGeneric(t) {
  const m = /^([a-z0-9_]+)<(.+)>$/.exec(t);
  if (!m) return null;
  const base = normType(m[1]);
  const args = [];
  let depth = 0, acc = "";
  for (const ch of m[2]) {
    if (ch === "<") depth++;
    if (ch === ">") depth--;
    if (ch === "," && depth === 0) { args.push(normType(acc)); acc = ""; continue; }
    acc += ch;
  }
  if (acc) args.push(normType(acc));
  return { base, args };
}

function isSubtype(a, b) {
  a = normType(a); b = normType(b);
  if (a === b) return true;
  const entry = PORT_TYPES.get(a);
  if (!entry) return a === b;
  if (entry.parents?.some(p => p === b)) return true;
  for (const p of (entry.parents || [])) if (isSubtype(p, b)) return true;
  return false;
}

// -------------------------------------------------------------------------------------
// Public: register types / adapters
// -------------------------------------------------------------------------------------

export function registerPortType(def) {
  // def: { name, aliases?:string[], parents?:string[], generic?:{kind, arity} }
  const name = normType(def.name);
  const entry = {
    name,
    aliases: (def.aliases || []).map(normType),
    parents: (def.parents || []).map(normType),
    generic: def.generic || null
  };
  PORT_TYPES.set(name, entry);
  TYPE_ALIAS.set(name, name);
  for (const a of entry.aliases) TYPE_ALIAS.set(a, name);
}

export function registerAdapter(from, to, fn) {
  from = normType(from); to = normType(to);
  ADAPTERS[from] ||= Object.create(null);
  ADAPTERS[from][to] = fn;
}

function getAdapter(from, to) {
  from = normType(from); to = normType(to);
  return (ADAPTERS[from] && ADAPTERS[from][to]) || null;
}

// -------------------------------------------------------------------------------------
// Node registry (unchanged API)
// -------------------------------------------------------------------------------------

export function registerNode(def) {
  if (!def?.type) throw new Error("registerNode: def.type required");
  if (NODE_REGISTRY.has(def.type)) throw new Error(`Node type already registered: ${def.type}`);
  def.inputs  = Array.isArray(def.inputs)  ? def.inputs  : [];
  def.outputs = Array.isArray(def.outputs) ? def.outputs : [];
  NODE_REGISTRY.set(def.type, def);
  window.dispatchEvent(new CustomEvent("gridflow:nodes-changed"));
}

export function getNodeDefinition(type){ return NODE_REGISTRY.get(type); }
export function listNodes(){ return [...NODE_REGISTRY.values()]; }

// -------------------------------------------------------------------------------------
// Compatibility (backward compatible signature)
// -------------------------------------------------------------------------------------

/**
 * Accepts either (fromType, toType) strings OR (fromPortObj, toPortObj) objects.
 */
export function isPortCompatible(from, to) {
  // unwrap to types
  const a = typeof from === "string" ? normType(from) : normType(from?.dataType);
  const b = typeof to   === "string" ? normType(to)   : normType(to?.dataType);

  if (!a || !b) return false;

  // exec connects only to exec
  if (a === "exec" || b === "exec") return a === "exec" && b === "exec";

  // "any" as sink (input): accepts anything
  if (b === "any") return true;

  // Generics: covariant matching per-argument
  const ga = parseGeneric(a);
  const gb = parseGeneric(b);
  if (ga && gb) {
    if (ga.base !== gb.base) return false;
    if (ga.args.length !== gb.args.length) return false;
    for (let i = 0; i < ga.args.length; i++) {
      if (!isSubtype(ga.args[i], gb.args[i])) return false;
    }
    return true;
  }
  if (!!ga !== !!gb) return false; // non-generic → generic disallowed

  // Exact or subtype
  if (a === b) return true;
  if (isSubtype(a, b)) return true;

  // Adapter available?
  if (getAdapter(a, b)) return true;

  return false;
}

/** Convert value if adapter exists; otherwise pass-through (subtype OK). */
export function adaptValue(fromType, toType, value) {
  const a = normType(fromType);
  const b = normType(toType);
  if (a === b || isSubtype(a, b)) return value;
  const ad = getAdapter(a, b);
  return ad ? ad(value) : value;
}

// -------------------------------------------------------------------------------------
// Connection validation helpers (compatible with your previous file)
// -------------------------------------------------------------------------------------

function wouldCreateExecCycle(g, from, to){
  const execWires = g.wires.filter(w=>w.kind==="exec");
  const succ = new Map();
  for(const w of execWires){
    const arr = succ.get(w.from.nodeId) || [];
    arr.push(w.to.nodeId);
    succ.set(w.from.nodeId, arr);
  }
  const start = to.nodeId;
  const target = from.nodeId;
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

export function canConnect(from, to, kind="data"){
  const g = getGraph();
  const fromNode = g.nodes.find(n => n.id === from.nodeId);
  const toNode   = g.nodes.find(n => n.id === to.nodeId);
  if(!fromNode || !toNode) return { ok:false, reason:"Missing nodes" };

  const outPort = (fromNode.outputs||[]).find(p=>p.id===from.portId);
  const inPort  = (toNode.inputs||[]).find(p=>p.id===to.portId);
  if(!outPort || !inPort) return { ok:false, reason:"Missing ports" };

  // Direction/kind
  if(outPort.dataType==="exec" && inPort.dataType!=="exec") return { ok:false, reason:"Exec→Data not allowed" };
  if(outPort.dataType!=="exec" && inPort.dataType==="exec") return { ok:false, reason:"Data→Exec not allowed" };
  const inferred = outPort.dataType==="exec" ? "exec" : "data";
  if(kind !== inferred) return { ok:false, reason:"Wire kind mismatch" };

  // Exec cycle
  if(inferred==="exec" && wouldCreateExecCycle(g, from, to)) return { ok:false, reason:"Cycle" };

  // Type compatibility
  if(inferred==="data" && !isPortCompatible(outPort, inPort)){
    return { ok:false, reason:`${outPort.dataType} → ${inPort.dataType} not compatible` };
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

export function validateAndConnect(from, to){
  const res = canConnect(from, to);
  if(!res.ok) return toast(`Cannot connect: ${res.reason}`, "error");
  const g = getGraph();
  const fromNode = g.nodes.find(n => n.id === from.nodeId);
  const outPort  = (fromNode?.outputs||[]).find(p=>p.id===from.portId);
  const kind = outPort?.dataType==="exec" ? "exec" : "data";
  connectWire(from, to, kind);
  toast("Connected", "ok");
}

// -------------------------------------------------------------------------------------
// Custom packs
// -------------------------------------------------------------------------------------
export function registerCustomPack(pack){
  if(!window.gridflowCustomNodes) window.gridflowCustomNodes = [];
  window.gridflowCustomNodes.push(pack);
  if(Array.isArray(pack.nodes)){
    for(const def of pack.nodes) registerNode(def);
  }
}

// -------------------------------------------------------------------------------------
// Toast helper (unchanged)
// -------------------------------------------------------------------------------------
const toastEl = document.getElementById("toast");
export function toast(msg, type="ok"){
  if(!toastEl) { console[type==="error"?"error":"log"]("[GridFlow]", msg); return; }
  toastEl.textContent = msg;
  toastEl.style.display = "block";
  toastEl.style.borderColor = type==="error" ? "var(--danger)" : "var(--accent)";
  setTimeout(()=> toastEl.style.display="none", 1200);
}

// -------------------------------------------------------------------------------------
// Default types & adapters (boot once)
// -------------------------------------------------------------------------------------
(function bootTypes(){
  // Bases
  registerPortType({ name:"any" });
  registerPortType({ name:"exec" });

  // Numbers
  registerPortType({ name:"value", aliases:["number"], parents:["any"] });
  registerPortType({ name:"integer", parents:["number"] });
  // Make sure number ≤ value even if aliases change later
  PORT_TYPES.get("number")?.parents?.push?.("value");

  // Text
  registerPortType({ name:"text", aliases:["string"], parents:["any"] });
  registerPortType({ name:"json", parents:["text"] });

  // Logic
  registerPortType({ name:"condition", parents:["any"] });
  registerPortType({ name:"boolean", parents:["condition"] });

  // Collections / generics
  registerPortType({ name:"array", parents:["any"] });
  registerPortType({ name:"list", generic:{kind:"list", arity:1}, parents:["array"] });
  registerPortType({ name:"object", parents:["any"] });

  // ML / media / misc (extensible)
  registerPortType({ name:"model", parents:["any"] });
  registerPortType({ name:"function", parents:["any"] });
  registerPortType({ name:"file", parents:["any"] });
  registerPortType({ name:"blob", parents:["file"] });
  registerPortType({ name:"image", parents:["blob"] });
  registerPortType({ name:"audio", parents:["blob"] });
  registerPortType({ name:"video", parents:["blob"] });
  registerPortType({ name:"vector", parents:["any"] });
  registerPortType({ name:"matrix", parents:["any"] });
  registerPortType({ name:"tensor", parents:["any"] });
  registerPortType({ name:"embedding", parents:["vector"] });
  registerPortType({ name:"date", parents:["any"] });
  registerPortType({ name:"time", parents:["any"] });
  registerPortType({ name:"datetime", parents:["any"] });
  registerPortType({ name:"color", parents:["any"] });
  registerPortType({ name:"url", parents:["text"] });

  // Adapters (safe defaults)
  registerAdapter("number",  "text", v => String(v));
  registerAdapter("integer", "text", v => String(v|0));
  registerAdapter("boolean", "text", v => String(!!v));
  registerAdapter("json",    "text", v => JSON.stringify(v));
  registerAdapter("text",    "json", v => { try { return JSON.parse(v); } catch { return null; } });
})();
