// GridFlow Renderer: infinite grid, pan/zoom world, nodes/edges rendering,
// wiring, marquee, middle-mouse pan, scroll-zoom at cursor, minimap.
// Ellipses menu removed. Pin indicator added; pinned nodes cannot be dragged.
// Colors and shapes applied on the .node container using CSS variables + border-radius.

import {
  getGraph, subscribe, snap, removeWire, transact, removeNode,
  getSelection, setSelection, toggleSelection, clearSelection
} from "./store.js";
import { isPortCompatible } from "./plugins.js";

// DOM references
const stageWrap  = document.getElementById("stageWrap");
const stageInner = document.getElementById("stageInner");
const gridCanvas = document.getElementById("gridCanvas");
const edgeCanvas = document.getElementById("edgeCanvas");
const nodeLayer  = document.getElementById("nodeLayer");
const marquee    = document.getElementById("marquee");

// Minimap
const miniHost   = document.getElementById("minimap");
const miniCanvas = document.getElementById("minimapCanvas");
const miniCtx    = miniCanvas?.getContext("2d");

// Delete modal (used when other UI asks to confirm removal)
const modal     = document.getElementById("confirmModal");
const btnDel    = document.getElementById("confirmDelete");
const btnCancel = document.getElementById("confirmCancel");
let pendingDeleteNodeId = null;

// Interaction state
let dragging  = null;      // {id, el, offsetXw, offsetYw}
let pendingCommit = null;  // {id, x, y}
let wiring    = null;      // {from:{nodeId,portId}, kind:"data"|"exec", mouse:{x,y}}
let selecting = null;      // marquee
let isPanning = null;      // middle-mouse pan
let miniDrag  = null;      // minimap drag
let resizing  = null;      // {id, el, startW, startH, startX, startY}
let pendingSize = null;    // {id, width, height}

// Canvases
const ctxGrid = gridCanvas.getContext("2d");
const ctxEdge = edgeCanvas.getContext("2d");

// Shapes map (order: Soft, Rounded, Square)
const NODE_SHAPE_RADIUS = {
  soft: 12,
  rounded: 6,
  square: 0
};

// ==========================================================================
// Inline editor helpers for generator nodes (util.integer, util.string)
// ==========================================================================
// (unchanged; still used)
const _editDebounce = new Map(); // key: `${nodeId}:${stateKey}`

function setNodeStateDebounced(nodeId, stateKey, nextValue, label = "Edit value", delay = 180){
  const k = `${nodeId}:${stateKey}`;
  const t = _editDebounce.get(k);
  if (t) clearTimeout(t);
  _editDebounce.set(k, setTimeout(()=>{
    transact(g=>{
      const n = g.nodes.find(nn=>nn.id===nodeId);
      if(!n) return;
      n.state ||= {};
      n.state[stateKey] = nextValue;
    }, label);
  }, delay));
}

// ----------------------------------------------------------------------------
// Public controls (used by app.js)
// ----------------------------------------------------------------------------
let SHOW_EDGES = true;
export function setShowEdges(v){ SHOW_EDGES = !!v; drawEdges(); drawMinimap(); }

export function setZoom(z){
  const vp = getGraph().viewport;
  vp.zoom = Math.max(0.25, Math.min(3, z));
  applyView();
  window.dispatchEvent(new CustomEvent("gridflow:zoom-changed", { detail: { zoom: vp.zoom } }));
}

export function getZoom(){ return getGraph().viewport.zoom || 1; }

export function setMinimapVisible(v){
  if(miniHost) miniHost.style.display = v ? "" : "none";
  drawMinimap();
}

// Match snap-to-grid to the actually drawn grid spacing.
// We draw lines at `gridSize * zoom * skip` where skip>=1 when too dense.
function getEffectiveSnapStep() {
  const grid = getGraph().settings.gridSize || 20;
  const z = getZoom() || 1;
  const minPx = 6;                    // same density guard as drawGrid()
  const cellPx = grid * z;
  const skip = cellPx < minPx ? Math.ceil(minPx / cellPx) : 1;
  return grid * skip;                 // world units
}


// Apply world transform to inner stage
function applyView(){
  const vp = getGraph().viewport;
  const tx = vp.x || 0, ty = vp.y || 0, z = vp.zoom || 1;
  stageInner.style.transform = `translate(${tx}px, ${ty}px) scale(${z})`;
  drawGrid();
  drawEdges();
  drawMinimap();
}

// ----------------------------------------------------------------------------
// Utilities
// ----------------------------------------------------------------------------
function clamp(v, a, b){ return Math.max(a, Math.min(b, v)); }

function screenToWorld(sx, sy){
  const vp = getGraph().viewport;
  const rect = stageWrap.getBoundingClientRect();
  const z = vp.zoom || 1;
  return {
    x: (sx - rect.left - (vp.x||0)) / z,
    y: (sy - rect.top  - (vp.y||0)) / z
  };
}

