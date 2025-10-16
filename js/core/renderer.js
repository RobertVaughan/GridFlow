// GridFlow Renderer — panning, correct marquee, minimap, stacked connectors.
import {
  getGraph, subscribe, snap, removeWire, transact, removeNode,
  getSelection, setSelection, toggleSelection, clearSelection
} from "./store.js";
import { isPortCompatible } from "./plugins.js";

const gridCanvas = document.getElementById("gridCanvas");
const edgeCanvas = document.getElementById("edgeCanvas");
const nodeLayer  = document.getElementById("nodeLayer");
const marquee    = document.getElementById("marquee");
const minimap    = document.getElementById("minimap");

const ctxGrid = gridCanvas.getContext("2d");
const ctxEdge = edgeCanvas.getContext("2d");
const mmCtx   = minimap?.getContext?.("2d") || null;

let dragging   = null; // {id, dx, dy, el}
let resizing   = null; // {id, startW, startH, sx, sy, el}
let pendingCommit = null; // {id, x, y} world coords (without viewport offset)
let wiring     = null; // {from:{nodeId,portId}, kind:"data"|"exec", mouse:{x,y}}
let selecting  = null; // {startX,startY,add:boolean} coords are STAGE-relative px
let panning    = null; // {startX,startY, startVx, startVy}
let spaceDown  = false;

/* ---------------- Canvas sizing ------------------ */
function stageRect(){ return gridCanvas.parentElement.getBoundingClientRect(); }

function resizeCanvas(){
  for(const c of [gridCanvas, edgeCanvas]){
    const rect = stageRect();
    c.width = rect.width * devicePixelRatio;
    c.height = rect.height * devicePixelRatio;
    c.style.width = rect.width + "px";
    c.style.height = rect.height + "px";
  }
  drawAll();
}
window.addEventListener("resize", resizeCanvas);

/* ---------------- Grid drawing w/ viewport offset ------------------ */
function drawGrid(){
  const g = getGraph();
  const s = g.settings.gridSize;
  const w = gridCanvas.width, h = gridCanvas.height;
  const vx = g.viewport.x, vy = g.viewport.y;

  ctxGrid.clearRect(0,0,w,h);
  ctxGrid.save(); ctxGrid.scale(devicePixelRatio, devicePixelRatio);
  ctxGrid.fillStyle = getComputedStyle(document.body).getPropertyValue("--grid");

  // offset so lines scroll with viewport
  const ox = ((vx % s) + s) % s;
  const oy = ((vy % s) + s) % s;

  ctxGrid.beginPath();
  for(let x=-ox; x<gridCanvas.clientWidth; x+=s){ ctxGrid.rect(x,0,1,gridCanvas.clientHeight); }
  for(let y=-oy; y<gridCanvas.clientHeight; y+=s){ ctxGrid.rect(0,y,gridCanvas.clientWidth,1); }
  ctxGrid.fill();
  ctxGrid.restore();
}

/* ---------------- Edge drawing ------------------ */
function cablePath(ax, ay, bx, by){
  const dx = Math.max(40, Math.abs(bx-ax)*0.5);
  return new Path2D(`M ${ax} ${ay} C ${ax+dx} ${ay}, ${bx-dx} ${by}, ${bx} ${by}`);
}

function drawEdges(){
  const g = getGraph();
  const rect = edgeCanvas.getBoundingClientRect();
  ctxEdge.clearRect(0,0,edgeCanvas.width, edgeCanvas.height);
  ctxEdge.save(); ctxEdge.scale(devicePixelRatio, devicePixelRatio);

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
    ctxEdge.strokeStyle = getComputedStyle(document.body).getPropertyValue(varName);
    ctxEdge.lineWidth = (w.kind==="exec") ? 3 : 2;
    ctxEdge.stroke(path);
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
      ctxEdge.setLineDash([6,6]);
      ctxEdge.strokeStyle = getComputedStyle(document.body).getPropertyValue(
        wiring.kind==="exec" ? "--wire-exec" : "--wire"
      );
      ctxEdge.stroke(path); ctxEdge.setLineDash([]);
    }
  }
  ctxEdge.restore();
}

