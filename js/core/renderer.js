// GridFlow Renderer: infinite grid (screen space), pan/zoom world, edges, selection, menus,
// scroll-wheel zoom at cursor, and a live minimap (nodes + viewport rect + drag-to-pan)
import {
  getGraph, subscribe, snap, removeWire, transact, removeNode,
  getSelection, setSelection, toggleSelection, clearSelection
} from "./store.js";
import { isPortCompatible } from "./plugins.js";

// DOM
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

// Delete modal
const modal       = document.getElementById("confirmModal");
const btnDel      = document.getElementById("confirmDelete");
const btnCancel   = document.getElementById("confirmCancel");
let pendingDeleteNodeId = null;

// Interaction state
let dragging  = null;      // {id, el, offsetXw, offsetYw} offsets in WORLD units
let pendingCommit = null;  // {id, x, y} world coords after drag
let wiring    = null;      // {from:{nodeId,portId}, kind:"data"|"exec", mouse:{x,y}} screen coords
let selecting = null;      // {startX,startY,add:boolean} screen coords
let isPanning = null;      // {startX,startY,vx,vy} middle-mouse pan (screen deltas)
let miniDrag  = null;      // {dx,dy} dragging the minimap viewport rectangle

// Canvases
const ctxGrid = gridCanvas.getContext("2d");
const ctxEdge = edgeCanvas.getContext("2d");

// -----------------------------------------------------------------------------
// Public controls (used by app.js)
// -----------------------------------------------------------------------------
let SHOW_EDGES = true;
export function setShowEdges(v){ SHOW_EDGES = !!v; drawEdges(); drawMinimap(); }

export function setZoom(z){
  const vp = getGraph().viewport;
  vp.zoom = Math.max(0.25, Math.min(3, z));
  applyView();
}
export function getZoom(){ return getGraph().viewport.zoom || 1; }

export function setMinimapVisible(v){
  if(miniHost) miniHost.style.display = v ? "" : "none";
  drawMinimap();
}

// Apply world transform (only stageInner is transformed)
function applyView(){
  const vp = getGraph().viewport;
  const tx = vp.x || 0, ty = vp.y || 0, z = vp.zoom || 1;
  stageInner.style.transform = `translate(${tx}px, ${ty}px) scale(${z})`;
  drawGrid();   // grid is screen-space with phase offset
  drawEdges();  // edges are screen-space
  drawMinimap();
}

// Returns the world-space center (cx, cy) of the current viewport
export function getWorldCenter(){
  const vp = getGraph().viewport || { x:0, y:0, zoom:1 };
  const z  = vp.zoom || 1;
  const screenW = document.getElementById("stageWrap").clientWidth;
  const screenH = document.getElementById("stageWrap").clientHeight;
  // visible world rect: x = -vp.x/z, y = -vp.y/z, w = screenW/z, h = screenH/z
  const cx = (- (vp.x || 0) + screenW * 0.5) / z;
  const cy = (- (vp.y || 0) + screenH * 0.5) / z;
  return { cx, cy };
}

// -----------------------------------------------------------------------------
// Utilities
// -----------------------------------------------------------------------------
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

// -----------------------------------------------------------------------------
// Sizing / resize
// -----------------------------------------------------------------------------
function resizeCanvas(){
  const rect = stageWrap.getBoundingClientRect(); // screen-space
  for(const c of [gridCanvas, edgeCanvas]){
    c.width  = Math.max(1, Math.floor(rect.width  * devicePixelRatio));
    c.height = Math.max(1, Math.floor(rect.height * devicePixelRatio));
    c.style.width  = rect.width + "px";
    c.style.height = rect.height + "px";
  }
  // minimap canvas (CSS controls rendered size; we set backing store)
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

// -----------------------------------------------------------------------------
// Infinite screen-space grid (phase offset tracks world translation)
// -----------------------------------------------------------------------------
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
  ctx.fillStyle = getComputedStyle(document.body).getPropertyValue("--grid");
  ctx.beginPath();
  for(let x = -ox; x < gridCanvas.clientWidth;  x += gridSize) ctx.rect(x, 0, 1, gridCanvas.clientHeight);
  for(let y = -oy; y < gridCanvas.clientHeight; y += gridSize) ctx.rect(0, y, gridCanvas.clientWidth, 1);
  ctx.fill();
  ctx.restore();
}

// -----------------------------------------------------------------------------
// Edges (screen-space canvas, sampling DOM pin positions)
// -----------------------------------------------------------------------------
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