function worldToScreen(wx, wy){
  const vp = getGraph().viewport;
  const rect = stageWrap.getBoundingClientRect();
  const z = vp.zoom || 1;
  return {
    x: rect.left + (vp.x||0) + wx * z,
    y: rect.top  + (vp.y||0) + wy * z
  };
}

// ----------------------------------------------------------------------------
// Resize canvases
// ----------------------------------------------------------------------------
function resizeCanvas(){
  const rect = stageWrap.getBoundingClientRect();
  for(const c of [gridCanvas, edgeCanvas]){
    c.width  = Math.max(1, Math.floor(rect.width  * devicePixelRatio));
    c.height = Math.max(1, Math.floor(rect.height * devicePixelRatio));
    c.style.width  = rect.width + "px";
    c.style.height = rect.height + "px";
  }
  if(miniCanvas){
    const mw = miniHost.clientWidth, mh = miniHost.clientHeight;
    miniCanvas.width  = Math.max(1, Math.floor(mw * devicePixelRatio));
    miniCanvas.height = Math.max(1, Math.floor(mh * devicePixelRatio));
    miniCanvas.style.width = mw + "px";
    miniCanvas.style.height = mh + "px";
  }
  drawAll();
}
window.addEventListener("resize", resizeCanvas);

// ----------------------------------------------------------------------------
// Grid (world-scaled & perfectly aligned to snap; no half-pixel shift)
// ----------------------------------------------------------------------------
function drawGrid(){
  const g  = getGraph();
  const vp = g.viewport || { x:0, y:0, zoom:1 };
  const z  = vp.zoom || 1;
  const gridSize = g.settings.gridSize || 20;

  // On-screen spacing of one world cell
  let cell = gridSize * z;

  // Density guard when zoomed far out (draw every Nth line)
  let skip = 1;
  const minPx = 6;
  if (cell < minPx) {
    skip = Math.ceil(minPx / cell);
    cell = cell * skip;
  }

  const ctx  = ctxGrid;
  const css  = getComputedStyle(document.body);
  const wCSS = gridCanvas.clientWidth;
  const hCSS = gridCanvas.clientHeight;

  // Phase so lines are exactly at vp.x + k*cell (screen space)
  const phaseX = ((vp.x % cell) + cell) % cell;
  const phaseY = ((vp.y % cell) + cell) % cell;

  // Clear & HiDPI scale
  ctx.clearRect(0, 0, gridCanvas.width, gridCanvas.height);
  ctx.save();
  ctx.scale(devicePixelRatio, devicePixelRatio);

  // Minor grid
  ctx.strokeStyle = (css.getPropertyValue("--grid").trim() || "#1b1f2a");
  ctx.lineWidth = 1;

  // Vertical lines
  ctx.beginPath();
  for (let x = phaseX; x < wCSS; x += cell) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, hCSS);
  }
  // Horizontal lines
  for (let y = phaseY; y < hCSS; y += cell) {
    ctx.moveTo(0, y);
    ctx.lineTo(wCSS, y);
  }
  ctx.stroke();

  // Major grid every 5 cells when spacing is comfortable
  if (cell >= 12) {
    const majorEvery = 5;
    const majorCell  = cell * majorEvery;
    const mPhaseX = ((vp.x % majorCell) + majorCell) % majorCell;
    const mPhaseY = ((vp.y % majorCell) + majorCell) % majorCell;

    ctx.strokeStyle = ctx.strokeStyle; // same color, lighter alpha
    ctx.globalAlpha = 0.35;
    ctx.beginPath();
    for (let x = mPhaseX; x < wCSS; x += majorCell) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, hCSS);
    }
    for (let y = mPhaseY; y < hCSS; y += majorCell) {
      ctx.moveTo(0, y);
      ctx.lineTo(wCSS, y);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  ctx.restore();
}


// ----------------------------------------------------------------------------
// Edges (screen-space canvas)
// ----------------------------------------------------------------------------
function cablePath(ax, ay, bx, by){
  const dx = Math.max(40, Math.abs(bx-ax)*0.5);
  return new Path2D(`M ${ax} ${ay} C ${ax+dx} ${ay}, ${bx-dx} ${by}, ${bx} ${by}`);
}

