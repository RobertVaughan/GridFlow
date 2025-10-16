// Starter Nodes + Adapters (with exec pins on every node)
import { registerNode, registerAdapter } from "../core/plugins.js";

// Data adapters
registerAdapter("number","string", (v)=> String(v));

const EXEC_IN  = { id:"exec_in",  name:"Exec In",  direction:"in",  dataType:"exec"  };
const EXEC_OUT = { id:"exec_out", name:"Exec Out", direction:"out", dataType:"exec" };

// Flow Start: source of exec
registerNode({
  type: "flow.start",
  title: "Start",
  inputs: [], // no exec_in for the first node
  outputs: [EXEC_OUT, {id:"tick",name:"Tick",dataType:"any"}],
  run: async (ctx) => ({ tick: Date.now() })
});

registerNode({
  type: "math.add",
  title: "Add",
  inputs: [
    EXEC_IN,
    {id:"a",name:"A",dataType:"number",default:0},
    {id:"b",name:"B",dataType:"number",default:0}
  ],
  outputs: [EXEC_OUT, {id:"sum",name:"Sum",dataType:"number"}],
  inspector:[{key:"label",label:"Label",type:"text"}],
  run: async (ctx) => ({ sum: Number(ctx.in.a||0) + Number(ctx.in.b||0) })
});

registerNode({
  type: "string.concat",
  title: "Concat",
  inputs: [
    EXEC_IN,
    {id:"a",name:"A",dataType:"string",default:""},
    {id:"b",name:"B",dataType:"string",default:""}
  ],
  outputs: [EXEC_OUT, {id:"out",name:"Out",dataType:"string"}],
  run: async (ctx) => ({ out: String(ctx.in.a??"") + String(ctx.in.b??"") })
});

registerNode({
  type: "ui.log",
  title: "Log",
  inputs: [EXEC_IN, {id:"msg",name:"Message",dataType:"any"}],
  outputs: [EXEC_OUT, {id:"out",name:"Out",dataType:"any"}],
  run: async (ctx) => { ctx.emit(String(ctx.in.msg)); return { out: ctx.in.msg }; }
});

registerNode({
  type: "http.request",
  title: "HTTP Request",
  inputs: [
    EXEC_IN,
    {id:"url",name:"URL",dataType:"string"},
    {id:"method",name:"Method",dataType:"string",default:"GET"},
    {id:"body",name:"Body",dataType:"any"}
  ],
  outputs: [EXEC_OUT, {id:"status",name:"Status",dataType:"number"}, {id:"json",name:"JSON",dataType:"any"}],
  inspector:[{key:"headers",label:"Headers (JSON)",type:"json"}],
  run: async (ctx) => {
    const r = await fetch(ctx.in.url, { method: ctx.in.method||"GET", body: ctx.in.body ? JSON.stringify(ctx.in.body) : undefined, headers: ctx.state.headers||{} });
    let json = null; try{ json = await r.json(); }catch{}
    return { status: r.status, json };
  }
});
