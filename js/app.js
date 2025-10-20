// App bootstrap + menus + rails + bottom bar controls
import {
  getGraph, setGraph, createEmptyGraph, undo, redo, status,
  copySelection, pasteClipboard, deleteSelection
} from "./core/store.js";
import { drawAll, setShowEdges, setZoom, getZoom, setMinimapVisible } from "./core/renderer.js";
import { runGraph } from "./core/execution.js";
import { autosave, tryLoadAutosave, exportJSON, importJSON, saveProjectServer, listProjectsServer, loadProjectServer } from "./core/persistence.js";

// Initial load
tryLoadAutosave();
drawAll();
document.getElementById("appVersion").textContent = "v" + (getGraph().version || "1.0.0");

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
document.getElementById("mFileNew").addEventListener("click", ()=>{ setGraph(createEmptyGraph()); status("New project"); });
document.getElementById("mFileSave").addEventListener("click", async ()=>{
  autosave(); try{ await saveProjectServer(); }catch{ status("Saved locally (no server)"); }
});
document.getElementById("mFileOpen").addEventListener("click", async ()=>{
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
document.getElementById("mEditUndo").addEventListener("click", undo);
document.getElementById("mEditRedo").addEventListener("click", redo);
document.getElementById("mEditCopy").addEventListener("click", copySelection);
document.getElementById("mEditPaste").addEventListener("click", pasteClipboard);
document.getElementById("mEditDelete").addEventListener("click", deleteSelection);

// View menu
const mSnap = document.getElementById("mViewSnap");
const mGridSize = document.getElementById("mViewGridSize");
const mLinks = document.getElementById("mViewLinks");
const mMinimap = document.getElementById("mViewMinimap");
const mTheme = document.getElementById("mViewTheme");

mSnap.addEventListener("change", ()=> { getGraph().settings.snapToGrid = mSnap.checked; });
mGridSize.addEventListener("change", ()=> { getGraph().settings.gridSize = Number(mGridSize.value); drawAll(); });
mLinks.addEventListener("change", ()=> { setShowEdges(mLinks.checked); });
mMinimap.addEventListener("change", ()=> { setMinimapVisible(mMinimap.checked); });
mTheme.addEventListener("change", ()=> { document.body.dataset.theme = mTheme.value; getGraph().settings.theme = mTheme.value; });

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
  // reflect button state
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

// Button clicks: toggle
document.querySelectorAll(".rail-btn").forEach(btn=>{
  btn.addEventListener("click", (e)=>{
    e.stopPropagation();
    const which = btn.dataset.slide;
    if(["nodes","workflow","custom","settings"].includes(which))      toggleLeft(which);
    else if(["history","queue"].includes(which))                      toggleRight(which);
  });
});

// Click outside closes
document.addEventListener("click",(e)=>{
  // ignore clicks originating inside rails or slideouts
  const inLeft  = leftSlide.contains(e.target)  || e.target.closest(".left-rail");
  const inRight = rightSlide.contains(e.target) || e.target.closest(".right-rail");
  if(!inLeft)  leftSlide.classList.remove("open");
  if(!inRight) rightSlide.classList.remove("open");

  // reset pressed state
  if(!inLeft){
    document.querySelectorAll('.left-rail .rail-btn').forEach(b=>{ b.classList.remove("active"); b.setAttribute("aria-pressed","false"); });
  }
  if(!inRight){
    document.querySelectorAll('.right-rail .rail-btn').forEach(b=>{ b.classList.remove("active"); b.setAttribute("aria-pressed","false"); });
  }
});

// Esc closes both
document.addEventListener("keydown",(e)=>{
  if(e.key === "Escape"){
    leftSlide.classList.remove("open");
    rightSlide.classList.remove("open");
    document.querySelectorAll('.rail-btn').forEach(b=>{ b.classList.remove("active"); b.setAttribute("aria-pressed","false"); });
  }
});


// Sync Settings slideout controls
const setTheme = document.getElementById("setTheme");
const setGridSize = document.getElementById("setGridSize");
const setSnap = document.getElementById("setSnap");
setTheme.addEventListener("change", ()=> { document.body.dataset.theme = setTheme.value; getGraph().settings.theme = setTheme.value; mTheme.value = setTheme.value; });
setGridSize.addEventListener("change", ()=> { getGraph().settings.gridSize = Number(setGridSize.value); mGridSize.value = setGridSize.value; drawAll(); });
setSnap.addEventListener("change", ()=> { getGraph().settings.snapToGrid = setSnap.checked; mSnap.checked = setSnap.checked; });

// --- Bottom bar ---
const zoomPct = document.getElementById("zoomPct");
function renderZoom(){ zoomPct.textContent = Math.round((getZoom()||1)*100) + "%"; }
document.getElementById("zoomIn").addEventListener("click", ()=>{ setZoom((getZoom()||1)+0.1); renderZoom(); drawAll(); });
document.getElementById("zoomOut").addEventListener("click", ()=>{ setZoom((getZoom()||1)-0.1); renderZoom(); drawAll(); });
renderZoom();

const toggleLinks = document.getElementById("toggleLinks");
const toggleMinimap = document.getElementById("toggleMinimap");
toggleLinks.addEventListener("change", ()=> setShowEdges(toggleLinks.checked));
toggleMinimap.addEventListener("change", ()=> setMinimapVisible(toggleMinimap.checked));

// Run / Stop
const btnRun = document.getElementById("btnRun");
const btnStop = document.getElementById("btnStop");
let currentRun = null;
btnRun.addEventListener("click", ()=>{
  if(currentRun) return;
  const ctrl = new AbortController();
  currentRun = ctrl;
  btnRun.disabled = true; btnStop.disabled = false;
  runGraph({ signal: ctrl.signal }).catch(e=>alert("Run error: "+e.message)).finally(()=>{
    btnRun.disabled = false; btnStop.disabled = true; currentRun = null;
  });
});
btnStop.addEventListener("click", ()=>{ currentRun?.abort(); });

// Autosave heartbeat
setInterval(()=> autosave(), 2000);

// Keyboard shortcuts remain (copy/paste/delete, undo/redo, save)
document.addEventListener("keydown", e => {
  const targetTag = (document.activeElement?.tagName || "").toUpperCase();
  const inTextField = targetTag === "INPUT" || targetTag === "TEXTAREA" || document.activeElement?.isContentEditable;

  if(e.ctrlKey && e.key.toLowerCase()==="s"){ e.preventDefault(); document.getElementById("mFileSave").click(); }
  if(e.ctrlKey && e.key.toLowerCase()==="z"){ e.preventDefault(); undo(); }
  if(e.ctrlKey && (e.key.toLowerCase()==="y" || (e.shiftKey && e.key.toLowerCase()==="z"))){ e.preventDefault(); redo(); }

  if((e.metaKey || e.ctrlKey) && e.key.toLowerCase()==="c" && !inTextField){ e.preventDefault(); copySelection(); }
  if((e.metaKey || e.ctrlKey) && e.key.toLowerCase()==="v" && !inTextField){ e.preventDefault(); pasteClipboard(); }
  if((e.key === "Delete" || e.key === "Backspace") && !inTextField){ e.preventDefault(); deleteSelection(); }
});
