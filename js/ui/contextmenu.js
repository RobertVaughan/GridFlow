// js/ui/contextmenu.js
import {
  getGraph, getSelection, setSelection, copySelection,
  removeNode, transact
} from "../core/store.js";

// If you wired spawning already:
import { listNodes } from "../core/plugins.js";
import { addNode, getWorldCenter, snap } from "../core/store.js";

function $(sel, root=document){ return root.querySelector(sel); }
function clamp(v,a,b){ return Math.max(a, Math.min(b, v)); }

const ctxRoot = document.getElementById("ctx-root");
let openMenuEl = null;

function closeCtx(){
  if(openMenuEl){ openMenuEl.remove(); openMenuEl = null; }
  ctxRoot.setAttribute("aria-hidden","true");
  ctxRoot.style.pointerEvents = "none";
}

function createMenu(x, y){
  closeCtx();
  const el = document.createElement("div");
  el.className = "ctxmenu";
  el.role = "menu";
  const vw = window.innerWidth, vh = window.innerHeight;
  el.style.left = clamp(x, 8, vw - 8 - 260) + "px";
  el.style.top  = clamp(y, 8, vh - 8 - 360) + "px";
  ctxRoot.appendChild(el);
  ctxRoot.removeAttribute("aria-hidden");
  ctxRoot.style.pointerEvents = "auto";
  openMenuEl = el;
  return el;
}

function addItem(menu, label, { onClick, kbd, danger, disabled } = {}){
  const it = document.createElement("div");
  it.className = "ctxitem" + (danger ? " danger" : "");
  it.setAttribute("role","menuitem");
  it.innerHTML = `<span class="ctxlabel">${label}</span>${kbd ? `<span class="ctxkbd">${kbd}</span>`:""}`;
  if(disabled){ it.setAttribute("aria-disabled","true"); }
  if(onClick && !disabled){
    it.addEventListener("click", (e)=>{
      e.stopPropagation(); // don’t bubble to root
      closeCtx(); onClick();
    });
  }
  menu.appendChild(it);
  return it;
}

function addSep(menu){
  const s = document.createElement("div");
  s.className = "ctxsep";
  menu.appendChild(s);
  return s;
}

/** Submenu that opens/closes on click and persists */
function addSubmenu(menu, label){
  const item = addItem(menu, label);
  item.classList.add("has-submenu");

  const chev = document.createElement("span");
  chev.className = "ctxchev";
  chev.textContent = "›";
  item.appendChild(chev);

  const sm = document.createElement("div");
  sm.className = "ctxsubmenu";
  sm.setAttribute("role","menu");
  item.appendChild(sm);

  // Toggle this submenu on click; close siblings
  item.addEventListener("click", (e)=>{
    e.stopPropagation(); // keep menu open
    // close any other open submenu within same parent menu
    item.parentElement.querySelectorAll(".has-submenu.open").forEach(el=>{
      if(el !== item) el.classList.remove("open");
    });
    item.classList.toggle("open");
  });

  // Keep submenu open when interacting inside it
  sm.addEventListener("pointerdown", (e)=> e.stopPropagation());
  sm.addEventListener("click", (e)=> e.stopPropagation());

  return { item, submenu: sm };
}

/* ---------------- Stage menu ---------------- */
function buildStageMenu(x, y) {
  const menu = createMenu(x, y);

  // ====== BASIC NODES SUBMENU ======
  const nodesSM = addSubmenu(menu, "Nodes");

  const basicDefs = (listNodes?.() || [])
    .filter(d => !d.customCategory) // regular nodes
    .sort((a, b) => a.title.localeCompare(b.title));

  if (basicDefs.length) {
    basicDefs.forEach(def => {
      addItem(nodesSM.submenu, def.title, {
        onClick: () => spawnNode(def)
      });
    });
  } else {
    addItem(nodesSM.submenu, "(No basic nodes registered)", { disabled: true });
  }

  // Divider between basic and custom
  addSep(nodesSM.submenu);

  // ====== CUSTOM NODE PACKS (Dynamic) ======
  const customPacks = window.gridflowCustomNodes || [];

  if (customPacks.length) {
    customPacks.forEach(pack => {
      const packMenu = addSubmenu(nodesSM.submenu, pack.name);
      if (pack.nodes?.length) {
        pack.nodes.forEach(node => {
          addItem(packMenu.submenu, node.title, {
            onClick: () => spawnNode(node)
          });
        });
      } else {
        addItem(packMenu.submenu, "(No nodes yet)", { disabled: true });
      }
    });
  } else {
    addItem(nodesSM.submenu, "(No custom packs registered)", { disabled: true });
  }

  // ====== WORKFLOW SUBMENU ======
  const wfSM = addSubmenu(menu, "Workflows");
  ["Run Graph", "Stop Graph"].forEach(name => {
    addItem(wfSM.submenu, name, {
      onClick: () => window.dispatchEvent(new CustomEvent("gridflow:workflow", { detail: { action: name } }))
    });
  });

  // ====== OTHER OPTIONS ======
  addSep(menu);
  addItem(menu, "Menu 1", { onClick: () => console.log("Stage > Menu 1") });
  addItem(menu, "Menu 2", { onClick: () => console.log("Stage > Menu 2") });

  return menu;
}