function drawEdges(){
  const rect = edgeCanvas.getBoundingClientRect();
  const ctx = ctxEdge;
  ctx.clearRect(0,0,edgeCanvas.width, edgeCanvas.height);
  if(!SHOW_EDGES) return;

  ctx.save();
  ctx.scale(devicePixelRatio, devicePixelRatio);

  const g = getGraph();
  for(const w of g.wires){
    const fromNode = g.nodes.find(n=>n.id===w.from.nodeId);
    const toNode   = g.nodes.find(n=>n.id===w.to.nodeId);
    if(!fromNode || !toNode) continue;

    const fromEl = document.querySelector(`[data-node='${fromNode.id}'] .port[data-id='${w.from.portId}'] .dot`);
    const toEl   = document.querySelector(`[data-node='${toNode.id}'] .port[data-id='${w.to.portId}'] .dot`);
    if(!fromEl || !toEl) continue;

    const a = fromEl.getBoundingClientRect(), b = toEl.getBoundingClientRect();
    const ax = a.left - rect.left + a.width/2, ay = a.top - rect.top + a.height/2;
    const bx = b.left - rect.left + b.width/2, by = b.top - rect.top + b.height/2;

    const path = cablePath(ax, ay, bx, by);
    const varName = w.kind==="exec" ? "--wire-exec" : "--wire";
    ctx.strokeStyle = getComputedStyle(document.body).getPropertyValue(varName);
    ctx.lineWidth = (w.kind==="exec") ? 3 : 2;
    ctx.stroke(path);
  }

  if(wiring){
    const aEl = document.querySelector(
      `[data-node='${wiring.from.nodeId}'] .port[data-id='${wiring.from.portId}'] .dot`
    );
    if(aEl){
      const a = aEl.getBoundingClientRect();
      const ax = a.left - rect.left + a.width/2, ay = a.top - rect.top + a.height/2;
      const bx = wiring.mouse.x, by = wiring.mouse.y;
      const path = cablePath(ax, ay, bx, by);
      ctx.setLineDash([6,6]);
      ctx.strokeStyle = getComputedStyle(document.body).getPropertyValue(wiring.kind==="exec" ? "--wire-exec" : "--wire");
      ctx.stroke(path);
      ctx.setLineDash([]);
    }
  }
  ctx.restore();
}

// ----------------------------------------------------------------------------
// Minimap
// ----------------------------------------------------------------------------
function getWorldBounds(){
  const g = getGraph();
  if(!g.nodes.length) return { minX:0, minY:0, maxX:1, maxY:1 };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for(const n of g.nodes){
    const w = n.width || 220, h = n.height || 86;
    minX = Math.min(minX, n.x); minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x + w); maxY = Math.max(maxY, n.y + h);
  }
  const pad = 100;
  return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
}

let minimapMapping = null;

function drawMinimap(){
  if(!miniCanvas || miniHost?.style.display === "none") return;

  const g = getGraph();
  const ctx = miniCtx;
  const css = getComputedStyle(document.body);
  const W = miniHost.clientWidth, H = miniHost.clientHeight;

  ctx.clearRect(0,0,miniCanvas.width,miniCanvas.height);
  ctx.save();
  ctx.scale(devicePixelRatio, devicePixelRatio);

  const cssBg   = css.getPropertyValue("--muted-2") || "#0b0d13";
  const cssNode = css.getPropertyValue("--muted")    || "#171a22";
  const cssBorder = css.getPropertyValue("--accent") || "#7dd3fc";
  const cssVp   = css.getPropertyValue("--accent-2") || "#22d3ee";

  ctx.fillStyle = cssBg.trim(); ctx.fillRect(0,0,W,H);

  const bb = getWorldBounds();
  const worldW = Math.max(1, bb.maxX - bb.minX);
  const worldH = Math.max(1, bb.maxY - bb.minY);
  const pad = 6;
  const baseScale = Math.min((W-2*pad)/worldW, (H-2*pad)/worldH);
  const offX = pad - bb.minX*baseScale;
  const offY = pad - bb.minY*baseScale;

  // Mirror main zoom about current world center so node footprints scale with zoom.
  const vp = g.viewport || {x:0,y:0,zoom:1};
  const z  = vp.zoom || 1;
  const screenW = stageWrap.clientWidth;
  const screenH = stageWrap.clientHeight;
  const viewW   = screenW / z;
  const viewH   = screenH / z;
  const viewX   = -(vp.x || 0) / z;
  const viewY   = -(vp.y || 0) / z;
  const cx = viewX + viewW * 0.5;
  const cy = viewY + viewH * 0.5;

  function wxToMx(x){ return ((cx + (x - cx) * z) * baseScale) + offX; }
  function wyToMy(y){ return ((cy + (y - cy) * z) * baseScale) + offY; }
  const sizeScale = z * baseScale;

  // Nodes
  ctx.fillStyle   = cssNode.trim();
  ctx.strokeStyle = cssBorder.trim();
  ctx.lineWidth   = 1;
  const minW = 3, minH = 2;

  for(const n of g.nodes){
    const nx = wxToMx(n.x), ny = wyToMy(n.y);
    const nw = Math.max(minW, (n.width  || 220) * sizeScale);
    const nh = Math.max(minH, (n.height || 86)  * sizeScale);
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(nx, ny, nw, nh, 2);
    else ctx.rect(nx, ny, nw, nh);
    ctx.fill();
    ctx.globalAlpha = 0.8; ctx.stroke(); ctx.globalAlpha = 1;
  }

  // viewport rectangle
  const mx = viewX * baseScale + offX;
  const my = viewY * baseScale + offY;
  const mw = viewW * baseScale;
  const mh = viewH * baseScale;
  ctx.setLineDash([4,3]); ctx.lineWidth = 2; ctx.strokeStyle = cssVp.trim();
  ctx.strokeRect(mx, my, mw, mh);
  ctx.setLineDash([]);

  ctx.restore();
  minimapMapping = { bb, scale: baseScale, offX, offY, pad };
}

