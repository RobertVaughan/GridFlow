/**
 * Built-in example nodes for GridFlow / NodeSmith
 * Works with the core plugin API: registerNode(def)
 *
 * Assumptions (from your core):
 * - registerNode({ type, title, inputs, outputs, inspector, run })
 * - ctx.in : object of resolved input values by id
 * - ctx.state : mutable per-node state object
 * - ctx.emit(type, payload) : "log" | "render" | "error" | "progress"
 * - ctx.signal : AbortSignal for cancellation
 * - ctx.cache : Map-like for memoization
 * - Return value: object mapping output port ids → values
 */

import { registerNode } from "../core/plugins.js";

/* ------------------------- Utilities ------------------------- */

function toNumber(v, fallback = 0) {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && !isNaN(+v)) return +v;
  return fallback;
}
function assertFinite(n, label = "value") {
  if (!Number.isFinite(n)) throw new Error(`Invalid ${label}`);
}

/* ------------------------- Constants ------------------------- */

registerNode({
  type: "const.int",
  title: "Integer",
  inputs: [],
  outputs: [{ id: "value", name: "Value", direction: "out", dataType: "number" }],
  inspector: [
    { key: "value", label: "Value", type: "number" }
  ],
  run: async (ctx) => {
    const n = toNumber(ctx.state?.value ?? 0, 0);
    return { value: n };
  }
});

registerNode({
  type: "const.string",
  title: "String",
  inputs: [],
  outputs: [{ id: "value", name: "Value", direction: "out", dataType: "string" }],
  inspector: [
    { key: "value", label: "Value", type: "text" }
  ],
  run: async (ctx) => ({ value: String(ctx.state?.value ?? "") })
});

/* ------------------------- Math ------------------------- */

registerNode({
  type: "math.add",
  title: "Add",
  inputs: [
    { id: "a", name: "A", direction: "in", dataType: "number" },
    { id: "b", name: "B", direction: "in", dataType: "number" },
    // extra is optional, and can be multi-connected (engine should fan-in)
    { id: "extra", name: "Extra", direction: "in", dataType: "number", multi: true }
  ],
  outputs: [{ id: "sum", name: "Sum", direction: "out", dataType: "number" }],
  inspector: [],
  run: async (ctx) => {
    let sum = 0;
    sum += toNumber(ctx.in.a);
    sum += toNumber(ctx.in.b);
    const extras = Array.isArray(ctx.in.extra) ? ctx.in.extra : (ctx.in.extra != null ? [ctx.in.extra] : []);
    for (const v of extras) sum += toNumber(v);
    return { sum };
  }
});

registerNode({
  type: "math.sub",
  title: "Subtract",
  inputs: [
    { id: "a", name: "A", direction: "in", dataType: "number" },
    { id: "b", name: "B", direction: "in", dataType: "number" },
    { id: "extra", name: "Extra", direction: "in", dataType: "number", multi: true }
  ],
  outputs: [{ id: "diff", name: "Result", direction: "out", dataType: "number" }],
  run: async (ctx) => {
    let out = toNumber(ctx.in.a);
    out -= toNumber(ctx.in.b);
    const extras = Array.isArray(ctx.in.extra) ? ctx.in.extra : (ctx.in.extra != null ? [ctx.in.extra] : []);
    for (const v of extras) out -= toNumber(v);
    return { diff: out };
  }
});

registerNode({
  type: "math.mul",
  title: "Multiply",
  inputs: [
    { id: "a", name: "A", direction: "in", dataType: "number" },
    { id: "b", name: "B", direction: "in", dataType: "number" },
    { id: "extra", name: "Extra", direction: "in", dataType: "number", multi: true }
  ],
  outputs: [{ id: "prod", name: "Product", direction: "out", dataType: "number" }],
  run: async (ctx) => {
    let out = 1;
    out *= toNumber(ctx.in.a, 1);
    out *= toNumber(ctx.in.b, 1);
    const extras = Array.isArray(ctx.in.extra) ? ctx.in.extra : (ctx.in.extra != null ? [ctx.in.extra] : []);
    for (const v of extras) out *= toNumber(v, 1);
    return { prod: out };
  }
});

registerNode({
  type: "math.div",
  title: "Divide",
  inputs: [
    { id: "a", name: "A (numerator)", direction: "in", dataType: "number" },
    { id: "b", name: "B (denominator)", direction: "in", dataType: "number" }
  ],
  outputs: [{ id: "quot", name: "Quotient", direction: "out", dataType: "number" }],
  run: async (ctx) => {
    const a = toNumber(ctx.in.a);
    const b = toNumber(ctx.in.b);
    assertFinite(a, "A");
    assertFinite(b, "B");
    if (b === 0) throw new Error("Divide by zero");
    return { quot: a / b };
  }
});

/* ------------------------- Flow / Utility ------------------------- */

