/**
 * Add-Node Bridge
 * Makes Nodes slideout pills actually create nodes on the graph.
 *
 * Listens for:  "gf:add-node"  and  "gridflow:add-node"
 * Exposes:      window.addNodeAtCursor(type)
 *
 * Tries, in order:
 *   1) window.store.createNode({ type, x, y })                // app-defined
 *   2) window.store.dispatch({ type: 'ADD_NODE', node })      // Redux-like
 *   3) window.getGraph() + window.transact(fn)                // core/store.js style
 */

const $ = (s, r=document) => r.querySelector(s);

// --- cursor tracking on the stage ------------------------------------------------
let lastClient = { x: window.innerWidth/2, y: window.innerHeight/2 };
const stage = document.getElementById("stageWrap") || document.querySelector(".canvas-wrap");

if (stage) {
  stage.addEventListener("pointermove", (e) => { lastClient = { x: e.clientX, y: e.clientY }; }, { passive: true });
  stage.addEventListener("pointerdown", (e) => { lastClient = { x: e.clientX, y: e.clientY }; }, { passive: true });
}

// Try to read viewport (x,y,zoom) from your store
function getViewport() {
  try {
    if (window.getGraph) {
      const g = window.getGraph();
      if (g?.viewport) return g.viewport;
    }
    if (window.store?.getState) {
      const st = window.store.getState();
      if (st?.graph?.viewport) return st.graph.viewport;
    }
  } catch {}
  return { x: 0, y: 0, zoom: 1 };
}

function clientToWorld(cx, cy) {
  // stage offset
  const rect = stage?.getBoundingClientRect();
  const { x: vx, y: vy, zoom = 1 } = getViewport();
  const sx = rect ? cx - rect.left : cx;
  const sy = rect ? cy - rect.top  : cy;
  // world = (screen - viewportOffset) / zoom
  return { x: (sx - (rect?.width || 0)/2) / (zoom || 1) - vx, y: (sy - (rect?.height || 0)/2) / (zoom || 1) - vy };
}

// --- utilities -------------------------------------------------------------------
function uid(prefix="n") {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}

function getNodeDef(type) {
  // Try common registries
  if (window.GF_NODE_REGISTRY?.get) return window.GF_NODE_REGISTRY.get(type);
  if (Array.isArray(window.GF_NODES)) return window.GF_NODES.find(n => n.type === type);
  if (window.listNodes) {
    try { return (window.listNodes() || []).find(n => n.type === type); } catch {}
  }
  return null;
}

function selectNode(nodeId) {
  // Best-effort select
  if (typeof window.store?.selectOnly === "function") {
    window.store.selectOnly([nodeId]); return;
  }
  if (typeof window.store?.dispatch === "function") {
    window.store.dispatch({ type: "SELECT_ONLY", ids: [nodeId] }); return;
  }
  // transact fallback: store a selectedIds array on graph
  if (typeof window.transact === "function" && typeof window.getGraph === "function") {
    window.transact((g) => { g.selectedIds = [nodeId]; }, "Select node");
  }
}

function requestRender() {
  // Call your renderer invalidation if exposed
  if (typeof window.renderer?.invalidate === "function") window.renderer.invalidate();
  if (typeof window.requestRender === "function") window.requestRender();
}

// --- core creation ----------------------------------------------------------------
function createViaStoreAPI(type, x, y) {
  // 1) store.createNode API
  if (typeof window.store?.createNode === "function") {
    const node = window.store.createNode({ type, x, y });
    return node?.id;
  }
  // 2) Redux-like dispatch
  if (typeof window.store?.dispatch === "function") {
    const id = uid();
    const def = getNodeDef(type) || {};
    const node = {
      id, type, title: def.title || type,
      x, y, width: def.width || 300, height: def.height || 140,
      inputs: def.inputs || [], outputs: def.outputs || [],
      state: {}
    };
    window.store.dispatch({ type: "ADD_NODE", node });
    return id;
  }
  return null;
}

function createViaTransact(type, x, y) {
  if (typeof window.transact !== "function" || typeof window.getGraph !== "function") return null;
  const def = getNodeDef(type) || {};
  const id = uid();
  const node = {
    id, type, title: def.title || type,
    x, y, width: def.width || 300, height: def.height || 140,
    inputs: def.inputs || [], outputs: def.outputs || [],
    state: {}
  };
  window.transact((g) => {
    g.nodes = g.nodes || [];
    g.nodes.push(node);
  }, `Add node ${type}`);
  return id;
}

/**
 * Public: drop a node near the current cursor (or center).
 */
export function addNodeAtCursor(type) {
  const { x, y } = clientToWorld(lastClient.x, lastClient.y);
  const id = createViaStoreAPI(type, x, y) ?? createViaTransact(type, x, y);
  if (!id) {
    console.warn("[add-node-bridge] No known way to create nodes. Expose store.createNode(..), store.dispatch(ADD_NODE), or transact().");
    return;
  }
  selectNode(id);
  requestRender();
}

// Expose globally so other scripts (e.g., custom-nodes.js) can call it
window.addNodeAtCursor = addNodeAtCursor;

// --- event wiring -----------------------------------------------------------------
// Accept both events that our Nodes panel or other code might emit.
function onAddEvent(e) {
  const type = e?.detail?.type;
  if (!type) return;
  addNodeAtCursor(type);
}

document.addEventListener("gf:add-node", onAddEvent);
document.addEventListener("gridflow:add-node", onAddEvent);
