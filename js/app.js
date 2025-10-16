// App bootstrap
import { getGraph, setGraph, createEmptyGraph, undo, redo, status,
  copySelection, pasteClipboard, deleteSelection
} from "./core/store.js";
import { drawAll } from "./core/renderer.js";
import { runGraph } from "./core/execution.js";
import { autosave, tryLoadAutosave, exportJSON, importJSON, saveProjectServer, listProjectsServer, loadProjectServer } from "./core/persistence.js";

const btnNew = document.getElementById("btnNew");
const btnOpen = document.getElementById("btnOpen");
const btnSave = document.getElementById("btnSave");
const gridSize = document.getElementById("gridSize");
const snapToggle = document.getElementById("snapToggle");
const themeSelect = document.getElementById("themeSelect");
const stageWrap = document.getElementById("stageWrap");

tryLoadAutosave();
drawAll();

// Toolbar bindings
btnNew.addEventListener("click", ()=>{ setGraph(createEmptyGraph()); status("New project"); });
btnSave.addEventListener("click", async ()=>{
  autosave();
  try{ await saveProjectServer(); }catch{ status("Saved locally (no server)"); }
});
btnOpen.addEventListener("click", async ()=>{
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

gridSize.addEventListener("change", ()=> { getGraph().settings.gridSize = Number(gridSize.value); drawAll(); });
snapToggle.addEventListener("change", ()=> { getGraph().settings.snapToGrid = snapToggle.checked; });
themeSelect.addEventListener("change", ()=>{ document.body.dataset.theme = themeSelect.value; getGraph().settings.theme = themeSelect.value; });

// Keybindings
document.addEventListener("keydown", e => {
  const targetTag = (document.activeElement?.tagName || "").toUpperCase();
  const inTextField = targetTag === "INPUT" || targetTag === "TEXTAREA" || document.activeElement?.isContentEditable;

  if(e.ctrlKey && e.key.toLowerCase()==="s"){ e.preventDefault(); btnSave.click(); }
  if(e.ctrlKey && e.key.toLowerCase()==="z"){ e.preventDefault(); undo(); }
  if(e.ctrlKey && (e.key.toLowerCase()==="y" || (e.shiftKey && e.key.toLowerCase()==="z"))){ e.preventDefault(); redo(); }

  // Copy / Paste (skip when typing in inputs)
  if((e.metaKey || e.ctrlKey) && e.key.toLowerCase()==="c" && !inTextField){ e.preventDefault(); copySelection(); }
  if((e.metaKey || e.ctrlKey) && e.key.toLowerCase()==="v" && !inTextField){ e.preventDefault(); pasteClipboard(); }

  // Delete selection
  if((e.key === "Delete" || e.key === "Backspace") && !inTextField){ e.preventDefault(); deleteSelection(); }
});

// Simple run on double click background (demo)
stageWrap.addEventListener("dblclick", ()=>{
  const ctrl = new AbortController();
  runGraph({ signal: ctrl.signal }).catch(e=>alert("Run error: "+e.message));
});

// Autosave heartbeat
setInterval(()=> autosave(), 2000);