// -----------------------------------------------------------------------------
// Minimap: draws nodes + viewport rect; click/drag to pan
// -----------------------------------------------------------------------------
function getWorldBounds(){
  const g = getGraph();
  if(!g.nodes.length) return { minX:0, minY:0, maxX:1, maxY:1 };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for(const n of g.nodes){
    const w = n.width || 220, h = n.height || 86;
    minX = Math.min(minX, n.x); minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x + w); maxY = Math.max(maxY, n.y + h);
  }
  // add padding
  const pad = 100;
  return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
}

function drawMinimap(){
  if(!miniCanvas || miniHost?.style.display === "none") return;

  const g   = getGraph();
  const vp  = g.viewport || { x:0, y:0, zoom:1 };
  const z   = vp.zoom || 1;

  const ctx = miniCtx;
  const css = getComputedStyle(document.body);
  const W = miniHost.clientWidth, H = miniHost.clientHeight;

  // DPR backing store is set in resizeCanvas()
  ctx.clearRect(0,0, miniCanvas.width, miniCanvas.height);
  ctx.save();
  ctx.scale(devicePixelRatio, devicePixelRatio);

  // ---- background
  const cssBg   = css.getPropertyValue("--muted-2") || "#0b0d13";
  const cssNode = css.getPropertyValue("--muted")    || "#171a22";
  const cssEdge = css.getPropertyValue("--grid")     || "#2a2f3a";
  const cssVp   = css.getPropertyValue("--accent-2") || "#22d3ee";
  const cssBd   = css.getPropertyValue("--accent")   || "#7dd3fc";
  ctx.fillStyle = cssBg.trim(); ctx.fillRect(0,0,W,H);

  // ---- compute world bounds for fitting whole scene into the minimap
  const bb = getWorldBounds();                 // {minX,minY,maxX,maxY} with padding
  const worldW = Math.max(1, bb.maxX - bb.minX);
  const worldH = Math.max(1, bb.maxY - bb.minY);
  const pad = 6;
  const fitW = Math.max(1, W - pad*2);
  const fitH = Math.max(1, H - pad*2);
  const baseScale = Math.min(fitW/worldW, fitH/worldH);
  const offX = pad - bb.minX * baseScale;
  const offY = pad - bb.minY * baseScale;

  // ---- main viewport in WORLD coords
  const screenW = stageWrap.clientWidth;
  const screenH = stageWrap.clientHeight;
  const viewW   = screenW / z;
  const viewH   = screenH / z;
  const viewX   = -(vp.x || 0) / z;
  const viewY   = -(vp.y || 0) / z;

  // We mirror the main zoom: scale nodes around the **world center** of the current view.
  const cx = viewX + viewW * 0.5;   // world center-of-view
  const cy = viewY + viewH * 0.5;

  // helper: world → minimap (with zoom-about-center)
  // positions & sizes are scaled by z about (cx,cy), then fit with baseScale
  function wxToMx(x){ return ((cx + (x - cx) * z) * baseScale) + offX; }
  function wyToMy(y){ return ((cy + (y - cy) * z) * baseScale) + offY; }
  const sizeScale = z * baseScale;

  // ---- draw nodes (now truly zooming)
  const minW = 3, minH = 2;    // minimum visibility in pixels (on minimap)
  ctx.fillStyle   = cssNode.trim();
  ctx.strokeStyle = cssBd.trim(); 
  ctx.lineWidth   = 1;

  for(const n of g.nodes){
    const nx = wxToMx(n.x);
    const ny = wyToMy(n.y);
    const nw = Math.max(minW, (n.width  || 220) * sizeScale);
    const nh = Math.max(minH, (n.height || 86)  * sizeScale);
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(nx, ny, nw, nh, 2);
    else ctx.rect(nx, ny, nw, nh);
    ctx.fill();
    ctx.globalAlpha = 0.8;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // optional subtle grid
  ctx.globalAlpha = 0.15;
  ctx.strokeStyle = cssEdge.trim();
  const step = 24;
  for(let x=0;x<W;x+=step){ ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,H); ctx.stroke(); }
  for(let y=0;y<H;y+=step){ ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke(); }
  ctx.globalAlpha = 1;

  // ---- viewport rectangle (unchanged math; reflects visible world rect)
  const mx = viewX * baseScale + offX;
  const my = viewY * baseScale + offY;
  const mw = viewW * baseScale;
  const mh = viewH * baseScale;
  ctx.setLineDash([4,3]);
  ctx.lineWidth = 2;
  ctx.strokeStyle = cssVp.trim();
  ctx.strokeRect(mx, my, mw, mh);
  ctx.setLineDash([]);

  ctx.restore();

  // keep mapping for click/drag pan (same mapping, based on baseScale fit)
  minimapMapping = { bb, scale: baseScale, offX, offY, pad };
}