registerNode({
  type: "flow.if",
  title: "If",
  inputs: [
    { id: "cond", name: "Condition", direction: "in", dataType: "boolean" },
    { id: "t", name: "Then", direction: "in", dataType: "any" },
    { id: "f", name: "Else", direction: "in", dataType: "any" }
  ],
  outputs: [{ id: "out", name: "Out", direction: "out", dataType: "any" }],
  inspector: [],
  run: async (ctx) => {
    const cond = !!ctx.in.cond;
    return { out: cond ? ctx.in.t : ctx.in.f };
  }
});

registerNode({
  type: "flow.delay",
  title: "Delay",
  inputs: [
    { id: "in", name: "In", direction: "in", dataType: "any" },
    { id: "ms", name: "ms", direction: "in", dataType: "number" }
  ],
  outputs: [{ id: "out", name: "Out", direction: "out", dataType: "any" }],
  inspector: [{ key: "ms", label: "Default ms", type: "number" }],
  run: async (ctx) => {
    const ms = toNumber(ctx.in.ms ?? ctx.state?.ms ?? 0, 0);
    await new Promise((res, rej) => {
      const t = setTimeout(res, ms);
      ctx.signal?.addEventListener("abort", () => { clearTimeout(t); rej(new Error("Cancelled")); }, { once: true });
    });
    return { out: ctx.in.in };
  }
});

registerNode({
  type: "util.log",
  title: "Log",
  inputs: [{ id: "in", name: "In", direction: "in", dataType: "any" }],
  outputs: [{ id: "out", name: "Out", direction: "out", dataType: "any" }],
  inspector: [{ key: "label", label: "Label", type: "text" }],
  run: async (ctx) => {
    const label = ctx.state?.label ?? "Log";
    ctx.emit?.("log", { level: "info", message: `${label}: ${JSON.stringify(ctx.in.in)}` });
    return { out: ctx.in.in };
  }
});

registerNode({
  type: "text.concat",
  title: "Concat",
  inputs: [
    { id: "a", name: "A", direction: "in", dataType: "string" },
    { id: "b", name: "B", direction: "in", dataType: "string" },
    { id: "extra", name: "Extra", direction: "in", dataType: "string", multi: true }
  ],
  outputs: [{ id: "out", name: "Out", direction: "out", dataType: "string" }],
  inspector: [{ key: "sep", label: "Separator", type: "text" }],
  run: async (ctx) => {
    const sep = ctx.state?.sep ?? "";
    const parts = [ctx.in.a ?? "", ctx.in.b ?? ""];
    const extras = Array.isArray(ctx.in.extra) ? ctx.in.extra : (ctx.in.extra != null ? [ctx.in.extra] : []);
    for (const v of extras) parts.push(v ?? "");
    return { out: parts.join(sep) };
  }
});

registerNode({
  type: "text.display",
  title: "Display Text",
  inputs: [{ id: "in", name: "In", direction: "in", dataType: "string" }],
  outputs: [],
  inspector: [{ key: "mono", label: "Monospace", type: "toggle" }],
  run: async (ctx) => {
    const text = String(ctx.in.in ?? "");
    // Renderer should catch "render" events with { html } and place inside node body
    const mono = ctx.state?.mono ? ' style="font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;"' : "";
    ctx.emit?.("render", { html: `<div class="dialog-window"${mono}>${escapeHtml(text)}</div>` });
    return {};
  }
});

registerNode({
  type: "json.parse",
  title: "Parse JSON",
  inputs: [{ id: "text", name: "JSON Text", direction: "in", dataType: "string" }],
  outputs: [{ id: "obj", name: "Object", direction: "out", dataType: "json" }],
  run: async (ctx) => {
    const t = String(ctx.in.text ?? "");
    try {
      return { obj: JSON.parse(t) };
    } catch (e) {
      throw new Error("Invalid JSON");
    }
  }
});

registerNode({
  type: "net.http",
  title: "HTTP Request",
  inputs: [
    { id: "url", name: "URL", direction: "in", dataType: "string" },
    { id: "method", name: "Method", direction: "in", dataType: "string" },
    { id: "body", name: "Body", direction: "in", dataType: "string" }
  ],
  outputs: [
    { id: "status", name: "Status", direction: "out", dataType: "number" },
    { id: "text", name: "Text", direction: "out", dataType: "string" },
    { id: "json", name: "JSON", direction: "out", dataType: "json" }
  ],
  inspector: [
    { key: "url", label: "URL", type: "text" },
    { key: "method", label: "Method", type: "select", options: ["GET","POST","PUT","PATCH","DELETE"] },
    { key: "body", label: "Body", type: "code" }
  ],
  run: async (ctx) => {
    const url = String(ctx.in.url ?? ctx.state?.url ?? "");
    const method = String(ctx.in.method ?? ctx.state?.method ?? "GET").toUpperCase();
    const body = ctx.in.body ?? ctx.state?.body ?? undefined;

    if (!url) throw new Error("URL required");
    const res = await fetch(url, { method, body: ["GET","HEAD"].includes(method) ? undefined : body, signal: ctx.signal });
    const text = await res.text();
    let json = null; try { json = JSON.parse(text); } catch {}
    return { status: res.status, text, json };
  }
});

/* ------------------------- helpers ------------------------- */
function escapeHtml(s) {
  return String(s)
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}