/* --- helper to spawn nodes centered in view --- */
function spawnNode(def) {
  const { cx, cy } = getWorldCenter();
  const grid = getGraph().settings.gridSize || 20;
  const snapOn = !!getGraph().settings.snapToGrid;
  const w = Math.max(180, def.width || 220);
  const h = Math.max(70, def.height || 86);
  let x = cx - w / 2;
  let y = cy - h / 2;
  if (snapOn) { x = snap(x, grid); y = snap(y, grid); }

  addNode({
    id: crypto.randomUUID(),
    type: def.type,
    title: def.title,
    x, y, width: def.width || 220, height: def.height || undefined,
    inputs: (def.inputs || []).map(p => ({ ...p })),
    outputs: (def.outputs || []).map(p => ({ ...p })),
    state: {},
    ui: def.ui || { inspector: def.inspector || [] }
  });
}


/* ---------------- Node menu ---------------- */
function buildNodeMenu(x, y, nodeId){
  const menu = createMenu(x,y);

  addItem(menu, "Properties", {
    onClick: ()=> window.dispatchEvent(new CustomEvent("gridflow:open-properties",{ detail:{ nodeId } }))
  });
  addItem(menu, "Menu 1", { onClick: ()=>console.log("Node > Menu 1", nodeId) });

  addSep(menu);

  addItem(menu, "Title…", {
    onClick: ()=>{
      const g = getGraph();
      const n = g.nodes.find(n=>n.id===nodeId);
      if(!n) return;
      const val = prompt("Node title", n.title || "");
      if(val!=null){
        transact(gg=>{ const nn = gg.nodes.find(m=>m.id===nodeId); if(nn) nn.title = val; }, "Rename node");
      }
    }
  });

  const g = getGraph();
  const node = g.nodes.find(n=>n.id===nodeId);
  const pinned = !!node?.state?.pinned;
  addItem(menu, pinned ? "Unpin" : "Pin", {
    onClick: ()=>{
      transact(gg=>{
        const nn = gg.nodes.find(m=>m.id===nodeId);
        if(!nn) return; nn.state ||= {}; nn.state.pinned = !nn.state.pinned;
      }, pinned ? "Unpin node" : "Pin node");
    }
  });

  const colors = addSubmenu(menu, "Colors");
  ["Default","Blue","Green","Amber","Red","Purple"].forEach(c=>{
    addItem(colors.submenu, c, {
      onClick: ()=>{
        transact(gg=>{
          const nn = gg.nodes.find(m=>m.id===nodeId);
          if(!nn) return; nn.ui ||= {}; nn.ui.color = c.toLowerCase();
        }, `Set color: ${c}`);
      }
    });
  });

  const shapes = addSubmenu(menu, "Shapes");
  ["Rounded","Pill","Square"].forEach(s=>{
    addItem(shapes.submenu, s, {
      onClick: ()=>{
        transact(gg=>{
          const nn = gg.nodes.find(m=>m.id===nodeId);
          if(!nn) return; nn.ui ||= {}; nn.ui.shape = s.toLowerCase();
        }, `Set shape: ${s}`);
      }
    });
  });

  addSep(menu);

  addItem(menu, "Copy", {
    onClick: ()=>{
      if(!getSelection().has(nodeId)) setSelection([nodeId]);
      copySelection();
    },
    kbd: "Ctrl/Cmd+C"
  });

  const bypassed = !!node?.state?.bypass;
  addItem(menu, bypassed ? "Unbypass" : "Bypass", {
    onClick: ()=>{
      transact(gg=>{
        const nn = gg.nodes.find(m=>m.id===nodeId);
        if(!nn) return; nn.state ||= {}; nn.state.bypass = !nn.state.bypass;
      }, bypassed ? "Unbypass node" : "Bypass node");
    }
  });

  addItem(menu, "Clone", {
    onClick: ()=>{
      const g = getGraph();
      const src = g.nodes.find(n=>n.id===nodeId);
      if(!src) return;
      transact(gg=>{
        gg.nodes.push({ ...structuredClone(src), id: crypto.randomUUID(), x: src.x + 24, y: src.y + 24 });
      }, "Clone node");
    }
  });

  addSep(menu);

  addItem(menu, "Remove", { onClick: ()=> removeNode(nodeId), danger:true, kbd:"Del" });
  return menu;
}

/* ---------------- Binding ---------------- */
window.addEventListener("DOMContentLoaded", () => {
  const stage = document.getElementById("stageWrap");
  if (!stage) { console.warn("[GridFlow] Stage not found for context menu binding."); return; }

  stage.addEventListener("contextmenu", (e) => {
    // Ignore native menus for internal dropdowns
    if(e.target.closest(".dropdown") || e.target.closest(".menu-btn")) return;
    e.preventDefault(); e.stopPropagation();

    const nodeEl = e.target.closest(".node");
    if (nodeEl) buildNodeMenu(e.clientX, e.clientY, nodeEl.dataset.node);
    else buildStageMenu(e.clientX, e.clientY);
  });

  // Clicking inside menus should NOT close them
  ctxRoot.addEventListener("pointerdown", (e)=> {
    if (openMenuEl && openMenuEl.contains(e.target)) {
      e.stopPropagation();
    }
  });
});

// Dismiss on outside click / Esc / resize / scroll
document.addEventListener("pointerdown", (e)=>{
  if(openMenuEl && !openMenuEl.contains(e.target)) closeCtx();
});
document.addEventListener("keydown", (e)=>{
  if(e.key === "Escape") closeCtx();
});
window.addEventListener("resize", closeCtx);
document.addEventListener("scroll", closeCtx, true);