// GridFlow Execution: exec graph order + data propagation, async run, logs
// Merged to keep your logging UX while adding deterministic exec, value cache, adapters, and error isolation.
import { getGraph } from "./store.js";
import { getNodeDefinition, isPortCompatible, adaptValue } from "./plugins.js";

const logEl = document.getElementById("log");

// Value cache: Map<nodeId, {[outPortId]: any}>
const valueCache = new Map();
// Node status (for UI): Map<nodeId, {status, lastError?, logs:[]}>
const nodeStatus = new Map();

function resetRuntime(){
  valueCache.clear();
  nodeStatus.clear();
}

function uiLog(line){
  if(!logEl){ console.log(line); return; }
  const div = document.createElement("div");
  div.textContent = line;
  logEl.appendChild(div);
  logEl.scrollTop = logEl.scrollHeight;
}
function setStatus(nodeId, patch){
  const s = nodeStatus.get(nodeId) || { status:"idle", logs:[] };
  Object.assign(s, patch);
  nodeStatus.set(nodeId, s);
  window.dispatchEvent(new CustomEvent("gridflow:node-status", { detail:{ nodeId, ...s } }));
}
function pushNodeLog(nodeId, msg){
  const s = nodeStatus.get(nodeId) || { status:"idle", logs:[] };
  s.logs.push(String(msg));
  nodeStatus.set(nodeId, s);
  window.dispatchEvent(new CustomEvent("gridflow:node-log", { detail:{ nodeId, msg } }));
}

/** Build inbound/outbound wire indices. */
function buildIndex(g){
  const byId = new Map(g.nodes.map(n=>[n.id,n]));
  const outs = new Map(); // nodeId -> [{wire, toNode}]
  const ins  = new Map(); // nodeId -> [{wire, fromNode}]
  for(const w of g.wires){
    const fn = byId.get(w.from.nodeId);
    const tn = byId.get(w.to.nodeId);
    if(!fn || !tn) continue;
    (outs.get(fn.id) || outs.set(fn.id, []).get(fn.id)).push({ wire:w, toNode:tn });
    (ins.get(tn.id)  || ins.set(tn.id,  []).get(tn.id)).push({ wire:w, fromNode:fn });
  }
  return { byId, outs, ins };
}

function getPort(node, id, dir){
  const ports = dir==="in" ? node.inputs : node.outputs;
  return ports.find(p=>p.id===id);
}

/** Resolve data inputs for a node using cached upstream values (apply adapters if needed). */
function readInputValues(node, ins){
  const inputMap = {};
  const conns = ins.get(node.id) || [];
  for(const { wire, fromNode } of conns){
    const inPort  = getPort(node, wire.to.portId, "in");
    const outPort = getPort(fromNode, wire.from.portId, "out");
    if(!inPort || !outPort) continue;
    if(inPort.dataType==="exec" || outPort.dataType==="exec") continue;
    if(!isPortCompatible(outPort.dataType, inPort.dataType)) {
      throw new Error(`Type mismatch: ${fromNode.title}.${outPort.name} -> ${node.title}.${inPort.name}`);
    }
    const upstream = valueCache.get(fromNode.id)?.[outPort.id];
    if(upstream !== undefined){
      inputMap[inPort.id] = adaptValue(outPort.dataType, inPort.dataType, upstream);
    }
  }
  // defaults
  for(const p of (node.inputs||[])){
    if(p.dataType!=="exec" && inputMap[p.id] === undefined && p.default !== undefined){
      inputMap[p.id] = p.default;
    }
  }
  return inputMap;
}

/** Exec successors (only through exec wires) */
function nextExecTargets(node, outs){
  const res = [];
  for(const edge of (outs.get(node.id) || [])){
    const w = edge.wire;
    const to = edge.toNode;
    const op = getPort(node, w.from.portId, "out");
    const ip = getPort(to,   w.to.portId, "in");
    if(op?.dataType==="exec" && ip?.dataType==="exec") res.push(to);
  }
  return res;
}

