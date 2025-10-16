/**
 * GridFlow Ollama Nodes (front-end) — wired to Python runner
 * Matches nodeType handling in custom-nodes/gridflow-ollama/runner.py
 *
 * Node types:
 *   - ollama.model        → outputs selected model
 *   - ollama.chat_input   → outputs user message
 *   - ollama.dialog       → renders HTML transcript
 *   - ollama.interpreter  → calls Ollama via runner, returns assistant + html
 *
 * Framework assumptions:
 *   registerNode({ type, title, inputs, outputs, inspector, run })
 *   ctx = { in, state, emit(type,payload), signal, cache }
 *
 * Backend:
 *   PHP bridge at RUNNER_URL posts JSON to runner.py (stdin) and returns JSON
 */

import { registerNode } from "../core/plugins.js";

/* ---------------------------------------------------
 * Config (adjust the path if you relocate the bridge)
 * --------------------------------------------------- */
const RUNNER_URL = "/custom-nodes/gridflow-ollama/runner.php";

/* ---------------------------------------------------
 * Helpers
 * --------------------------------------------------- */
async function callRunner(payload, signal) {
  const res = await fetch(RUNNER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal
  });
  if (!res.ok) {
    const t = await res.text().catch(()=> "");
    throw new Error(`Runner HTTP ${res.status}: ${t || res.statusText}`);
  }
  const data = await res.json().catch(() => ({}));
  if (data && data.error) {
    throw new Error(data.error);
  }
  return data || {};
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

/* ---------------------------------------------------
 * Node: ollama.model
 *   - Uses inspector to choose a model; runner just echoes it
 * --------------------------------------------------- */
registerNode({
  type: "ollama.model",
  title: "Ollama Model",
  inputs: [],
  outputs: [{ id: "model", name: "Model", direction: "out", dataType: "string" }],
  inspector: [
    { key: "model",   label: "Model",   type: "text" },
    { key: "note",    label: "Notes",   type: "text" }
  ],
  run: async (ctx) => {
    // We defer to the runner so your server-side can normalize defaults
    const resp = await callRunner({
      nodeType: "ollama.model",
      inputs: {},
      state: ctx.state || {},
      metadata: {}
    }, ctx.signal);

    const model = (resp.outputs && resp.outputs.model) || ctx.state?.model || "";
    // lightweight UI render hint
    ctx.emit?.("render", {
      html: `<div class="inline-field">
               <label>Model</label>
               <input data-node-input="model" value="${escapeHtml(model)}" placeholder="llama3"/>
             </div>`
    });

    return { model };
  }
});

/* ---------------------------------------------------
 * Node: ollama.chat_input
 *   - Big textarea inside the node; also goes through runner for parity
 * --------------------------------------------------- */
registerNode({
  type: "ollama.chat_input",
  title: "Ollama Chat",
  inputs: [],
  outputs: [{ id: "message", name: "Message", direction: "out", dataType: "string" }],
  inspector: [{ key: "text", label: "Text", type: "json" }],
  run: async (ctx) => {
    // Render an editable textarea directly in the node
    const text = String(ctx.state?.text ?? "");

    ctx.emit?.("render", {
      html: `<div class="inline-field fill">
               <label>Chat Input</label>
               <textarea data-node-input="text" placeholder="Say something…">${escapeHtml(text)}</textarea>
             </div>`
    });

    // Round-trip through the runner to keep both sides in sync
    const resp = await callRunner({
      nodeType: "ollama.chat_input",
      inputs: {},
      state: ctx.state || {},
      metadata: {}
    }, ctx.signal);

    const message = (resp.outputs && resp.outputs.message) ?? text;
    return { message };
  }
});

/* ---------------------------------------------------
 * Node: ollama.dialog
 *   - Sink: receives messages and renders transcript HTML from runner
 * --------------------------------------------------- */
registerNode({
  type: "ollama.dialog",
  title: "Ollama Dialog",
  inputs: [
    { id: "user",      name: "User",      direction: "in", dataType: "string" },
    { id: "assistant", name: "Assistant", direction: "in", dataType: "string" }
  ],
  outputs: [{ id: "html", name: "HTML", direction: "out", dataType: "string" }],
  inspector: [],
  run: async (ctx) => {
    const resp = await callRunner({
      nodeType: "ollama.dialog",
      inputs: { user: ctx.in.user ?? "", assistant: ctx.in.assistant ?? "" },
      state: ctx.state || {},
      metadata: {}
    }, ctx.signal);

    const html = (resp.outputs && resp.outputs.html) || "<em>No messages</em>";
    ctx.emit?.("render", { html });
    return { html };
  }
});

/* ---------------------------------------------------
 * Node: ollama.interpreter
 *   - Wires (model, system, message) → Ollama → (assistant, html)
 *   - Python runner calls /api/generate and formats basic transcript
 * --------------------------------------------------- */
registerNode({
  type: "ollama.interpreter",
  title: "Ollama Interpreter",
  inputs: [
    { id: "model",   name: "Model",         direction: "in", dataType: "string" },
    { id: "system",  name: "Instructions",  direction: "in", dataType: "string" },
    { id: "message", name: "User Message",  direction: "in", dataType: "string" }
  ],
  outputs: [
    { id: "assistant", name: "Assistant", direction: "out", dataType: "string" },
    { id: "html",      name: "HTML",      direction: "out", dataType: "string" }
  ],
  inspector: [
    { key: "model",   label: "Default Model",  type: "text" },
    { key: "system",  label: "Default System", type: "code" }
  ],
  run: async (ctx) => {
    // Prefer inputs; fall back to state defaults
    const inputs = {
      model:   ctx.in.model   ?? ctx.state?.model   ?? "",
      system:  ctx.in.system  ?? ctx.state?.system  ?? "",
      message: ctx.in.message ?? ""
    };

    const resp = await callRunner({
      nodeType: "ollama.interpreter",
      inputs,
      state: ctx.state || {},
      metadata: {}
    }, ctx.signal);

    const assistant = resp.outputs?.assistant ?? "";
    const html      = resp.outputs?.html ?? "";

    // Let the node show its own transcript (also wire to a dialog node if connected)
    if (html) ctx.emit?.("render", { html });

    return { assistant, html };
  }
});