function miniToWorld(mx, my){
  if(!minimapMapping) return { x:0, y:0 };
  const { bb, scale, offX, offY } = minimapMapping;
  const wx = (mx - offX)/scale + bb.minX;
  const wy = (my - offY)/scale + bb.minY;
  return { x: wx, y: wy };
}

function centerViewAtWorld(wx, wy){
  const vp = getGraph().viewport;
  const z  = vp.zoom || 1;
  const screenW = stageWrap.clientWidth;
  const screenH = stageWrap.clientHeight;
  vp.x = (screenW/2) - wx * z;
  vp.y = (screenH/2) - wy * z;
  applyView();
}

if(miniHost && miniCanvas){
  miniCanvas.addEventListener("pointerdown", (e)=>{
    const r = miniCanvas.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    const world = miniToWorld(mx, my);
    centerViewAtWorld(world.x, world.y);
    miniDrag = { startX: mx, startY: my };
    miniCanvas.setPointerCapture?.(e.pointerId);
  });
  miniCanvas.addEventListener("pointermove", (e)=>{
    if(!miniDrag) return;
    const r = miniCanvas.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    const a = miniToWorld(miniDrag.startX, miniDrag.startY);
    const b = miniToWorld(mx, my);
    const vp = getGraph().viewport;
    const z  = vp.zoom || 1;
    const screenW = stageWrap.clientWidth;
    const screenH = stageWrap.clientHeight;
    const cx = (screenW/2 - (vp.x||0)) / z;
    const cy = (screenH/2 - (vp.y||0)) / z;
    const ncx = cx + (a.x - b.x);
    const ncy = cy + (a.y - b.y);
    centerViewAtWorld(ncx, ncy);
    miniDrag.startX = mx; miniDrag.startY = my;
  });
  miniCanvas.addEventListener("pointerup", ()=>{ miniDrag = null; });
  miniCanvas.addEventListener("pointercancel", ()=>{ miniDrag = null; });
}

// ----------------------------------------------------------------------------
// Nodes (render + interactions)
// ----------------------------------------------------------------------------
function computeNodeStyles(n){
  // Determine CSS var reference for color; support "orange" with fallback to theme typo "--node-orage"
  const key = (n.ui?.color || "").toLowerCase().trim();
  let cssVarRef = "";
  if (key) {
    if (key === "orange") {
      cssVarRef = "var(--node-orange, var(--node-orage))";
    } else {
      cssVarRef = `var(--node-${key})`;
    }
  }
  const shapeKey = (n.ui?.shape || "").toLowerCase();
  const radiusPx = (shapeKey in NODE_SHAPE_RADIUS) ? NODE_SHAPE_RADIUS[shapeKey] : NODE_SHAPE_RADIUS.rounded;
  return { cssVarRef, radiusPx };
}

