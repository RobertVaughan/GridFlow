// GridFlow Execution: exec graph order + data propagation, async run, logs
import { getGraph } from "./store.js";
import { getNodeDefinition } from "./plugins.js";

const logEl = document.getElementById("log");

/** Topo sort based on EXEC wires; if none exist, fall back to DATA dependencies. */
function topoSortExecFirst(){
  const g = getGraph();
  const execWires = g.wires.filter(w=>w.kind==="exec");
  if(execWires.length){
    const indeg = new Map(g.nodes.map(n=>[n.id,0]));
    for(const w of execWires){
      indeg.set(w.to.nodeId, (indeg.get(w.to.nodeId)||0)+1);
    }
    const q = [];
    indeg.forEach((d,id)=>{ if(d===0) q.push(id); });
    const order = [];
    while(q.length){
      const id = q.shift(); order.push(id);
      for(const w of execWires.filter(w=>w.from.nodeId===id)){
        const to = w.to.nodeId;
        indeg.set(to, indeg.get(to)-1);
        if(indeg.get(to)===0) q.push(to);
      }
    }
    if(order.length !== new Set(g.nodes.map(n=>n.id)).size){
      throw new Error("Cycle detected in exec flow");
    }
    return order;
  }
  // Fallback: topo via data dependencies only
  const indeg = new Map(g.nodes.map(n=>[n.id,0]));
  for(const w of g.wires.filter(w=>w.kind==="data")){
    indeg.set(w.to.nodeId, (indeg.get(w.to.nodeId)||0)+1);
  }
  const q = []; indeg.forEach((d,id)=>{ if(d===0) q.push(id); });
  const order = [];
  while(q.length){
    const id = q.shift(); order.push(id);
    for(const w of g.wires.filter(w=>w.kind==="data" && w.from.nodeId===id)){
      const to = w.to.nodeId;
      indeg.set(to, indeg.get(to)-1);
      if(indeg.get(to)===0) q.push(to);
    }
  }
  if(order.length !== new Set(getGraph().nodes.map(n=>n.id)).size){
    throw new Error("Cycle detected");
  }
  return order;
}

export async function runGraph({ deterministic=true, signal }={}){
  const g = getGraph();
  const order = topoSortExecFirst();
  const cache = new Map();
  const outputs = new Map();
  const logs = [];
  function log(msg){ logs.push(msg); logEl.textContent = [...logs].slice(-200).join("\n"); }

  log(`▶ Run start (${new Date().toLocaleTimeString()})`);
  for(const id of order){
    if(signal?.aborted) throw new Error("Aborted");
    const n = g.nodes.find(x=>x.id===id);
    const def = getNodeDefinition(n.type);
    if(!def) { log(`⚠ Unknown node type: ${n.type}`); continue; }

    // gather DATA inputs only (exec is just order)
    const inputMap = {};
    for(const p of n.inputs){
      if(p.dataType === "exec") continue;
      const incoming = g.wires.filter(w=>w.kind==="data" && w.to.nodeId===id && w.to.portId===p.id);
      if(!incoming.length){
        inputMap[p.id] = p.default ?? null;
      }else if(incoming.length===1){
        inputMap[p.id] = outputs.get(incoming[0].from.nodeId)?.[incoming[0].from.portId];
      }else{
        inputMap[p.id] = incoming.map(w=>outputs.get(w.from.nodeId)?.[w.from.portId]);
      }
    }

    const ctx = { in: inputMap, state: n.state||{}, emit: log, cache, signal, deterministic };
    try{
      const result = await def.run(ctx);
      outputs.set(id, result||{});
      log(`✔ ${n.title}`);
    }catch(e){
      outputs.set(id, {});
      log(`✖ ${n.title}: ${e.message}`);
      if(def?.onError==="fail-fast") throw e;
    }
    await new Promise(r=>setTimeout(r,0)); // cooperative yield
  }
  log(`■ Run end (${new Date().toLocaleTimeString()})`);
  return outputs;
}