// Convert a minimap position to world coords (top-left of viewport)
let minimapMapping = null;
function miniToWorld(mx, my){
  if(!minimapMapping) return { x:0, y:0 };
  const { bb, scale, offX, offY } = minimapMapping;
  const wx = (mx - offX)/scale + bb.minX;
  const wy = (my - offY)/scale + bb.minY;
  return { x: wx, y: wy };
}

// Center viewport at a world point (world center)
function centerViewAtWorld(wx, wy){
  const vp = getGraph().viewport;
  const z  = vp.zoom || 1;
  const screenW = stageWrap.clientWidth;
  const screenH = stageWrap.clientHeight;
  vp.x = (screenW/2) - wx * z;
  vp.y = (screenH/2) - wy * z;
  applyView();
}

// Minimap interactions
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
    // delta in world space -> move viewport center opposite drag
    const vp = getGraph().viewport;
    const z  = vp.zoom || 1;
    const screenW = stageWrap.clientWidth;
    const screenH = stageWrap.clientHeight;
    // current center
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

// -----------------------------------------------------------------------------
// Nodes (in world coordinates)
// -----------------------------------------------------------------------------
function renderNodes(){
  const g = getGraph();
  const selected = getSelection();
  nodeLayer.innerHTML = "";

  for(const n of g.nodes){
    const el = document.createElement("div");
    el.className = "node";
    if(selected.has(n.id)) el.classList.add("selected");
    el.dataset.node = n.id;
    el.tabIndex = 0;
    el.style.left = n.x + "px";
    el.style.top  = n.y + "px";
    el.style.width = (n.width||220) + "px";
    if(n.height) el.style.height = n.height + "px";

    const execIn  = n.inputs.filter(p=>p.dataType==="exec");
    const dataIns = n.inputs.filter(p=>p.dataType!=="exec");
    const execOut = n.outputs.filter(p=>p.dataType==="exec");
    const dataOut = n.outputs.filter(p=>p.dataType!=="exec");

    el.innerHTML = `
      <div class="title" draggable="false" style="cursor:grab;">
        <span class="title-text">${n.title}</span>
        <button class="menu-btn" type="button" aria-haspopup="menu" aria-expanded="false" title="Node menu">&#8942;</button>
        <div class="dropdown" role="menu" aria-label="Node menu">
          <button role="menuitem" data-action="props">Properties</button>
          <div class="divider"></div>
          <button class="danger" role="menuitem" data-action="delete"><span class="icon-trash" aria-hidden="true"></span>Delete</button>
        </div>
      </div>
      <div class="body">
        <div class="exec-row">
          ${execIn.length ? `<div class="port exec exec-pin in" data-kind="exec" data-dir="in" data-id="${execIn[0].id}" aria-label="Exec In"><span class="dot" aria-hidden="true"></span><span>&laquo;&laquo;</span></div>` : `<div></div>`}
          ${execOut.length ? `<div class="port exec exec-pin out" data-kind="exec" data-dir="out" data-id="${execOut[0].id}" aria-label="Exec Out"><span>&raquo;&raquo;</span><span class="dot" aria-hidden="true"></span></div>` : `<div></div>`}
        </div>
        <div class="ports in" aria-label="Inputs">
          ${dataIns.map(p => `<div class="port" data-kind="data" data-dir="in" data-id="${p.id}" aria-label="Input ${p.name} (${p.dataType})"><span class="dot" aria-hidden="true"></span><span>${p.name}</span></div>`).join("")}
        </div>
        <div class="ports out" aria-label="Outputs">
          ${dataOut.map(p => `<div class="port" data-kind="data" data-dir="out" data-id="${p.id}" aria-label="Output ${p.name} (${p.dataType})"><span class="dot" aria-hidden="true"></span><span>${p.name}</span></div>`).join("")}
        </div>
      </div>`;

    // Selection
    el.addEventListener("pointerdown", e => {
      if(e.button !== 0) return;
      if(e.target.closest(".menu-btn") || e.target.closest(".dropdown")) return;
      if(e.shiftKey) toggleSelection(n.id); else setSelection([n.id]);
    });

    // Menu
    const title = el.querySelector(".title");
    const menuButton = title.querySelector(".menu-btn");
    const dropdown = title.querySelector(".dropdown");
    function closeDropdown(){
      dropdown.classList.remove("open");
      menuButton.setAttribute("aria-expanded","false");
    }
    menuButton.addEventListener("click", (e)=>{
      e.stopPropagation();
      const open = !dropdown.classList.contains("open");
      document.querySelectorAll(".node .dropdown.open").forEach(d=>{
        d.classList.remove("open"); d.parentElement.querySelector(".menu-btn")?.setAttribute("aria-expanded","false");
      });
      if(open){ dropdown.classList.add("open"); menuButton.setAttribute("aria-expanded","true"); }
    });
    dropdown.addEventListener("click", (e)=>{
      const t = e.target.closest("[data-action]"); if(!t) return;
      e.preventDefault();
      const action = t.getAttribute("data-action");
      if(action==="delete"){ pendingDeleteNodeId = n.id; openModal(); }
      if(action==="props"){ window.dispatchEvent(new CustomEvent("gridflow:open-properties",{ detail:{ nodeId:n.id } })); }
      closeDropdown();
    });
    document.addEventListener("click", (ev)=>{
      if(!el.contains(ev.target)){ closeDropdown(); }
    }, { once:true });

    // Dragging (screen → world)
    title.addEventListener("pointerdown", e => {
      if(e.button !== 0) return;
      if(e.target.closest(".menu-btn")) return;
      e.preventDefault();
      try { title.setPointerCapture(e.pointerId); } catch {}
      const z = getZoom();
      const wrapRect = nodeLayer.getBoundingClientRect(); // screen
      const pxw = (e.clientX - wrapRect.left) / z;
      const pyw = (e.clientY - wrapRect.top)  / z;
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
        title.style.cursor = "grab"; document.body.style.userSelect = "";
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

// -----------------------------------------------------------------------------
// Master draw
// -----------------------------------------------------------------------------
export function drawAll(){ drawGrid(); renderNodes(); drawEdges(); drawMinimap(); }
resizeCanvas();
subscribe(()=>{ drawAll(); applyView(); });
applyView(); // initial

// Keep selection highlight in sync
window.addEventListener("gridflow:selection-changed", () => {
  document.querySelectorAll(".node").forEach(el=>{
    const id = el.dataset.node; if(!id) return;
    if(getSelection().has(id)) el.classList.add("selected"); else el.classList.remove("selected");
  });
});

// -----------------------------------------------------------------------------
// Global pointer handling (drag, ghost wire, marquee, middle-mouse pan)
// -----------------------------------------------------------------------------
window.addEventListener("pointermove", e => {
  const z = getZoom();

  // Dragging nodes
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

  // Middle-mouse panning
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

// Clear selection on outside click
document.addEventListener("pointerdown", e=>{
  if(!e.target.closest(".node") && !e.target.closest(".dropdown") && !e.target.closest(".menu-btn") && !selecting){
    clearSelection();
  }
});

// Context menu on edges: remove last wire (quick)
edgeCanvas.addEventListener("contextmenu", e => {
  e.preventDefault();
  const g = getGraph();
  if(g.wires.length){ removeWire(g.wires[g.wires.length-1].id); }
});

// Middle-mouse panning on stage
stageWrap.addEventListener("pointerdown", (e)=>{
  if(e.button !== 1) return;
  if(e.target.closest(".node") || e.target.closest(".dropdown") || e.target.closest(".menu-btn")) return;
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

// -----------------------------------------------------------------------------
// Scroll-wheel zoom at cursor (pan compensation)
// -----------------------------------------------------------------------------
stageWrap.addEventListener("wheel", (e)=>{
  // ctrlKey zooming is OS-level; let it pass. We use regular wheel to zoom.
  if(e.ctrlKey) return;
  e.preventDefault();

  const vp = getGraph().viewport;
  const oldZ = vp.zoom || 1;
  const mouseWorldBefore = screenToWorld(e.clientX, e.clientY);

  // zoom factor; tune the 0.001 for sensitivity
  const factor = Math.exp(-e.deltaY * 0.001);
  const newZ = clamp(oldZ * factor, 0.25, 3);

  // keep world point under cursor stationary in screen coords
  vp.zoom = newZ;
  const rect = stageWrap.getBoundingClientRect();
  vp.x = e.clientX - rect.left - mouseWorldBefore.x * newZ;
  vp.y = e.clientY - rect.top  - mouseWorldBefore.y * newZ;

  applyView();
}, { passive:false });

// -----------------------------------------------------------------------------
// Delete confirmation modal
// -----------------------------------------------------------------------------
function openModal(){ modal.classList.remove("hidden"); btnCancel.focus(); }
function closeModal(){ modal.classList.add("hidden"); pendingDeleteNodeId = null; }
btnCancel.addEventListener("click", (e)=>{ e.preventDefault(); closeModal(); });
modal.querySelector(".modal-backdrop").addEventListener("click", closeModal);
btnDel.addEventListener("click", (e)=>{ e.preventDefault(); if(pendingDeleteNodeId){ removeNode(pendingDeleteNodeId); } closeModal(); });

// Initial paint
// (resizeCanvas already called at module load via event, but ensure once)