function renderNodes(){
  const g = getGraph();
  const selected = getSelection();
  nodeLayer.innerHTML = "";

  for(const n of g.nodes){
    const pinned = !!n.state?.pinned;
    const el = document.createElement("div");
    el.className = "node";
    if(selected.has(n.id)) el.classList.add("selected");
    if(pinned) el.classList.add("pinned");
    el.dataset.node = n.id;
    el.tabIndex = 0;

    // Geometry
    el.style.left = n.x + "px";
    el.style.top  = n.y + "px";
    el.style.width = (n.width||220) + "px";
    if(n.height) el.style.height = n.height + "px";

    // Visual styling via container styles:
    const styles = computeNodeStyles(n);
    if (styles.cssVarRef) el.style.backgroundColor = styles.cssVarRef;
    el.style.borderRadius = styles.radiusPx + "px";

    // Build content
    const execIn  = n.inputs.filter(p=>p.dataType==="exec");
    const dataIns = n.inputs.filter(p=>p.dataType!=="exec");
    const execOut = n.outputs.filter(p=>p.dataType==="exec");
    let   dataOut = n.outputs.filter(p=>p.dataType!=="exec");

    // Detect generator nodes with inline editor + inline output
    const isInt = n.type === "util.integer";
    const isStr = n.type === "util.string";
    const inlineOutId = (isInt || isStr)
      ? (n.outputs.find(p=>p.id==="value")?.id || n.outputs[0]?.id)
      : null;

    // If we will render an inline output pin, suppress that same port from the right column
    if(inlineOutId){
      dataOut = dataOut.filter(p => p.id !== inlineOutId);
    }

    el.innerHTML = `
      <div class="title" draggable="false" style="cursor:${pinned?"not-allowed":"grab"}; background:#1115;
              border-top-left-radius:${styles.radiusPx}px;
              border-top-right-radius:${styles.radiusPx}px;">
        <span class="title-text">${n.title}</span>
        ${pinned ? `<span class="pin-indicator" title="Pinned" aria-label="Pinned" style="color:#ef4444; font-size:14px; margin-left:auto;">📍</span>` : `<span class="pin-indicator" style="display:none"></span>`}
      </div>
      <div class="body">
        <div class="exec-row">
          ${execIn.length ? `<div class="port exec exec-pin in" data-kind="exec" data-dir="in" data-id="${execIn[0].id}" aria-label="Exec In"><span class="dot"></span><span>&laquo;&laquo;</span></div>` : `<div></div>`}
          ${execOut.length ? `<div class="port exec exec-pin out" data-kind="exec" data-dir="out" data-id="${execOut[0].id}" aria-label="Exec Out"><span>&raquo;&raquo;</span><span class="dot"></span></div>` : `<div></div>`}
        </div>

        <!-- Inline editor row injection point -->

        <div class="io-cols" style="display:flex;justify-content:space-between;gap:10px;">
          <div class="ports in" style="flex:1;">
            ${dataIns.map(p => {
              return `<div class="port" data-kind="data" data-dir="in" data-id="${p.id}">
                        <span class="dot"></span><span>${p.name}</span>
                      </div>`;
            }).join("")}
          </div>
          <div class="ports out" style="flex:1;text-align:right;">
            ${dataOut.map(p => `<div class="port" data-kind="data" data-dir="out" data-id="${p.id}">
                                  <span>${p.name}</span><span class="dot"></span>
                                </div>`).join("")}
          </div>
        </div>
      </div>
      <div class="resize-handle" aria-label="Resize" title="Resize"
           style="
             position:absolute; right:6px; bottom:6px;
             width:14px; height:14px; border:1px solid #0006; border-radius:3px;
             background:linear-gradient(135deg, #3b3f4a 0%, #2a2f3a 100%);
             box-shadow: inset 0 1px 0 #ffffff11, 0 1px 2px #0008;
             cursor:nwse-resize; z-index:5;">
         <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg" style="display:block">
           <path d="M4 10h6M6 8h4M8 6h2" stroke="#9aa4b2" stroke-width="1.3" stroke-linecap="round"/>
         </svg>
      </div>
    `;

    // Inline editor [util.integer | util.string] with inline output pin
    (function attachInlineEditor(){
      if(!(isInt || isStr)) return;
      const bodyEl = el.querySelector(".body");
      if(!bodyEl) return;

      const execRow = bodyEl.querySelector(".exec-row");
      const row = document.createElement("div");
      row.className = "inline-editor-row";
      row.style.cssText = "display:flex;align-items:center;gap:8px;margin:6px 0 8px;";

      const currVal = isInt
        ? (Number.isFinite(Number(n.state?.value)) ? (Number(n.state.value)|0) : 0)
        : String(n.state?.text ?? "");

      row.innerHTML = `
        <input
          class="inline-editor"
          type="${isInt ? "number" : "text"}"
          ${isInt ? 'step="1"' : ""}
          value="${String(currVal).replace(/"/g, '&quot;')}"
          style="flex:1;background:#111a;border:1px solid #333;color:var(--fg);
                 border-radius:6px;padding:4px 6px;min-height:26px;"
          aria-label="${isInt ? "Value" : "Text"}"
        />
        <div class="port" data-kind="data" data-dir="out" data-id="${inlineOutId || 'value'}"
             style="margin-left:6px;display:flex;align-items:center;">
          <span class="dot" aria-hidden="true"></span>
        </div>
      `;

      if(execRow){
        execRow.insertAdjacentElement("afterend", row);
      }else{
        bodyEl.prepend(row);
      }

      const inp = row.querySelector("input.inline-editor");
      const commit = ()=>{
        if(isInt){
          const num = Number(inp.value);
          const parsed = Number.isFinite(num) ? (num|0) : 0;
          setNodeStateDebounced(n.id, "value", parsed, "Edit Integer");
        }else{
          setNodeStateDebounced(n.id, "text", String(inp.value ?? ""), "Edit String");
        }
      };
      inp.addEventListener("input", commit);
      inp.addEventListener("change", commit);
      inp.addEventListener("blur", commit);
    })();

    // Selection click
    el.addEventListener("pointerdown", e => {
      if(e.button !== 0) return;
      if(e.shiftKey) toggleSelection(n.id); else setSelection([n.id]);
    });

    // Dragging (blocked if pinned)
    const title = el.querySelector(".title");
    title.addEventListener("pointerdown", e => {
      if(e.button !== 0) return;
      if(pinned) return;
      e.preventDefault();
      try { title.setPointerCapture(e.pointerId); } catch {}
      const z = getZoom();
      const wrapRect = nodeLayer.getBoundingClientRect();
      const pxw = (e.clientX - wrapRect.left) / z;
      const pyw = (e.clientY - wrapRect.top ) / z;
      const offsetXw = pxw - n.x;
      const offsetYw = pyw - n.y;
      dragging = { id: n.id, el, offsetXw, offsetYw };
      title.style.cursor = "grabbing";
      document.body.style.userSelect = "none";
    });
    title.addEventListener("pointerup", e => {
      try { title.releasePointerCapture?.(e.pointerId); } catch {}
      if(dragging && dragging.id === n.id){
        finalizeDragCommit(); dragging = null;
        title.style.cursor = pinned ? "not-allowed" : "grab";
        document.body.style.userSelect = "";
      }
    });

    // Resize handle (anchored bottom-right)
    const rh = el.querySelector(".resize-handle");
    rh.addEventListener("pointerdown", (e)=>{
      if(e.button !== 0) return;
      e.preventDefault();
      try { rh.setPointerCapture(e.pointerId); } catch {}
      const z = getZoom();
      const rect = nodeLayer.getBoundingClientRect();
      resizing = {
        id: n.id,
        el,
        startW: (n.width || el.offsetWidth),
        startH: (n.height || el.offsetHeight),
        startX: (e.clientX - rect.left) / z,
        startY: (e.clientY - rect.top ) / z
      };
      document.body.style.cursor = "nwse-resize";
      document.body.style.userSelect = "none";
    });

    // Wiring
    el.querySelectorAll(".port").forEach(port => {
      port.addEventListener("pointerdown", e => {
        if(e.button !== 0) return;
        const dir = port.dataset.dir;
        const portId = port.dataset.id;
        const kind = port.dataset.kind || "data";

        // Start wiring from an output: track and highlight compatible inputs
        if(dir === "out"){
          wiring = {
            kind,
            from: { nodeId: n.id, portId },
            mouse: {
              x: e.clientX - edgeCanvas.getBoundingClientRect().left,
              y: e.clientY - edgeCanvas.getBoundingClientRect().top
            }
          };
          highlightCompatibleInputs(n.id, portId, kind); // 🔹 add highlight
        }
      });

      port.addEventListener("pointerup", e => {
        if(!wiring) return;
        const dir = port.dataset.dir;
        const portId = port.dataset.id;
        const kind = port.dataset.kind || "data";
        if(dir === "in"){
          const drop = { nodeId: n.id, portId };
          const ev = new CustomEvent("gridflow:wire-attempt", { detail: { from: wiring.from, to: drop, kind } });
          window.dispatchEvent(ev);
        }
        clearPortHighlights(); // 🔹 remove highlight
        wiring = null; 
        drawEdges();
      });
    });

    nodeLayer.appendChild(el);
  }
}

