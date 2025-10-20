// js/ui/contextmenu.js
// Stage and Node context menus with persistent click-to-open submenus.
// Groups built-in nodes under Nodes → Math / Basics / Flow / HTTP,
// then shows Custom Packs (AI Toolkit, etc.) below a divider.

import {
  getGraph, getSelection, setSelection, copySelection,
  removeNode, transact, snap
} from "../core/store.js";
import { listNodes } from "../core/plugins.js";
import { addNode, getWorldCenter } from "../core/store.js";

function $(sel, root=document){ return root.querySelector(sel); }
function clamp(v,a,b){ return Math.max(a, Math.min(b, v)); }

const ctxRoot = document.getElementById("ctx-root");
let openMenuEl = null;

function closeCtx(){
  if(openMenuEl){ openMenuEl.remove(); openMenuEl = null; }
  if(ctxRoot){
    ctxRoot.setAttribute("aria-hidden","true");
    ctxRoot.style.pointerEvents = "none";
  }
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
      e.stopPropagation();
      closeCtx();
      onClick();
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

/** Submenu that opens/closes on click and persists until outside click */
function addSubmenu(menu, label){
  const it = addItem(menu, label);
  it.classList.add("has-submenu");

  const chev = document.createElement("span");
  chev.className = "ctxchev";
  chev.textContent = "›";
  it.appendChild(chev);

  const sm = document.createElement("div");
  sm.className = "ctxsubmenu";
  sm.setAttribute("role","menu");
  it.appendChild(sm);

  // Toggle this submenu on click; close siblings
  it.addEventListener("click", (e)=>{
    e.stopPropagation();
    it.parentElement.querySelectorAll(".has-submenu.open").forEach(el=>{
      if(el !== it) el.classList.remove("open");
    });
    it.classList.toggle("open");
  });

  // Keep submenu open when interacting inside it
  sm.addEventListener("pointerdown", (e)=> e.stopPropagation());
  sm.addEventListener("click", (e)=> e.stopPropagation());

  return { item: it, submenu: sm };
}

/* ---------------- Helpers ---------------- */
function spawnNode(def) {
  const { cx, cy } = getWorldCenter();
  const grid = getGraph().settings.gridSize || 20;
  const snapOn = !!getGraph().settings.snapToGrid;
  const w = Math.max(180, def.width || 220);
  const h = Math.max(70,  def.height || 86);
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

/* ---------------- Stage menu ---------------- */
function buildStageMenu(x, y) {
  const menu = createMenu(x, y);

  // ===== NODES (top-level) =====
  const nodesSM = addSubmenu(menu, "Nodes");

  // Build "basic" defs by excluding anything registered as part of a custom pack
  const allDefs = (listNodes?.() || []);
  const packs = window.gridflowCustomNodes || [];
  const customTypeSet = new Set();
  for(const p of packs){ for(const n of (p.nodes||[])) customTypeSet.add(n.type); }
  const basicDefs = allDefs.filter(d => !customTypeSet.has(d.type));

  // Group basics into category submenus
  const byType = (prefix) => basicDefs.filter(d => d.type?.startsWith(prefix + "."));
  const hasAny = (...arrs) => arrs.some(a => a.length);

  const mathDefs   = byType("math");
  const flowDefs   = byType("flow");
  // "Basics" merges utility + string + ui display/log into one friendly bucket
  const utilDefs   = byType("util");
  const stringDefs = byType("string");
  const uiDefs     = byType("ui");
  const httpDefs   = byType("http");

  // Create submenus only when there are items
  if (hasAny(mathDefs)) {
    const m = addSubmenu(nodesSM.submenu, "Math");
    stableSort(mathDefs).forEach(def => addItem(m.submenu, def.title, { onClick: () => spawnNode(def) }));
  }

  if (hasAny(utilDefs, stringDefs, uiDefs)) {
    const b = addSubmenu(nodesSM.submenu, "Basics");
    stableSort([...utilDefs, ...stringDefs, ...uiDefs]).forEach(def => addItem(b.submenu, def.title, { onClick: () => spawnNode(def) }));
  }

  if (hasAny(flowDefs)) {
    const f = addSubmenu(nodesSM.submenu, "Flow");
    // Prefer ordering Start → End if present
    stableSort(flowDefs, (a, b) => priorityOrder(a.type, b.type, ["flow.start","flow.end"]))
      .forEach(def => addItem(f.submenu, def.title, { onClick: () => spawnNode(def) }));
  }

  if (hasAny(httpDefs)) {
    const h = addSubmenu(nodesSM.submenu, "HTTP");
    stableSort(httpDefs).forEach(def => addItem(h.submenu, def.title, { onClick: () => spawnNode(def) }));
  }

  // Divider then Custom Packs (AI Toolkit, etc.)
  addSep(nodesSM.submenu);

  const customPacks = packs;
  if (customPacks.length) {
    customPacks.forEach(pack => {
      const packMenu = addSubmenu(nodesSM.submenu, pack.name || "Custom");
      if (pack.nodes?.length) {
        // If pack provides categories internally you can nest further; otherwise list flat
        pack.nodes
          .slice()
          .sort((a,b)=> (a.title||"").localeCompare(b.title||""))
          .forEach(node => addItem(packMenu.submenu, node.title, { onClick: () => spawnNode(node) }));
      } else {
        addItem(packMenu.submenu, "(No nodes yet)", { disabled: true });
      }
    });
  } else {
    addItem(nodesSM.submenu, "(No custom packs registered)", { disabled: true });
  }

  // ===== WORKFLOWS =====
  const wfSM = addSubmenu(menu, "Workflows");
  ["Run Graph", "Stop Graph"].forEach(name => {
    addItem(wfSM.submenu, name, {
      onClick: () =>
        window.dispatchEvent(new CustomEvent("gridflow:workflow", { detail: { action: name } }))
    });
  });

  // ===== OTHERS =====
  addSep(menu);
  addItem(menu, "Menu 1", { onClick: () => console.log("Stage > Menu 1") });
  addItem(menu, "Menu 2", { onClick: () => console.log("Stage > Menu 2") });

  return menu;
}

/* ---------------- Node menu (unchanged, trimmed to relevant bits) ---------------- */
function buildNodeMenu(x, y, nodeId){
  const menu = createMenu(x,y);

  // Properties
  addItem(menu, "Properties", {
    onClick: ()=> window.dispatchEvent(new CustomEvent("gridflow:open-properties",{ detail:{ nodeId } }))
  });

  addItem(menu, "Menu 1", { onClick: ()=>console.log("Node > Menu 1", nodeId) });

  addSep(menu);

  // Title rename
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

  // Pin/Unpin toggle
  {
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
  }

  // Colors submenu — (kept as earlier, uses ui.color keys)
  const colors = addSubmenu(menu, "Colors");
  [
    { label: "Default", key: "default" },
    { label: "Blue",    key: "blue"    },
    { label: "Red",     key: "red"     },
    { label: "Green",   key: "green"   },
    { label: "Teal",    key: "teal"    },
    { label: "Purple",  key: "purple"  },
    { label: "Orange",  key: "orange"  },
    { label: "Brown",   key: "brown"   },
    { label: "Cyan",    key: "cyan"    },
    { label: "Yellow",  key: "yellow"  }
  ].forEach(opt=>{
    addItem(colors.submenu, opt.label, {
      onClick: ()=>{
        transact(gg=>{
          const nn = gg.nodes.find(m=>m.id===nodeId);
          if(!nn) return; nn.ui ||= {}; nn.ui.color = opt.key;
        }, `Set color: ${opt.label}`);
      }
    });
  });

  // Shapes submenu — Soft (12px), Rounded (6px), Square (0px)
  const shapes = addSubmenu(menu, "Shapes");
  [
    { label:"Soft",    key:"soft"    },
    { label:"Rounded", key:"rounded" },
    { label:"Square",  key:"square"  }
  ].forEach(s=>{
    addItem(shapes.submenu, s.label, {
      onClick: ()=>{
        transact(gg=>{
          const nn = gg.nodes.find(m=>m.id===nodeId);
          if(!nn) return; nn.ui ||= {}; nn.ui.shape = s.key;
        }, `Set shape: ${s.label}`);
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

  {
    const g = getGraph();
    const node = g.nodes.find(n=>n.id===nodeId);
    const bypassed = !!node?.state?.bypass;
    addItem(menu, bypassed ? "Unbypass" : "Bypass", {
      onClick: ()=>{
        transact(gg=>{
          const nn = gg.nodes.find(m=>m.id===nodeId);
          if(!nn) return; nn.state ||= {}; nn.state.bypass = !nn.state.bypass;
        }, bypassed ? "Unbypass node" : "Bypass node");
      }
    });
  }

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

/* -------- Utilities -------- */
function stableSort(arr, cmp){
  return arr.slice().sort(cmp || ((a,b)=> (a.title||"").localeCompare(b.title||"")));
}
function priorityOrder(aType, bType, orderList){
  const ia = orderList.indexOf(aType);
  const ib = orderList.indexOf(bType);
  if(ia===-1 && ib===-1) return 0;
  if(ia===-1) return 1;
  if(ib===-1) return -1;
  return ia - ib;
}