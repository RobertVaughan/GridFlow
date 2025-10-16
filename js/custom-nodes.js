/**
 * Custom Nodes Loader
 * - Fetch /custom-nodes/registry.php → packs + nodes
 * - Optional install via /custom-nodes/install.php per pack (requirements.txt)
 * - Register nodes with your plugin API
 * - Ensure clicking a custom node pill adds it to the graph
 */

import { registerNode } from "./core/plugins.js";

// ---- endpoints ----
const REGISTRY_URL = "/custom-nodes/registry.php";
const INSTALL_URL  = "/custom-nodes/install.php";
const RUNNER_URL   = "/custom-nodes/runner.php";

// ---- tiny helpers ----
const $  = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));

async function getRegistry() {
  const res = await fetch(REGISTRY_URL, { cache: "no-store" });
  if (!res.ok) throw new Error(`registry ${res.status}`);
  const data = await res.json();
  return Array.isArray(data?.packs) ? data.packs : [];
}

async function ensureRequirements(pack) {
  if (!pack?.has_requirements) return { ok: true, skipped: true };
  // naive client-side cache to avoid reinstalling repeatedly
  const key = `cn_require_${pack.slug}_${pack.requirements_hash}`;
  if (localStorage.getItem(key)) return { ok: true, cached: true };
  const res = await fetch(INSTALL_URL, {
    method: "POST",
    headers: { "Content-Type":"application/json" },
    body: JSON.stringify({ slug: pack.slug })
  });
  const data = await res.json().catch(()=>null);
  if (!res.ok || !data?.ok) {
    throw new Error(`Install failed for ${pack.slug}: ${data?.error || res.statusText}`);
  }
  localStorage.setItem(key, "1");
  return { ok: true };
}

async function callRunner(slug, payload, signal) {
  const res = await fetch(RUNNER_URL, {
    method: "POST",
    headers: { "Content-Type":"application/json" },
    body: JSON.stringify({ slug, payload }),
    signal
  });
  if (!res.ok) {
    const t = await res.text().catch(()=> "");
    throw new Error(`Runner ${res.status}: ${t || res.statusText}`);
  }
  const data = await res.json().catch(()=> ({}));
  if (data && data.error) throw new Error(data.error);
  return data;
}

// ---- node registration from manifest ----
function registerPackNodes(pack) {
  for (const def of pack.nodes) {
    const type  = def.type;
    const title = def.title || type;
    const inputs = def.inputs || [];
    const outputs = def.outputs || [];
    const inspector = def.inspector || [];

    registerNode({
      type,
      title,
      inputs,
      outputs,
      inspector,
      // Mark pack for grouping in the Nodes panel
      pack: pack.name,
      run: async (ctx) => {
        // Push values/state to the runner; let Python implement behavior
        const payload = {
          nodeType: type,
          inputs: ctx.in || {},
          state: ctx.state || {},
          metadata: { pack: pack.slug, version: pack.version }
        };
        const res = await callRunner(pack.slug, payload, ctx.signal);

        // Optional UI events
        if (res.render?.html) ctx.emit?.("render", { html: String(res.render.html) });
        if (res.logs && Array.isArray(res.logs)) {
          for (const log of res.logs) ctx.emit?.("log", log);
        }

        // Return outputs back into the graph
        return res.outputs || {};
      }
    });
  }
}

// ---- hook Nodes slideout clicks to actually add nodes ----
function bindNodeCreation() {
  // Our Nodes panel already dispatches "gf:add-node" from node pills.
  // We provide a default handler that calls window.addNodeAtCursor(type)
  // or falls back to a custom event your app.js can handle.
  if (document.documentElement.dataset.cnAddBound === "1") return;
  document.documentElement.dataset.cnAddBound = "1";

  document.addEventListener("gf:add-node", (e) => {
    const type = e?.detail?.type;
    if (!type) return;
    if (typeof window.addNodeAtCursor === "function") {
      window.addNodeAtCursor(type);
      return;
    }
    // generic fallback: emit an app-level event
    const fallback = new CustomEvent("gridflow:add-node", { detail: { type } });
    document.dispatchEvent(fallback);
  });
}

// ---- main init ----
async function initCustomNodes() {
  try {
    const packs = await getRegistry();

    // Install requirements for each pack (best-effort)
    for (const pack of packs) {
      try {
        await ensureRequirements(pack);
      } catch (e) {
        console.warn("[custom-nodes] requirements", pack.slug, e?.message || e);
        // Don’t block registration; Python nodes might still work without deps
      }
    }
    // Register node types
    for (const pack of packs) {
      registerPackNodes(pack);
    }

    // Ensure clicking a custom node pill creates a node
    bindNodeCreation();

    console.info(`[custom-nodes] loaded ${packs.length} pack(s)`);
  } catch (e) {
    console.error("[custom-nodes] init failed:", e);
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initCustomNodes, { once: true });
} else {
  initCustomNodes();
}