/* ---------------- Node Rendering (offset by viewport) ------------------ */
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

    const vx = g.viewport.x, vy = g.viewport.y;
    el.style.left = (n.x + vx) + "px";
    el.style.top  = (n.y + vy) + "px";
    el.style.width = (n.width || 300) + "px";
    if(n.height) el.style.height = n.height + "px";

    // Ports (exec first on both sides)
    const inExec   = n.inputs.filter(p=>p.dataType==="exec");
    const inData   = n.inputs.filter(p=>p.dataType!=="exec");
    const outExec  = n.outputs.filter(p=>p.dataType==="exec");
    const outData  = n.outputs.filter(p=>p.dataType!=="exec");

    el.innerHTML = `
      <div class="title" draggable="false" style="cursor:grab;">
        <span class="title-text">${escapeHTML(n.title)}</span>
        <button class="menu-btn" type="button" aria-haspopup="menu" aria-expanded="false" title="Node menu">&#8942;</button>
        <div class="dropdown" role="menu" aria-label="Node menu">
          <a href="#" role="menuitem" data-action="optA">Option A</a>
          <a href="#" role="menuitem" data-action="optB">Option B</a>
          <div class="divider"></div>
          <button class="danger" role="menuitem" data-action="delete"><span class="icon-trash" aria-hidden="true"></span>Delete</button>
        </div>
      </div>

      <div class="body">
        <div class="connectors">
          <div class="ports incoming">
            ${inExec.map(p => portHTML(p, "in")).join("")}
            ${inData.map(p => portHTML(p, "in")).join("")}
          </div>
          <div class="ports outgoing">
            ${outExec.map(p => portHTML(p, "out")).join("")}
            ${outData.map(p => portHTML(p, "out")).join("")}
          </div>
        </div>

        <div class="node-content">
          ${inlineContentHTML(n)}
        </div>

        <div class="resize-handle" aria-hidden="true" title="Resize"></div>
      </div>
    `;

    /* ---- selection + menu behavior ---- */
    el.addEventListener("pointerdown", e => {
      if(e.button !== 0) return;
      if(e.target.closest(".menu-btn") || e.target.closest(".dropdown")) return;
      if(e.shiftKey) toggleSelection(n.id); else setSelection([n.id]);
    });

    // Menu
    const title = el.querySelector(".title");
    const menuButton = title.querySelector(".menu-btn");
    const dropdown = title.querySelector(".dropdown");
    function closeDropdown(){ dropdown.classList.remove("open"); menuButton.setAttribute("aria-expanded","false"); }
    menuButton.addEventListener("click", (e)=>{
      e.stopPropagation();
      const open = !dropdown.classList.contains("open");
      document.querySelectorAll(".node .dropdown.open").forEach(d=>{
        d.classList.remove("open");
        d.parentElement.querySelector(".menu-btn")?.setAttribute("aria-expanded","false");
      });
      if(open){ dropdown.classList.add("open"); menuButton.setAttribute("aria-expanded","true"); }
    });
    dropdown.addEventListener("click", (e)=>{
      const t = e.target.closest("[data-action]"); if(!t) return;
      e.preventDefault();
      const action = t.getAttribute("data-action");
      if(action==="delete"){ confirmDelete(n.id); }
      if(action==="optA"){ console.log("Option A", n.id); }
      if(action==="optB"){ console.log("Option B", n.id); }
      closeDropdown();
    });
    document.addEventListener("click", (ev)=>{ if(!el.contains(ev.target)) closeDropdown(); });

    /* ---- Dragging from title ---- */
    title.addEventListener("pointerdown", e => {
      if(e.button !== 0) return;
      if(e.target.closest(".menu-btn")) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      try { title.setPointerCapture(e.pointerId); } catch {}
      const wrap = nodeLayer.getBoundingClientRect();
      const left = rect.left - wrap.left, top = rect.top - wrap.top;
      dragging = { id: n.id, dx: e.clientX - rect.left, dy: e.clientY - rect.top, el };
      title.style.cursor = "grabbing"; document.body.style.userSelect = "none";
      el.style.left = left + "px"; el.style.top = top + "px";
    });
    title.addEventListener("pointerup", e => {
      try { title.releasePointerCapture?.(e.pointerId); } catch {}
      if(dragging && dragging.id === n.id){
        finalizeDragCommit(); dragging = null;
        title.style.cursor = "grab"; document.body.style.userSelect = "";
      }
    });

    /* ---- Inline editors ---- */
    bindInlineFields(el, n);

    /* ---- Wiring: drag from ports ---- */
    el.querySelectorAll(".port").forEach(port => {
      port.addEventListener("pointerdown", e => {
        if(e.button !== 0) return;
        const dir = port.dataset.dir;
        if(dir !== "out") return;
        const portId = port.dataset.id;
        const kind = port.dataset.kind || "data";
        wiring = {
          kind, from: { nodeId: n.id, portId },
          mouse: {
            x: e.clientX - nodeLayer.getBoundingClientRect().left,
            y: e.clientY - nodeLayer.getBoundingClientRect().top
          }
        };
      });
      port.addEventListener("pointerup", e => {
        if(!wiring) return;
        const dir = port.dataset.dir;
        const portId = port.dataset.id;
        const kind = port.dataset.kind || "data";
        if(dir === "in"){
          const drop = { nodeId: n.id, portId };
          window.dispatchEvent(new CustomEvent("gridflow:wire-attempt", { detail: { from: wiring.from, to: drop, kind } }));
        }
        wiring = null; drawEdges();
      });
    });

    /* ---- Resize handle ---- */
    const rh = el.querySelector(".resize-handle");
    rh.addEventListener("pointerdown", e => {
      if(e.button !== 0) return;
      e.stopPropagation(); e.preventDefault();
      const rect = el.getBoundingClientRect();
      resizing = { id: n.id, startW: rect.width, startH: rect.height, sx: e.clientX, sy: e.clientY, el };
      try { rh.setPointerCapture?.(e.pointerId); } catch {}
      document.body.style.userSelect = "none";
    });
    rh.addEventListener("pointerup", e => {
      try { rh.releasePointerCapture?.(e.pointerId); } catch {}
      if(resizing && resizing.id === n.id){ finalizeResizeCommit(); resizing = null; document.body.style.userSelect = ""; }
    });

    nodeLayer.appendChild(el);
  }
}