function finalizeDragCommit(){
  if(!pendingCommit) return;
  const { id, x, y } = pendingCommit;
  pendingCommit = null;
  transact(g=>{
    const node = g.nodes.find(nn=>nn.id===id);
    if(node){ node.x = x; node.y = y; }
  }, "Move node");
  drawEdges();
}

function finalizeResizeCommit(){
  if(!pendingSize) return;
  const { id, width, height } = pendingSize;
  pendingSize = null;
  transact(g=>{
    const node = g.nodes.find(nn=>nn.id===id);
    if(node){
      node.width  = Math.max(140, Math.floor(width));
      node.height = Math.max(72,  Math.floor(height));
    }
  }, "Resize node");
  drawEdges();
  drawMinimap();
}

// ----------------------------------------------------------------------------
// Port compatibility highlighting
// ----------------------------------------------------------------------------
function clearPortHighlights(){
  document.querySelectorAll(".port-compatible").forEach(p => p.classList.remove("port-compatible"));
}

function highlightCompatibleInputs(fromNodeId, fromPortId, kind){
  clearPortHighlights();

  const g = getGraph();
  const fromNode = g.nodes.find(n => n.id === fromNodeId);
  if(!fromNode) return;

  // choose the correct collection to locate the 'from' port (out port)
  const fromPort = (kind === "exec")
    ? fromNode.outputs.find(p => p.id === fromPortId && p.dataType === "exec")
    : fromNode.outputs.find(p => p.id === fromPortId && p.dataType !== "exec");

  if(!fromPort) return;

  // Highlight every input that is compatible by type (and by exec/data kind)
  document.querySelectorAll(`.port[data-dir='in']`).forEach(pEl => {
    const pKind = pEl.dataset.kind || "data";
    if(pKind !== kind) return; // only same kind (exec with exec, data with data)

    const nodeEl = pEl.closest(".node");
    const nodeId = nodeEl?.dataset.node;
    if(!nodeId) return;

    const targetNode = g.nodes.find(n => n.id === nodeId);
    if(!targetNode) return;

    const targetPort = targetNode.inputs.find(pp => pp.id === pEl.dataset.id);
    if(!targetPort) return;

    if (isPortCompatible(fromPort, targetPort)) {
      pEl.classList.add("port-compatible");
    }
  });
}