/** Deterministic queue order: by title, then id. */
function stableSortNodes(list){
  return list.sort((a,b)=> (a.title||"").localeCompare(b.title||"") || a.id.localeCompare(b.id));
}

/** Topo sort based on EXEC wires; if none exist, fall back to DATA dependencies (kept for compatibility). */
function topoSortExecFirst(){
  const g = getGraph();
  const execWires = g.wires.filter(w=>w.kind==="exec");
  if(execWires.length){
    const indeg = new Map(g.nodes.map(n=>[n.id,0]));
    for(const w of execWires) indeg.set(w.to.nodeId, (indeg.get(w.to.nodeId)||0)+1);
    const q = [];
    for(const n of g.nodes){ if((indeg.get(n.id)||0)===0) q.push(n); }
    stableSortNodes(q);
    const out = [];
    const adj = new Map();
    for(const w of execWires){
      const arr = adj.get(w.from.nodeId) || [];
      arr.push(w.to.nodeId);
      adj.set(w.from.nodeId, arr);
    }
    while(q.length){
      const n = q.shift();
      out.push(n);
      for(const v of (adj.get(n.id)||[])){
        indeg.set(v, (indeg.get(v)||0)-1);
        if(indeg.get(v)===0){
          const nn = g.nodes.find(x=>x.id===v);
          if(nn) { q.push(nn); stableSortNodes(q); }
        }
      }
    }
    return out;
  }

  // Fallback: simple data dependency order (very lightweight)
  return stableSortNodes([...g.nodes]);
}

/** Public: read the last computed values for a node (for inspector/debug). */
export function getNodeValues(nodeId){ return valueCache.get(nodeId) || {}; }

/** Main runner: deterministic exec graph traversal, with async run() support and per-node isolation. */
export async function runGraph({ signal, deterministic=true } = {}){
  resetRuntime();
  uiLog(`● Run start (${new Date().toLocaleTimeString()})`);

  const g = getGraph();
  const { outs, ins } = buildIndex(g);

  // Start set: exec graph roots or implicit start nodes (no exec-in but have exec-out)
  const explicitOrder = topoSortExecFirst();
  const roots = g.nodes.filter(n=>{
    const hasExecIn  = (n.inputs||[]).some(p=>p.dataType==="exec");
    const hasExecOut = (n.outputs||[]).some(p=>p.dataType==="exec");
    return (!hasExecIn && hasExecOut) || n.type==="flow.start";
  });
  const queue = stableSortNodes(roots.length ? roots : explicitOrder.slice());

  // Cooperative BFS over exec edges
  while(queue.length){
    if(signal?.aborted) { uiLog("■ Run aborted"); break; }
    const node = queue.shift();
    const def  = getNodeDefinition(node.type);
    if(!def?.run){ uiLog(`! Missing run() for ${node.title}`); continue; }

    setStatus(node.id, { status:"running" });
    const log = (m)=>{ uiLog(String(m)); pushNodeLog(node.id, m); };
    const emit = (values={})=>{
      const curr = valueCache.get(node.id) || {};
      Object.assign(curr, values);
      valueCache.set(node.id, curr);
      window.dispatchEvent(new CustomEvent("gridflow:data", { detail:{ nodeId: node.id, values } }));
    };

    try{
      const inputMap = readInputValues(node, ins);
      const ctx = { in: inputMap, state: node.state||{}, emit, cache: valueCache, signal, deterministic, node };
      const result = await def.run(ctx);
      if(result && typeof result === "object") emit(result);
      setStatus(node.id, { status:"done" });
      uiLog(`✔ ${node.title}`);
    }catch(e){
      setStatus(node.id, { status:"error", lastError: String(e?.message||e) });
      uiLog(`✖ ${node.title}: ${e?.message||e}`);
      // continue; errors are contained per node
    }

    // Enqueue successors along exec edges
    const next = stableSortNodes(nextExecTargets(node, outs));
    queue.push(...next);

    // Yield to keep UI responsive
    await new Promise(r=>setTimeout(r,0));
  }

  uiLog(`■ Run end (${new Date().toLocaleTimeString()})`);
  return valueCache; // Map for advanced uses (displays/inspectors)
}