/* ---------------- Helpers for ports & inline content ------------------ */
function portHTML(p, dir){
  const kind = p.dataType==="exec" ? "exec" : "data";
  const name = escapeHTML(p.name);
  const id = escapeHTML(p.id);
  if(dir === "in"){
    const label = p.dataType==="exec" ? `<span class="chev">&laquo;&laquo;</span>` : `<span>${name}</span>`;
    return `<div class="port ${kind}" data-kind="${kind}" data-dir="in" data-id="${id}"><span class="dot" aria-hidden="true"></span>${label}</div>`;
  }else{
    const label = p.dataType==="exec" ? `<span class="chev">&raquo;&raquo;</span>` : `<span>${name}</span>`;
    return `<div class="port ${kind}" data-kind="${kind}" data-dir="out" data-id="${id}">${label}<span class="dot" aria-hidden="true"></span></div>`;
  }
}

function inlineContentHTML(n){
  if(n.type === "ollama.instructions"){
    const val = (n.state?.system ?? "");
    return `
      <div class="inline-field fill">
        <label>Custom Instructions</label>
        <textarea class="inline-ta" data-key="system">${escapeHTML(val)}</textarea>
      </div>
    `;
  }
  if(n.type === "ollama.chat_input"){
    const val = (n.state?.text ?? "");
    return `
      <div class="inline-field fill">
        <label>User Message</label>
        <textarea class="inline-ta" data-key="text">${escapeHTML(val)}</textarea>
      </div>
    `;
  }
  if(n.type === "ollama.dialog"){
    const html = (n.state?.html ?? "");
    return `<div class="dialog-window" data-dialog="1">${html}</div>`;
  }
  return `<div></div>`;
}