// ----------------------------------------------------------------------------
// Master draw
// ----------------------------------------------------------------------------
export function drawAll(){ drawGrid(); renderNodes(); drawEdges(); drawMinimap(); }
resizeCanvas();
subscribe(()=>{ drawAll(); applyView(); });
applyView();

// Keep selection highlight in sync
window.addEventListener("gridflow:selection-changed", () => {
  document.querySelectorAll(".node").forEach(el=>{
    const id = el.dataset.node; if(!id) return;
    if(getSelection().has(id)) el.classList.add("selected"); else el.classList.remove("selected");
  });
});

// ----------------------------------------------------------------------------
// Global pointer handling (drag/move/resize/wire/marquee/pan)
// ----------------------------------------------------------------------------
window.addEventListener("pointermove", e => {
  const z = getZoom();

  // Resizing node (anchored bottom-right)
  if(resizing){
    const rect = nodeLayer.getBoundingClientRect();
    const pxw = (e.clientX - rect.left) / z;
    const pyw = (e.clientY - rect.top ) / z;

    let w = resizing.startW + (pxw - resizing.startX);
    let h = resizing.startH + (pyw - resizing.startY);

    const step = getEffectiveSnapStep();
    if (getGraph().settings.snapToGrid) {
      w = Math.round(w / step) * step;
      h = Math.round(h / step) * step;
    }

    w = Math.max(140, w);
    h = Math.max(72,  h);

    resizing.el.style.width  = w + "px";
    resizing.el.style.height = h + "px";
    pendingSize = { id: resizing.id, width: w, height: h };

    // Edges should follow while resizing
    drawEdges();
    return;
  }

  // Dragging node
  if(dragging){
    const wrapRect = nodeLayer.getBoundingClientRect();
    let nx = (e.clientX - wrapRect.left)/z - dragging.offsetXw;
    let ny = (e.clientY - wrapRect.top )/z - dragging.offsetYw;

    // Snap aligned with drawn grid
    if (getGraph().settings.snapToGrid) {
      const step = getEffectiveSnapStep();
      nx = Math.round(nx / step) * step;
      ny = Math.round(ny / step) * step;
    }

    dragging.el.style.left = nx + "px";
    dragging.el.style.top  = ny + "px";
    pendingCommit = { id: dragging.id, x: nx, y: ny };
    drawEdges();
    return;
  }

  // Wiring ghost
  if(wiring){
    wiring.mouse.x = e.clientX - edgeCanvas.getBoundingClientRect().left;
    wiring.mouse.y = e.clientY - edgeCanvas.getBoundingClientRect().top;
    drawEdges();
    return;
  }

  // Marquee
  if(selecting){
    const x = Math.min(selecting.startX, e.clientX);
    const y = Math.min(selecting.startY, e.clientY);
    const w = Math.abs(e.clientX - selecting.startX);
    const h = Math.abs(e.clientY - selecting.startY);
    Object.assign(marquee.style, { left:x+"px", top:y+"px", width:w+"px", height:h+"px", display:"block" });
    return;
  }

  // Mid-mouse pan
  if(isPanning){
    const dx = e.clientX - isPanning.startX;
    const dy = e.clientY - isPanning.startY;
    const vp = getGraph().viewport;
    vp.x = isPanning.vx + dx;
    vp.y = isPanning.vy + dy;
    applyView();
    return;
  }
});

