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

// Canvases
const ctxGrid = gridCanvas.getContext("2d");
const ctxEdge = edgeCanvas.getContext("2d");

// Shapes map (order: Soft, Rounded, Square)
const NODE_SHAPE_RADIUS = {
  soft: 12,
  rounded: 6,
  square: 0
};

/* ========================================================================== */
/* Inline editor helpers for generator nodes (util.integer, util.string)      */
/* ========================================================================== */
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
// Grid (screen-space with phase following world translate)
// ----------------------------------------------------------------------------
function drawGrid(){
  const g = getGraph();
  const { gridSize } = g.settings;
  const w = gridCanvas.width, h = gridCanvas.height;

  const vp = g.viewport || { x:0, y:0, zoom:1 };
  const ox = ((vp.x % gridSize) + gridSize) % gridSize;
  const oy = ((vp.y % gridSize) + gridSize) % gridSize;

  const ctx = ctxGrid;
  ctx.clearRect(0,0,w,h);
  ctx.save();
  ctx.scale(devicePixelRatio, devicePixelRatio);
  const css = getComputedStyle(document.body);
  ctx.fillStyle = css.getPropertyValue("--grid");
  ctx.beginPath();
  for(let x = -ox; x < gridCanvas.clientWidth;  x += gridSize) ctx.rect(x, 0, 1, gridCanvas.clientHeight);
  for(let y = -oy; y < gridCanvas.clientHeight; y += gridSize) ctx.rect(0, y, gridCanvas.clientWidth, 1);
  ctx.fill();
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
  // Construct a safe CSS var() reference or empty string to let theme default show.
  let cssVarRef = "";
  if (key) {
    if (key === "orange") {
      // Fallback to --node-orange if present, else fallback to --node-orage (as in the provided CSS)
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
    const dataOut = n.outputs.filter(p=>p.dataType!=="exec");

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

        <!-- Inline editor row will be injected here for util.integer / util.string -->

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
      </div>`;

    /* -------- Inline editor injection for generator nodes (util.integer, util.string) -------- */
    (function attachInlineEditor(){
      const bodyEl = el.querySelector(".body");
      if(!bodyEl) return;

      // Detect supported generator types
      let editorSpec = null;
      if(n.type === "util.integer"){
        const curr = Number.isFinite(Number(n.state?.value)) ? (Number(n.state.value)|0) : 0;
        editorSpec = {
          label: "Value",
          stateKey: "value",
          inputType: "number",
          value: String(curr),
          step: "1",
          parse: (v)=> {
            const num = Number(v);
            return Number.isFinite(num) ? (num|0) : 0;
          },
          commitLabel: "Edit Integer"
        };
      }else if(n.type === "util.string"){
        const curr = String(n.state?.text ?? "");
        editorSpec = {
          label: "Text",
          stateKey: "text",
          inputType: "text",
          value: curr,
          step: null,
          parse: (v)=> String(v ?? ""),
          commitLabel: "Edit String"
        };
      }

      if(!editorSpec) return;

      // Create editor row container after exec row, before io-cols
      const execRow = bodyEl.querySelector(".exec-row");
      const row = document.createElement("div");
      row.className = "inline-editor-row";
      row.style.cssText = "display:flex;align-items:center;gap:8px;margin:6px 0 8px;";

      row.innerHTML = `
        <input
          class="inline-editor"
          type="${editorSpec.inputType}"
          ${editorSpec.step ? `step="${editorSpec.step}"` : ""}
          value="${editorSpec.value.replace(/"/g, '&quot;')}"
          style="flex:1;background:#111a;border:1px solid #333;color:var(--fg);
                 border-radius:6px;padding:4px 6px;min-height:26px;"
          aria-label="${editorSpec.label}"
        />
        <div class="port" data-kind="data" data-dir="out" data-id="${n.outputs?.[0]?.id || 'value'}"
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
        const parsed = editorSpec.parse(inp.value);
        setNodeStateDebounced(n.id, editorSpec.stateKey, parsed, editorSpec.commitLabel);
      };
      inp.addEventListener("input", commit);
      inp.addEventListener("change", commit);
      inp.addEventListener("blur", commit);
    })();
    /* ----------------------------------------------------------------------------------------- */

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

    // Wiring
    el.querySelectorAll(".port").forEach(port => {
      port.addEventListener("pointerdown", e => {
        if(e.button !== 0) return;
        const dir = port.dataset.dir;
        const portId = port.dataset.id;
        const kind = port.dataset.kind || "data";
        if(dir === "out"){
          wiring = {
            kind,
            from: { nodeId: n.id, portId },
            mouse: {
              x: e.clientX - edgeCanvas.getBoundingClientRect().left,
              y: e.clientY - edgeCanvas.getBoundingClientRect().top
            }
          };
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
        wiring = null; drawEdges();
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
// Global pointer handling (drag/move/wire/marquee/pan)
// ----------------------------------------------------------------------------
window.addEventListener("pointermove", e => {
  const z = getZoom();

  // Dragging node
  if(dragging){
    const wrapRect = nodeLayer.getBoundingClientRect();
    let nx = (e.clientX - wrapRect.left)/z - dragging.offsetXw;
    let ny = (e.clientY - wrapRect.top )/z - dragging.offsetYw;
    const grid = getGraph().settings.gridSize;
    if(getGraph().settings.snapToGrid){ nx = snap(nx, grid); ny = snap(ny, grid); }
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
  if(wiring){ wiring = null; drawEdges(); }
  endPan(e);
});

window.addEventListener("pointercancel", (e) => {
  if(dragging){ finalizeDragCommit(); dragging = null; document.body.style.userSelect = ""; }
  if(selecting){ marquee.style.display="none"; selecting=null; }
  if(wiring){ wiring = null; drawEdges(); }
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