function bindInlineFields(el, n){
  el.querySelectorAll(".inline-ta").forEach(ta=>{
    ta.addEventListener("input", ()=>{
      const key = ta.dataset.key;
      const node = getGraph().nodes.find(x=>x.id===n.id);
      node.state ||= {};
      node.state[key] = ta.value;
    });
  });
}

/* ---------------- Commits ------------------ */
function finalizeDragCommit(){
  if(!pendingCommit) return;
  const { id, x, y } = pendingCommit; // x,y are world coords
  pendingCommit = null;
  transact(g=>{
    const node = g.nodes.find(nn=>nn.id===id);
    if(node){ node.x = x; node.y = y; }
  }, "Move node");
  drawAll();
}

function finalizeResizeCommit(){
  const g = getGraph();
  if(!resizing) return;
  const node = g.nodes.find(n=>n.id===resizing.id);
  if(!node) return;
  const grid = g.settings.gridSize;
  const rect = resizing.el.getBoundingClientRect();
  const w = Math.max(220, Math.round(rect.width  / grid) * grid);
  const h = Math.max(120, Math.round(rect.height / grid) * grid);
  transact(gr=>{
    const nn = gr.nodes.find(x=>x.id===resizing.id);
    if(nn){ nn.width = w; nn.height = h; }
  }, "Resize node");
}

/* ---------------- Public draw ------------------ */
export function drawAll(){ drawGrid(); renderNodes(); drawEdges(); drawMinimap(); }
resizeCanvas();
subscribe(drawAll);

/* ---------------- Global pointer & key handlers ------------------ */
window.addEventListener("keydown", (e)=>{ if(e.code === "Space") { spaceDown = true; document.body.classList.add("panning"); } });
window.addEventListener("keyup",   (e)=>{ if(e.code === "Space") { spaceDown = false; document.body.classList.remove("panning"); } });

window.addEventListener("pointermove", e => {
  const stage = stageRect();

  if(dragging){
    // Convert screen -> world coords
    const wrap = nodeLayer.getBoundingClientRect();
    const rawX = e.clientX - wrap.left - dragging.dx;
    const rawY = e.clientY - wrap.top  - dragging.dy;

    const g = getGraph(); const grid = g.settings.gridSize;
    const useSnap = g.settings.snapToGrid;
    const nx = useSnap ? snap(rawX - g.viewport.x, grid) : (rawX - g.viewport.x);
    const ny = useSnap ? snap(rawY - g.viewport.y, grid) : (rawY - g.viewport.y);

    // Paint with viewport offset
    dragging.el.style.left = (nx + g.viewport.x) + "px";
    dragging.el.style.top  = (ny + g.viewport.y) + "px";
    pendingCommit = { id: dragging.id, x: nx, y: ny };
    drawEdges();
  }else if(resizing){
    const dw = e.clientX - resizing.sx;
    const dh = e.clientY - resizing.sy;
    const w = Math.max(220, (resizing.startW + dw));
    const h = Math.max(120, (resizing.startH + dh));
    resizing.el.style.width  = w + "px";
    resizing.el.style.height = h + "px";
    drawEdges();
  }else if(wiring){
    wiring.mouse.x = e.clientX - nodeLayer.getBoundingClientRect().left;
    wiring.mouse.y = e.clientY - nodeLayer.getBoundingClientRect().top;
    drawEdges();
  }else if(panning){
    const g = getGraph();
    const dx = e.clientX - panning.startX;
    const dy = e.clientY - panning.startY;
    g.viewport.x = panning.startVx + dx;
    g.viewport.y = panning.startVy + dy;
    drawAll();
  }else if(selecting){
    // STAGE-relative
    const sx = Math.min(selecting.startX, e.clientX - stage.left);
    const sy = Math.min(selecting.startY, e.clientY - stage.top);
    const sw = Math.abs((e.clientX - stage.left) - selecting.startX);
    const sh = Math.abs((e.clientY - stage.top)  - selecting.startY);
    Object.assign(marquee.style, { left:sx+"px", top:sy+"px", width:sw+"px", height:sh+"px", display:"block" });
  }
});

