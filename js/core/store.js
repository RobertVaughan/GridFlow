// GridFlow Store: normalized state, undo/redo, selectors. No external deps.
export const VERSION = "1.2.2";

/**
 * @typedef {Object} Graph
 * @property {string} id
 * @property {string} name
 * @property {string} version
 * @property {string} createdAt
 * @property {string} updatedAt
 * @property {{gridSize:number, snapToGrid:boolean, theme:string}} settings
 * @property {{x:number,y:number,zoom:number}} viewport
 * @property {Node[]} nodes
 * @property {Wire[]} wires
 * @property {Group[]} groups
 * @property {Record<string, any>=} metadata
 */
/** @typedef {{id:string,type:string,title:string,x:number,y:number,width?:number,height?:number,inputs:Port[],outputs:Port[],state?:Object,ui?:NodeUI}} Node */
/** @typedef {{id:string,name:string,direction:"in"|"out",dataType:string,multi?:boolean,default?:any}} Port */
/** @typedef {{id:string,kind:"data"|"exec",from:{nodeId:string,portId:string},to:{nodeId:string,portId:string}}} Wire */
/** @typedef {{id:string,title:string,nodeIds:string[],color?:string}} Group */
/** @typedef {{inspector?:InspectorField[]}} NodeUI */
/** @typedef {{key:string,label:string,type:"text"|"number"|"select"|"toggle"|"code"|"json",options?:any[]}} InspectorField */

const listeners = new Set();
const history = { past: [], future: [], limit: 1000 };
/** @type {Graph} */
let graph = createEmptyGraph();

// --- UI-only selection + clipboard (not persisted) ---
const selection = new Set(); // nodeIds
let clipboard = null;        // {nodes, wires}

function emit(){ for (const fn of listeners) fn(graph); }
function emitSelection(){
  window.dispatchEvent(new CustomEvent("gridflow:selection-changed", { detail: [...selection] }));
}

// -----------------------------------------------------------------------------
// Public store API
// -----------------------------------------------------------------------------
export function getGraph(){ return graph; }
export function subscribe(fn){ listeners.add(fn); return () => listeners.delete(fn); }

export function transact(mutator, label = "change"){
  const before = structuredClone(graph);
  mutator(graph);
  graph.updatedAt = new Date().toISOString();
  history.past.push(before);
  if (history.past.length > history.limit) history.past.shift();
  history.future.length = 0;
  emit(); status(`✅ ${label}`);
}

export function undo(){
  if (!history.past.length) return;
  history.future.push(structuredClone(graph));
  graph = history.past.pop();
  emit(); status("↩️ Undo");
}

export function redo(){
  if (!history.future.length) return;
  history.past.push(structuredClone(graph));
  graph = history.future.pop();
  emit(); status("↪️ Redo");
}

// -----------------------------------------------------------------------------
// Graph lifecycle
// -----------------------------------------------------------------------------
export function createEmptyGraph(){
  const t = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    name: "Untitled",
    version: VERSION,
    createdAt: t,
    updatedAt: t,
    settings: { gridSize: 20, snapToGrid: true, theme: "dark" },
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes: [],
    wires: [],
    groups: [],
    metadata: {}
  };
}

export function setGraph(g){
  graph = g;
  // back-compat: ensure defaults
  graph.wires = (graph.wires || []).map(w => ({ kind: "data", ...w, kind: w.kind || "data" }));
  graph.version  ||= VERSION;
  graph.settings ||= { gridSize: 20, snapToGrid: true, theme: "dark" };
  graph.viewport ||= { x: 0, y: 0, zoom: 1 };
  emit();
}

// -----------------------------------------------------------------------------
// Viewport helpers (no renderer import)
// -----------------------------------------------------------------------------
/** Returns the world-space center (cx, cy) of the current viewport */
export function getWorldCenter(){
  const vp = graph.viewport || { x:0, y:0, zoom:1 };
  const z  = vp.zoom || 1;
  const stage = document.getElementById("stageWrap");
  const screenW = stage ? stage.clientWidth  : window.innerWidth;
  const screenH = stage ? stage.clientHeight : window.innerHeight;
  const cx = (-(vp.x || 0) + screenW * 0.5) / z;
  const cy = (-(vp.y || 0) + screenH * 0.5) / z;
  return { cx, cy };
}

// -----------------------------------------------------------------------------
// Node operations
// -----------------------------------------------------------------------------
export function addNode(n){ transact(g => { g.nodes.push(n); }, "Add node"); }