window.addEventListener("pointerup", (e) => {
  if(resizing){
    try { /* release pointer if captured by handle */ } catch {}
    finalizeResizeCommit();
    resizing = null;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  }
  if(dragging){ finalizeDragCommit(); dragging = null; document.body.style.userSelect = ""; }
  if(selecting){
    const r = marquee.getBoundingClientRect();
    const ids = [];
    document.querySelectorAll(".node").forEach(el=>{
      const b = el.getBoundingClientRect();
      const hit = !(b.right < r.left || b.left > r.right || b.bottom < r.top || b.top > r.bottom);
      if(hit) ids.push(el.dataset.node);
    });
    marquee.style.display="none";
    if(selecting.add){ const curr = getSelection(); ids.forEach(id=>curr.add(id)); setSelection([...curr]); }
    else setSelection(ids);
    selecting = null;
  }
  if(wiring){ clearPortHighlights(); wiring = null; drawEdges(); }
  endPan(e);
});

window.addEventListener("pointercancel", (e) => {
  if(resizing){
    finalizeResizeCommit();
    resizing = null;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  }
  if(dragging){ finalizeDragCommit(); dragging = null; document.body.style.userSelect = ""; }
  if(selecting){ marquee.style.display="none"; selecting=null; }
  if(wiring){ clearPortHighlights(); wiring = null; drawEdges(); }
  endPan(e);
});

// Background marquee start
nodeLayer.addEventListener("pointerdown", e => {
  if(e.button !== 0) return;
  if(e.target.closest(".node")) return;
  selecting = { startX: e.clientX, startY: e.clientY, add: e.shiftKey };
  const r = marquee.style; r.display="block"; r.left=e.clientX+"px"; r.top=e.clientY+"px"; r.width="0px"; r.height="0px";
});

// Clear selection on outside click (but let context menu handle its own)
document.addEventListener("pointerdown", e=>{
  if(!e.target.closest(".node") && !e.target.closest(".ctxmenu") && !e.target.closest(".ctxsubmenu") && !selecting){
    clearSelection();
  }
});

// Context menu on edges: quick remove last wire
edgeCanvas.addEventListener("contextmenu", e => {
  e.preventDefault();
  const g = getGraph();
  if(g.wires.length){ removeWire(g.wires[g.wires.length-1].id); }
});

// Middle-mouse panning on stage
stageWrap.addEventListener("pointerdown", (e)=>{
  if(e.button !== 1) return;
  if(e.target.closest(".node")) return;
  e.preventDefault();
  const vp = getGraph().viewport;
  isPanning = { startX: e.clientX, startY: e.clientY, vx: vp.x || 0, vy: vp.y || 0 };
  try { stageWrap.setPointerCapture?.(e.pointerId); } catch {}
  document.body.style.cursor = "grabbing";
  document.body.style.userSelect = "none";
});
function endPan(e){
  if(!isPanning) return;
  isPanning = null;
  try { stageWrap.releasePointerCapture?.(e?.pointerId); } catch {}
  document.body.style.cursor = "";
  document.body.style.userSelect = "";
}

// Scroll-wheel zoom at cursor (pan compensation)
stageWrap.addEventListener("wheel", (e)=>{
  if(e.ctrlKey) return; // let OS zoom be
  e.preventDefault();

  const vp = getGraph().viewport;
  const oldZ = vp.zoom || 1;
  const mouseWorldBefore = screenToWorld(e.clientX, e.clientY);

  const factor = Math.exp(-e.deltaY * 0.001);
  const newZ = clamp(oldZ * factor, 0.25, 3);

  vp.zoom = newZ;
  const rect = stageWrap.getBoundingClientRect();
  vp.x = e.clientX - rect.left - mouseWorldBefore.x * newZ;
  vp.y = e.clientY - rect.top  - mouseWorldBefore.y * newZ;

  applyView();
  window.dispatchEvent(new CustomEvent("gridflow:zoom-changed", { detail: { zoom: vp.zoom } }));
}, { passive:false });

// ----------------------------------------------------------------------------
// Delete confirmation modal hooks (if used by other UI)
// ----------------------------------------------------------------------------
function openModal(){ modal?.classList.remove("hidden"); btnCancel?.focus(); }
function closeModal(){ modal?.classList.add("hidden"); pendingDeleteNodeId = null; }
btnCancel?.addEventListener("click", (e)=>{ e.preventDefault(); closeModal(); });
modal?.querySelector(".modal-backdrop")?.addEventListener("click", closeModal);
btnDel?.addEventListener("click", (e)=>{ e.preventDefault(); if(pendingDeleteNodeId){ removeNode(pendingDeleteNodeId); } closeModal(); });

// Initial paint is triggered by resize + subscribe + applyView

// ----------------------------------------------------------------------------
// Wire connection handler
// ----------------------------------------------------------------------------
import { validateAndConnect } from "./plugins.js";

window.addEventListener("gridflow:wire-attempt", (e) => {
  const { from, to, kind } = e.detail || {};
  if (!from || !to) return;
  const result = validateAndConnect(from, to, kind);
  if (result?.ok) drawEdges(); // redraw if connected successfully
});