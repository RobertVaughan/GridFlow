// App bootstrap + menus + rails + bottom bar controls
import {
  getGraph, setGraph, createEmptyGraph, undo, redo, status,
  copySelection, pasteClipboard, deleteSelection
} from "./core/store.js";
import { drawAll, setShowEdges, setZoom, getZoom, setMinimapVisible } from "./core/renderer.js";
import { runGraph } from "./core/execution.js";
import { autosave, tryLoadAutosave, exportJSON, importJSON, saveProjectServer, listProjectsServer, loadProjectServer } from "./core/persistence.js";
import { loadCustomNodePacks } from "./core/custom-nodes.js";

window.addEventListener("DOMContentLoaded", async () => {
  // --- Boot: load custom packs first, then initialize UI ---
  await loadCustomNodePacks();

  // Initial load
  tryLoadAutosave();
  drawAll();
  const versionEl = document.getElementById("appVersion");
  if (versionEl) versionEl.textContent = "v" + (getGraph().version || "1.0.0");

  // --- Menu logic ---
  const menuButtons = document.querySelectorAll(".menu-btn");
  menuButtons.forEach(btn=>{
    btn.addEventListener("click", (e)=>{
      e.stopPropagation();
      const drop = btn.nextElementSibling;
      const opened = !drop.classList.contains("open");
      document.querySelectorAll(".menu-drop.open").forEach(x=>x.classList.remove("open"));
      if(opened){ drop.classList.add("open"); btn.setAttribute("aria-expanded","true"); }
      else { drop.classList.remove("open"); btn.setAttribute("aria-expanded","false"); }
    });
  });
  document.addEventListener("click", ()=> document.querySelectorAll(".menu-drop.open").forEach(x=>x.classList.remove("open")));

  // File menu
  document.getElementById("mFileNew")?.addEventListener("click", ()=>{ setGraph(createEmptyGraph()); status("New project"); });
  document.getElementById("mFileSave")?.addEventListener("click", async ()=>{
    autosave(); try{ await saveProjectServer(); }catch{ status("Saved locally (no server)"); }
  });
  document.getElementById("mFileOpen")?.addEventListener("click", async ()=>{
    try{
      const list = await listProjectsServer();
      const id = prompt("Open project id:\n"+ list.items.map(i=>`${i.id} — ${i.name}`).join("\n"));
      if(id) await loadProjectServer(id);
    }catch{
      const i = document.createElement("input"); i.type="file"; i.accept=".json,application/json";
      i.onchange = ()=> importJSON(i.files[0]).catch(e=>alert("Invalid file: "+e.message));
      i.click();
    }
  });

  // Edit menu
  document.getElementById("mEditUndo")?.addEventListener("click", undo);
  document.getElementById("mEditRedo")?.addEventListener("click", redo);
  document.getElementById("mEditCopy")?.addEventListener("click", copySelection);
  document.getElementById("mEditPaste")?.addEventListener("click", pasteClipboard);
  document.getElementById("mEditDelete")?.addEventListener("click", deleteSelection);

  // View menu
  const mSnap = document.getElementById("mViewSnap");
  const mGridSize = document.getElementById("mViewGridSize");
  const mLinks = document.getElementById("mViewLinks");
  const mMinimap = document.getElementById("mViewMinimap");
  const mTheme = document.getElementById("mViewTheme");

  if (mSnap) {
    mSnap.addEventListener("change", ()=> { getGraph().settings.snapToGrid = mSnap.checked; });
    mSnap.checked = !!getGraph().settings.snapToGrid;
  }
  if (mGridSize) {
    mGridSize.addEventListener("change", ()=> { getGraph().settings.gridSize = Number(mGridSize.value); drawAll(); });
    mGridSize.value = String(getGraph().settings.gridSize || 20);
  }
  if (mLinks) {
    mLinks.addEventListener("change", ()=> { setShowEdges(mLinks.checked); });
    mLinks.checked = true;
  }
  if (mMinimap) {
    mMinimap.addEventListener("change", ()=> { setMinimapVisible(mMinimap.checked); });
    mMinimap.checked = true;
  }
  if (mTheme) {
    mTheme.addEventListener("change", ()=> { document.body.dataset.theme = mTheme.value; getGraph().settings.theme = mTheme.value; });
    mTheme.value = getGraph().settings.theme || "dark";
  }

  // --- Rails + Slideouts (toggle open/close + outside click + Escape) ---
  const leftSlide  = document.getElementById("slideout-left");
  const rightSlide = document.getElementById("slideout-right");

  function setActivePanel(slide, panel){
    slide.querySelectorAll(".slide-body")
      .forEach(p => p.classList.toggle("active", p.dataset.panel === panel));
  }

  function toggleLeft(panel){
    const isOpen = leftSlide.classList.contains("open");
    const isSame = leftSlide.querySelector(`.slide-body[data-panel="${panel}"]`)?.classList.contains("active");
    if(isOpen && isSame){
      leftSlide.classList.remove("open");
    }else{
      setActivePanel(leftSlide, panel);
      leftSlide.classList.add("open");
    }
    document.querySelectorAll('.left-rail .rail-btn').forEach(b=>{
      const active = leftSlide.classList.contains("open") && b.dataset.slide === panel;
      b.classList.toggle("active", active);
      b.setAttribute("aria-pressed", active ? "true" : "false");
    });
  }

  function toggleRight(panel){
    const isOpen = rightSlide.classList.contains("open");
    const isSame = rightSlide.querySelector(`.slide-body[data-panel="${panel}"]`)?.classList.contains("active");
    if(isOpen && isSame){
      rightSlide.classList.remove("open");
    }else{
      setActivePanel(rightSlide, panel);
      rightSlide.classList.add("open");
    }
    document.querySelectorAll('.right-rail .rail-btn').forEach(b=>{
      const active = rightSlide.classList.contains("open") && b.dataset.slide === panel;
      b.classList.toggle("active", active);
      b.setAttribute("aria-pressed", active ? "true" : "false");
    });
  }

  document.querySelectorAll(".rail-btn").forEach(btn=>{
    btn.addEventListener("click", (e)=>{
      e.stopPropagation();
      const which = btn.dataset.slide;
      if(["nodes","workflow","custom","settings"].includes(which))      toggleLeft(which);
      else if(["history","queue"].includes(which))                      toggleRight(which);
    });
  });

  document.addEventListener("click",(e)=>{
    const inLeft  = leftSlide.contains(e.target)  || e.target.closest(".left-rail");
    const inRight = rightSlide.contains(e.target) || e.target.closest(".right-rail");
    if(!inLeft)  leftSlide.classList.remove("open");
    if(!inRight) rightSlide.classList.remove("open");

    if(!inLeft){
      document.querySelectorAll('.left-rail .rail-btn').forEach(b=>{ b.classList.remove("active"); b.setAttribute("aria-pressed","false"); });
    }
    if(!inRight){
      document.querySelectorAll('.right-rail .rail-btn').forEach(b=>{ b.classList.remove("active"); b.setAttribute("aria-pressed","false"); });
    }
  });

  document.addEventListener("keydown",(e)=>{
    if(e.key === "Escape"){
      leftSlide.classList.remove("open");
      rightSlide.classList.remove("open");
      document.querySelectorAll('.rail-btn').forEach(b=>{ b.classList.remove("active"); b.setAttribute("aria-pressed","false"); });
    }
  });

  // --- Settings slideout sync ---
  const setTheme = document.getElementById("setTheme");
  const setGridSize = document.getElementById("setGridSize");
  const setSnap = document.getElementById("setSnap");
  if (setTheme) {
    setTheme.addEventListener("change", ()=> { document.body.dataset.theme = setTheme.value; getGraph().settings.theme = setTheme.value; if(mTheme) mTheme.value = setTheme.value; });
    setTheme.value = getGraph().settings.theme || "dark";
  }
  if (setGridSize) {
    setGridSize.addEventListener("change", ()=> { getGraph().settings.gridSize = Number(setGridSize.value); if(mGridSize) mGridSize.value = setGridSize.value; drawAll(); });
    setGridSize.value = String(getGraph().settings.gridSize || 20);
  }
  if (setSnap) {
    setSnap.addEventListener("change", ()=> { getGraph().settings.snapToGrid = setSnap.checked; if(mSnap) mSnap.checked = setSnap.checked; });
    setSnap.checked = !!getGraph().settings.snapToGrid;
  }

  // --- Bottom bar ---
  const zoomPct = document.getElementById("zoomPct");
  function renderZoom(){ if(zoomPct) zoomPct.textContent = Math.round((getZoom()||1)*100) + "%"; }
  window.addEventListener("gridflow:zoom-changed", (e) => {
    const z = e.detail?.zoom ?? getZoom() ?? 1;
    if (zoomPct) zoomPct.textContent = Math.round(z * 100) + "%";
  });

  const btnZoomIn = document.getElementById("zoomIn");
  const btnZoomOut = document.getElementById("zoomOut");
  const btnResetZoom = document.getElementById("btnResetZoom");
  const btnFit = document.getElementById("btnFit");
  const btnToggleLinks = document.getElementById("btnToggleLinks");
  const btnToggleMinimap = document.getElementById("btnToggleMinimap");

  btnZoomIn?.addEventListener("click", ()=>{ setZoom((getZoom()||1)+0.1); drawAll(); renderZoom(); });
  btnZoomOut?.addEventListener("click", ()=>{ setZoom((getZoom()||1)-0.1); drawAll(); renderZoom(); });

  // IMPORTANT: After updating vp.x/vp.y/vp.zoom directly, call setZoom(vp.zoom) to apply transform.
  btnResetZoom?.addEventListener("click", ()=>{
    const vp = getGraph().viewport;
    const zOld = vp.zoom || 1;
    const zNew = 1;
    const stage = document.getElementById("stageWrap");
    const screenW = stage.clientWidth, screenH = stage.clientHeight;

    // keep center stable
    const cxWorld = (screenW/2 - (vp.x||0)) / zOld;
    const cyWorld = (screenH/2 - (vp.y||0)) / zOld;

    vp.zoom = zNew;
    vp.x = (screenW/2) - cxWorld * zNew;
    vp.y = (screenH/2) - cyWorld * zNew;

    // Apply transform + emit zoom event
    setZoom(vp.zoom);
    renderZoom();
  });

  btnFit?.addEventListener("click", ()=>{
    const g = getGraph();
    if(!g.nodes.length) return;

    let minX=Infinity, minY=Infinity, maxX=-Infinity, maxY=-Infinity;
    for(const n of g.nodes){
      const w = n.width || 220, h = n.height || 86;
      minX = Math.min(minX, n.x);
      minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + w);
      maxY = Math.max(maxY, n.y + h);
    }

    const stage = document.getElementById("stageWrap");
    const pad = 100; // visual padding
    const bbW = Math.max(1, (maxX - minX) + pad);
    const bbH = Math.max(1, (maxY - minY) + pad);
    const viewW = stage.clientWidth;
    const viewH = stage.clientHeight;

    const scaleX = viewW / bbW;
    const scaleY = viewH / bbH;
    const z = Math.max(0.25, Math.min(3, Math.min(scaleX, scaleY)));

    const vp = g.viewport;
    vp.zoom = z;
    const centerX = minX + (maxX - minX)/2;
    const centerY = minY + (maxY - minY)/2;
    vp.x = (viewW / 2) - centerX * z;
    vp.y = (viewH / 2) - centerY * z;

    // Apply transform + emit zoom event
    setZoom(vp.zoom);
    renderZoom();
  });

  let showEdges = true;
  let showMinimap = true;

  btnToggleLinks?.addEventListener("click", ()=>{
    showEdges = !showEdges;
    btnToggleLinks.classList.toggle("active", showEdges);
    setShowEdges(showEdges);
  });

  btnToggleMinimap?.addEventListener("click", ()=>{
    showMinimap = !showMinimap;
    btnToggleMinimap.classList.toggle("active", showMinimap);
    setMinimapVisible(showMinimap);
  });

  renderZoom();

  // --- Run / Stop ---
  const btnRun = document.getElementById("btnRun");
  const btnStop = document.getElementById("btnStop");
  let currentRun = null;
  btnRun?.addEventListener("click", ()=>{
    if(currentRun) return;
    const ctrl = new AbortController();
    currentRun = ctrl;
    if (btnRun) btnRun.disabled = true;
    if (btnStop) btnStop.disabled = false;
    runGraph({ signal: ctrl.signal }).catch(e=>alert("Run error: "+e.message)).finally(()=>{
      if (btnRun) btnRun.disabled = false;
      if (btnStop) btnStop.disabled = true;
      currentRun = null;
    });
  });
  btnStop?.addEventListener("click", ()=>{ currentRun?.abort(); });

  // --- Autosave ---
  setInterval(()=> autosave(), 2000);

  // --- Keyboard shortcuts ---
  document.addEventListener("keydown", e => {
    const tag = (document.activeElement?.tagName || "").toUpperCase();
    const inText = tag === "INPUT" || tag === "TEXTAREA" || document.activeElement?.isContentEditable;

    if(e.ctrlKey && e.key.toLowerCase()==="s"){ e.preventDefault(); document.getElementById("mFileSave")?.click(); }
    if(e.ctrlKey && e.key.toLowerCase()==="z"){ e.preventDefault(); undo(); }
    if(e.ctrlKey && (e.key.toLowerCase()==="y" || (e.shiftKey && e.key.toLowerCase()==="z"))){ e.preventDefault(); redo(); }

    if((e.metaKey || e.ctrlKey) && e.key.toLowerCase()==="c" && !inText){ e.preventDefault(); copySelection(); }
    if((e.metaKey || e.ctrlKey) && e.key.toLowerCase()==="v" && !inText){ e.preventDefault(); pasteClipboard(); }
    if((e.key === "Delete" || e.key === "Backspace") && !inText){ e.preventDefault(); deleteSelection(); }
  });
});