export function removeNode(nodeId){ removeNodes([nodeId]); }

export function removeNodes(nodeIds){
  transact(g => {
    const idset = new Set(nodeIds);
    g.nodes = g.nodes.filter(n => !idset.has(n.id));
    g.wires = g.wires.filter(w => !idset.has(w.from.nodeId) && !idset.has(w.to.nodeId));
    g.groups.forEach(gr => gr.nodeIds = gr.nodeIds.filter(id => !idset.has(id)));
  }, nodeIds.length > 1 ? `Remove ${nodeIds.length} nodes` : "Remove node");
  nodeIds.forEach(id => selection.delete(id));
  emitSelection();
}

export function moveNode(nodeId, x, y){
  transact(g => {
    const n = g.nodes.find(n => n.id === nodeId);
    if (n){ n.x = x; n.y = y; }
  }, "Move node");
}

/** @param {{nodeId:string,portId:string}} from @param {{nodeId:string,portId:string}} to @param {"data"|"exec"} kind */
export function connectWire(from, to, kind = "data"){
  const wire = { id: crypto.randomUUID(), kind, from, to };
  transact(g => g.wires.push(wire), "Connect");
}

export function removeWire(wireId){
  transact(g => g.wires = g.wires.filter(w => w.id !== wireId), "Remove wire");
}

// -----------------------------------------------------------------------------
// Selection
// -----------------------------------------------------------------------------
export function getSelection(){ return new Set(selection); }
export function setSelection(ids){
  selection.clear(); ids.forEach(id => selection.add(id)); emitSelection();
}
export function toggleSelection(id){
  if (selection.has(id)) selection.delete(id); else selection.add(id);
  emitSelection();
}
export function clearSelection(){ selection.clear(); emitSelection(); }

// -----------------------------------------------------------------------------
// Clipboard
// -----------------------------------------------------------------------------
export function copySelection(){
  const ids = [...selection];
  if (!ids.length) return false;
  const idset = new Set(ids);
  const nodes = graph.nodes.filter(n => idset.has(n.id)).map(n => structuredClone(n));
  const wires = graph.wires
    .filter(w => idset.has(w.from.nodeId) && idset.has(w.to.nodeId))
    .map(w => structuredClone(w));
  clipboard = { nodes, wires };
  status(`📋 Copied ${nodes.length} node(s)`);
  return true;
}

/** Paste clipboard centered in the current viewport; keeps relative layout. */
export function pasteClipboard(){
  if (!clipboard?.nodes?.length) return;

  const { cx, cy } = getWorldCenter();
  const grid  = graph.settings.gridSize || 20;
  const snapOn = !!graph.settings.snapToGrid;

  const nodesCopy = JSON.parse(JSON.stringify(clipboard.nodes));
  const wiresCopy = JSON.parse(JSON.stringify(clipboard.wires));

  // centroid of source
  let avgX = 0, avgY = 0;
  nodesCopy.forEach(n => { avgX += n.x; avgY += n.y; });
  avgX /= nodesCopy.length; avgY /= nodesCopy.length;

  // offset so centroid → view center
  let dx = cx - avgX, dy = cy - avgY;
  if (snapOn){ dx = snap(dx, grid); dy = snap(dy, grid); }

  const idMap = new Map();

  transact(g => {
    for (const n of nodesCopy){
      const newId = crypto.randomUUID();
      idMap.set(n.id, newId);
      g.nodes.push({ ...n, id: newId, x: n.x + dx, y: n.y + dy });
    }
    for (const w of wiresCopy){
      const fromId = idMap.get(w.from.nodeId), toId = idMap.get(w.to.nodeId);
      if (fromId && toId){
        g.wires.push({
          ...w,
          id: crypto.randomUUID(),
          from: { nodeId: fromId, portId: w.from.portId },
          to:   { nodeId: toId,   portId: w.to.portId }
        });
      }
    }
  }, `Paste ${nodesCopy.length} node(s)`);

  setSelection([...idMap.values()]);
}

export function deleteSelection(){
  const ids = [...selection];
  if (!ids.length) return;
  removeNodes(ids);
}

// -----------------------------------------------------------------------------
// Utils
// -----------------------------------------------------------------------------
export function snap(val, grid){ return Math.round(val / grid) * grid; }

export function status(msg){
  const el = document.getElementById("status");
  if (el) el.textContent = msg;
}
