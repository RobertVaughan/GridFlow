// Execution with exec-first topo + state writeback (so UI nodes update)
import { getGraph, transact } from "./store.js";
import { getNodeDefinition } from "./plugins.js";

const logEl = document.getElementById("log");

function topoSortExecFirst(){
  const g = getGraph();
  const execWires = g.wires.filter(w=>w.kind==="exec");
  if(execWires.length){
    const indeg = new Map(g.nodes.map(n=>[n.id,0]));
    for(const w of execWires){ indeg.set(w.to.nodeId, (indeg.get(w.to.nodeId)||0)+1); }
    const q = []; indeg.forEach((d,id)=>{ if(d===0) q.push(id); });
    const order = [];
    while(q.length){
      const id = q.shift(); order.push(id);
      for(const w of execWires.filter(w=>w.from.nodeId===id)){
        const to = w.to.nodeId; indeg.set(to, indeg.get(to)-1); if(indeg.get(to)===0) q.push(to);
      }
    }
    if(order.length !== new Set(getGraph().nodes.map(n=>n.id)).size){ throw new Error("Cycle detected in exec flow"); }
    return order;
  }
  // Fallback by data deps
  const indeg = new Map(getGraph().nodes.map(n=>[n.id,0]));
  for(const w of getGraph().wires.filter(w=>w.kind==="data")){ indeg.set(w.to.nodeId, (indeg.get(w.to.nodeId)||0)+1); }
  const q = []; indeg.forEach((d,id)=>{ if(d===0) q.push(id); });
  const order = [];
  while(q.length){
    const id = q.shift(); order.push(id);
    for(const w of getGraph().wires.filter(w=>w.kind==="data" && w.from.nodeId===id)){
      const to = w.to.nodeId; indeg.set(to, indeg.get(to)-1); if(indeg.get(to)===0) q.push(to);
    }
  }
  if(order.length !== new Set(getGraph().nodes.map(n=>n.id)).size){ throw new Error("Cycle detected"); }
  return order;
}

export async function runGraph({ deterministic=true, signal }={}){
  const g = getGraph();
  const order = topoSortExecFirst();
  const outputs = new Map();
  const logs = [];
  const cache = new Map();

  const log = (msg)=>{ logs.push(msg); logEl.textContent = [...logs].slice(-200).join("\n"); };

  log(`▶ Run start (${new Date().toLocaleTimeString()})`);
  for(const id of order){
    if(signal?.aborted) throw new Error("Aborted");
    const n = g.nodes.find(x=>x.id===id);
    const def = getNodeDefinition(n.type);
    if(!def){ log(`⚠ Unknown node type: ${n.type}`); continue; }

    // Gather only data inputs (exec defines order, not values)
    const inputMap = {};
    for(const p of n.inputs){
      if(p.dataType === "exec") continue;
      const incoming = g.wires.filter(w=>w.kind==="data" && w.to.nodeId===id && w.to.portId===p.id);
      if(!incoming.length) inputMap[p.id] = p.default ?? null;
      else if(incoming.length===1) inputMap[p.id] = outputs.get(incoming[0].from.nodeId)?.[incoming[0].from.portId];
      else inputMap[p.id] = incoming.map(w=>outputs.get(w.from.nodeId)?.[w.from.portId]);
    }

    const ctx = { in: inputMap, state: structuredClone(n.state||{}), emit: log, signal, cache, deterministic };
    try{
      const result = await def.run(ctx);
      outputs.set(id, result || {});
      // Write back any state changes from ctx.state (used by UI nodes like dialog)
      if(JSON.stringify(n.state||{}) !== JSON.stringify(ctx.state||{})){
        transact(gr=>{
          const t = gr.nodes.find(nn=>nn.id===id);
          if(t){ t.state = structuredClone(ctx.state||{}); }
        }, `State of ${n.title}`);
      }
      log(`✔ ${n.title}`);
    }catch(e){
      outputs.set(id, {});
      log(`✖ ${n.title}: ${e.message}`);
      if(def?.onError==="fail-fast") throw e;
    }
    await new Promise(r=>setTimeout(r,0));
  }
  log(`■ Run end (${new Date().toLocaleTimeString()})`);
  return outputs;
}