window.addEventListener("pointerup", () => {
  if(dragging){
    finalizeDragCommit();
    dragging.el.querySelector(".title").style.cursor = "grab";
    dragging = null; document.body.style.userSelect = "";
  }
  if(resizing){
    finalizeResizeCommit();
    resizing = null; document.body.style.userSelect = "";
  }
  if(selecting){
    // Hit-test uses DOM rects; OK with viewport offset.
    const r = marquee.getBoundingClientRect();
    const ids = [];
    document.querySelectorAll(".node").forEach(el=>{
      const b = el.getBoundingClientRect();
      const hit = !(b.right < r.left || b.left > r.right || b.bottom < r.top || b.top > r.bottom);
      if(hit) ids.push(el.dataset.node);
    });
    marquee.style.display="none";
    if(selecting.add){
      const curr = getSelection(); ids.forEach(id=>curr.add(id)); setSelection([...curr]);
    }else{
      setSelection(ids);
    }
    selecting = null;
  }
  if(panning){ panning = null; document.body.style.cursor = ""; }
  if(wiring){ wiring = null; drawEdges(); }
});

window.addEventListener("pointercancel", () => {
  if(dragging){ finalizeDragCommit(); dragging = null; document.body.style.userSelect = ""; }
  if(resizing){ finalizeResizeCommit(); resizing = null; document.body.style.userSelect = ""; }
  if(selecting){ marquee.style.display="none"; selecting=null; }
  if(panning){ panning = null; document.body.style.cursor = ""; }
  if(wiring){ wiring = null; drawEdges(); }
});

/* ---------------- Floor interactions: select vs pan ------------------ */
nodeLayer.addEventListener("pointerdown", e => {
  if(e.button !== 0 && e.button !== 1) return;
  const onNode = e.target.closest(".node");
  const onMenu = e.target.closest(".dropdown") || e.target.closest(".menu-btn");
  if(onMenu) return;

  const stage = stageRect();

  // Pan if middle-mouse OR Space+left
  if(e.button === 1 || (spaceDown && e.button === 0)){
    e.preventDefault();
    const g = getGraph();
    panning = {
      startX: e.clientX,
      startY: e.clientY,
      startVx: g.viewport.x,
      startVy: g.viewport.y
    };
    document.body.style.cursor = "grabbing";
    return;
  }

  // Otherwise, start marquee select if clicking empty floor (left button)
  if(!onNode && e.button === 0){
    selecting = {
      startX: e.clientX - stage.left,
      startY: e.clientY - stage.top,
      add: e.shiftKey
    };
    const r = marquee.style;
    r.display="block"; r.left=selecting.startX+"px"; r.top=selecting.startY+"px"; r.width="0px"; r.height="0px";
    if(!e.shiftKey) clearSelection();
  }
});

// Click anywhere outside nodes/menus to close menus
document.addEventListener("pointerdown", (e)=>{
  const isNode = !!e.target.closest(".node");
  const isMenu = !!(e.target.closest(".dropdown") || e.target.closest(".menu-btn"));
  if(!isNode && !isMenu && !selecting && !panning){
    clearSelection();
    document.querySelectorAll(".node .dropdown.open").forEach(d=>{
      d.classList.remove("open");
      d.parentElement.querySelector(".menu-btn")?.setAttribute("aria-expanded","false");
    });
  }
});

