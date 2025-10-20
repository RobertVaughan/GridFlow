// Starter Nodes + Adapters (standardized with explicit port directions)
import { registerNode, registerAdapter } from "../core/plugins.js";

/* ---------------- Adapters ---------------- */
registerAdapter("number","string",(v)=> String(v));
registerAdapter("integer","number",(v)=> Number(v));
registerAdapter("string","number",(v)=> parseFloat(v));

/* ---------------- Shared exec pins ---------------- */
const EXEC_IN  = { id:"exec_in",  name:"Exec In",  direction:"in",  dataType:"exec"  };
const EXEC_OUT = { id:"exec_out", name:"Exec Out", direction:"out", dataType:"exec" };

/* ========================================================================== */
/* FLOW */
/* ========================================================================== */

registerNode({
  type: "flow.start",
  title: "Start",
  inputs: [],
  outputs: [
    EXEC_OUT,
    { id:"tick", name:"Tick", direction:"out", dataType:"any" }
  ],
  run: async () => ({ tick: Date.now() })
});

registerNode({
  type: "flow.end",
  title: "End",
  inputs: [ EXEC_IN ],
  outputs: [],
  run: async (ctx) => { ctx.log?.("End reached"); }
});

/* ========================================================================== */
/* UTILITIES (generators) */
/* Integer/String expose a value OUTPUT on the right, editable via Properties */
/* ========================================================================== */

registerNode({
  type: "util.integer",
  title: "Integer",
  inputs: [ EXEC_IN ],
  outputs: [
    EXEC_OUT,
    { id:"value", name:"Value", direction:"out", dataType:"integer" }
  ],
  inspector: [{ key:"value", label:"Value", type:"number" }],
  run: async (ctx) => {
    const v = Number.isFinite(Number(ctx.state?.value)) ? Number(ctx.state.value) : 0;
    ctx.emit({ value: v|0 });
  }
});

registerNode({
  type: "util.string",
  title: "String",
  inputs: [ EXEC_IN ],
  outputs: [
    EXEC_OUT,
    { id:"value", name:"Value", direction:"out", dataType:"string" }
  ],
  inspector: [{ key:"text", label:"Text", type:"text" }],
  run: async (ctx) => {
    const s = String(ctx.state?.text ?? "");
    ctx.emit({ value: s });
  }
});

/* ========================================================================== */
/* MATH (A,B inputs on left; Result is an OUTPUT on the right) */
/* ========================================================================== */

function math2({ type, title, op }){
  registerNode({
    type, title,
    inputs: [
      EXEC_IN,
      { id:"a", name:"A", direction:"in", dataType:"number", default:0 },
      { id:"b", name:"B", direction:"in", dataType:"number", default:0 }
    ],
    outputs: [
      EXEC_OUT,
      { id:"result", name:"Result", direction:"out", dataType:"number" }
    ],
    inspector: [{ key:"label", label:"Label", type:"text" }],
    run: async (ctx) => {
      const a = Number(ctx.in.a ?? 0);
      const b = Number(ctx.in.b ?? 0);
      return { result: op(a,b) };
    }
  });
}

math2({ type:"math.add",      title:"Add",      op:(a,b)=> a+b });
math2({ type:"math.subtract", title:"Subtract", op:(a,b)=> a-b });
math2({ type:"math.multiply", title:"Multiply", op:(a,b)=> a*b });
math2({ type:"math.divide",   title:"Divide",   op:(a,b)=> (b===0 ? NaN : a/b) });

/* ========================================================================== */
/* STRINGS */
/* ========================================================================== */

registerNode({
  type: "string.concat",
  title: "Concat",
  inputs: [
    EXEC_IN,
    { id:"a", name:"A", direction:"in", dataType:"string", default:"" },
    { id:"b", name:"B", direction:"in", dataType:"string", default:"" }
  ],
  outputs: [
    EXEC_OUT,
    { id:"out", name:"Out", direction:"out", dataType:"string" }
  ],
  run: async (ctx) => ({ out: String(ctx.in.a ?? "") + String(ctx.in.b ?? "") })
});

/* ========================================================================== */
/* UI */
/* ========================================================================== */

registerNode({
  type: "ui.log",
  title: "Log",
  inputs: [
    EXEC_IN,
    { id:"msg", name:"Message", direction:"in", dataType:"any" }
  ],
  outputs: [
    EXEC_OUT,
    { id:"out", name:"Out", direction:"out", dataType:"any" }
  ],
  run: async (ctx) => {
    const msg = ctx.in.msg;
    ctx.log?.(msg);
    ctx.emit({ out: msg });
    return { out: msg };
  }
});

registerNode({
  type: "ui.display.text",
  title: "Text Display",
  inputs: [
    EXEC_IN,
    { id:"value", name:"Value", direction:"in", dataType:"any" }
  ],
  outputs: [ EXEC_OUT ],
  run: async (ctx) => {
    const val = ctx.in.value;
    window.dispatchEvent(new CustomEvent("gridflow:display", {
      detail: { kind:"text", value: val }
    }));
    ctx.log?.(`Display: ${val}`);
  }
});

/* ========================================================================== */
/* HTTP */
/* ========================================================================== */

registerNode({
  type: "http.request",
  title: "HTTP Request",
  inputs: [
    EXEC_IN,
    { id:"url",    name:"URL",    direction:"in", dataType:"string" },
    { id:"method", name:"Method", direction:"in", dataType:"string", default:"GET" },
    { id:"body",   name:"Body",   direction:"in", dataType:"any" }
  ],
  outputs: [
    EXEC_OUT,
    { id:"status", name:"Status", direction:"out", dataType:"number" },
    { id:"json",   name:"JSON",   direction:"out", dataType:"any" }
  ],
  inspector: [{ key:"headers", label:"Headers (JSON)", type:"json" }],
  run: async (ctx) => {
    try{
      const headers = ctx.state?.headers || {};
      const res = await fetch(ctx.in.url, {
        method: ctx.in.method || "GET",
        body: ctx.in.body ? JSON.stringify(ctx.in.body) : undefined,
        headers
      });
      let json = null; try{ json = await res.json(); }catch{}
      ctx.emit({ status: res.status, json });
      return { status: res.status, json };
    }catch(err){
      ctx.log?.("HTTP Error: " + (err?.message || err));
      return { status: 0, json: null };
    }
  }
});