/* ---------------- Minimap ------------------ */
function drawMinimap(){
  if(!mmCtx) return;
  const g = getGraph();
  const mm = minimap.getBoundingClientRect();
  minimap.width  = mm.width  * devicePixelRatio;
  minimap.height = mm.height * devicePixelRatio;

  mmCtx.save();
  mmCtx.scale(devicePixelRatio, devicePixelRatio);
  mmCtx.clearRect(0,0, minimap.clientWidth, minimap.clientHeight);

  // Compute bounds of nodes (world coords)
  const nodes = g.nodes;
  if(nodes.length === 0){ mmCtx.restore(); return; }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for(const n of nodes){
    const w = n.width || 300, h = n.height || 140;
    minX = Math.min(minX, n.x); minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x + w); maxY = Math.max(maxY, n.y + h);
  }
  // Add margins so viewport rect is visible at edges
  const pad = 100;
  minX -= pad; minY -= pad; maxX += pad; maxY += pad;

  const worldW = Math.max(1, maxX - minX);
  const worldH = Math.max(1, maxY - minY);
  const sx = minimap.clientWidth  / worldW;
  const sy = minimap.clientHeight / worldH;
  const scale = Math.min(sx, sy);
  const offX = (minimap.clientWidth  - worldW*scale)/2;
  const offY = (minimap.clientHeight - worldH*scale)/2;

  // Draw nodes as rectangles
  mmCtx.fillStyle = "#334155";
  for(const n of nodes){
    const w = n.width || 300, h = n.height || 140;
    const x = offX + (n.x - minX) * scale;
    const y = offY + (n.y - minY) * scale;
    mmCtx.fillRect(x, y, w*scale, h*scale);
  }

  // Viewport rectangle (what the stage shows)
  const stage = stageRect();
  const vx = g.viewport.x, vy = g.viewport.y;
  const viewX = offX + ( -vx - minX) * scale;
  const viewY = offY + ( -vy - minY) * scale;
  const viewW = stage.width  * scale;
  const viewH = stage.height * scale;

  mmCtx.strokeStyle = "#7dd3fc";
  mmCtx.lineWidth = 2;
  mmCtx.strokeRect(viewX, viewY, viewW, viewH);

  mmCtx.restore();

  // Click/drag to pan
  minimap.onpointerdown = (e)=>{
    e.preventDefault();
    const mmr = minimap.getBoundingClientRect();
    const start = { x: e.clientX, y: e.clientY };
    const startV = { x: g.viewport.x, y: g.viewport.y };

    const toWorld = (px, py)=>{
      const lx = px - mmr.left - offX;
      const ly = py - mmr.top  - offY;
      const wx = lx/scale + minX;
      const wy = ly/scale + minY;
      return { wx, wy };
    };

    const centerOn = (px, py)=>{
      const { wx, wy } = toWorld(px, py);
      // set viewport so stage center is at (wx, wy)
      const stage = stageRect();
      g.viewport.x = -wx + stage.width /2;
      g.viewport.y = -wy + stage.height/2;
      drawAll();
    };

    centerOn(e.clientX, e.clientY);

    const move = (ev)=>{ centerOn(ev.clientX, ev.clientY); };
    const up   = ()=>{
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
}

/* ---------------- Context menu: quick remove last wire ------------------ */
edgeCanvas.addEventListener("contextmenu", e => {
  e.preventDefault();
  const g = getGraph();
  if(g.wires.length){ removeWire(g.wires[g.wires.length-1].id); }
});

/* ---------------- Delete modal ------------------ */
function confirmDelete(id){
  const modal = document.getElementById("confirmModal");
  const btnDel = document.getElementById("confirmDelete");
  const btnCancel = document.getElementById("confirmCancel");
  modal.classList.remove("hidden"); btnCancel.focus();
  const onCancel = ()=> { modal.classList.add("hidden"); cleanup(); };
  const onBackdrop = ()=> { modal.classList.add("hidden"); cleanup(); };
  const onDel = ()=> { removeNode(id); modal.classList.add("hidden"); cleanup(); };
  function cleanup(){
    btnCancel.removeEventListener("click", onCancel);
    modal.querySelector(".modal-backdrop").removeEventListener("click", onBackdrop);
    btnDel.removeEventListener("click", onDel);
  }
  btnCancel.addEventListener("click", onCancel, { once:true });
  modal.querySelector(".modal-backdrop").addEventListener("click", onBackdrop, { once:true });
  btnDel.addEventListener("click", onDel, { once:true });
}

/* ---------------- Utils ------------------ */
function escapeHTML(s){ return String(s).replace(/[&<>"]/g, c=> ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
