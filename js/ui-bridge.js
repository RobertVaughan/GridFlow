/**
 * NodeSmith ⇄ GridFlow UI Bridge
 * - Menus: File/Edit/View (toggle; outside/Esc to close)
 * - Slideouts: two physical panels; dynamic content per rail button
 *   * Switch behavior across tools (Nodes/Workflows/Custom | History/Queue)
 * - Settings modal (+ optional tabs)
 * - Footer: Fit, toggle edges, toggle minimap, zoom label
 */

import { getGraph, transact } from "./core/store.js";
import { renderNodesPanel } from "./panels/nodes-panel.js";

/* -------------------- helpers -------------------- */
const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const once = (el, key) => (el && el.dataset[key] !== "1" ? (el.dataset[key] = "1", true) : false);
const setPressed = (btn, v) => btn && btn.setAttribute("aria-pressed", String(Boolean(v)));
const isPressed  = (btn) => btn?.getAttribute("aria-pressed") === "true";

/* ============================ MENUS ============================ */
function findMenuPanelForButton(btn) {
  const id = btn.getAttribute("aria-controls");
  if (id) { const p = document.getElementById(id); if (p) return p; }
  if (btn.nextElementSibling?.classList?.contains("menu-panel")) return btn.nextElementSibling;
  const wrap = btn.closest(".menu");
  return wrap ? $(".menu-panel", wrap) : null;
}
function closeAllMenus() {
  $$(".menu-panel").forEach((p)=>p.setAttribute("hidden",""));
  $$('button[aria-haspopup="true"]').forEach((b)=>b.setAttribute("aria-expanded","false"));
}
function bindMenus() {
  $$('button[aria-haspopup="true"]').forEach((btn)=>{
    if (!once(btn, "menuBound")) return;
    const panel = findMenuPanelForButton(btn); if (!panel) return;
    btn.addEventListener("click",(e)=>{
      e.stopPropagation();
      const willOpen = panel.hasAttribute("hidden");
      closeAllMenus();
      if (willOpen) { panel.removeAttribute("hidden"); btn.setAttribute("aria-expanded","true"); }
    });
  });
  if (once(document.body, "menusOutside")) {
    document.addEventListener("pointerdown",(e)=>{
      if (!e.target.closest(".menu") && !e.target.closest(".menu-panel")) closeAllMenus();
    }, true);
    document.addEventListener("keydown",(e)=>{ if (e.key === "Escape") closeAllMenus(); });
  }
}

/* ====================== SETTINGS MODAL (+tabs) ====================== */
function openModal(m) { if(m){ m.removeAttribute("hidden"); document.body.classList.add("modal-open"); } }
function closeModal(m){ if(m){ m.setAttribute("hidden",""); document.body.classList.remove("modal-open"); } }

function bindSettingsModal() {
  const settingsBtn   = $("#open-settings");
  const settingsModal = $("#settings-modal");

  if (settingsBtn && once(settingsBtn, "settingsBtn")) {
    settingsBtn.addEventListener("click", (e)=>{
      e.preventDefault(); e.stopPropagation();
      closeAllMenus();
      openModal(settingsModal);
      $(".settings-tab", settingsModal)?.focus();
    });
    settingsBtn.removeAttribute?.("data-open");
  }

  if (settingsModal && once(settingsModal, "settingsModal")) {
    $$(".modal__close,[data-close='settings']", settingsModal).forEach((btn)=>{
      if (once(btn, "settingsCloseBtn")) btn.addEventListener("click", ()=> closeModal(settingsModal));
    });
    const scrim = $(".modal__scrim", settingsModal);
    if (scrim && once(scrim, "settingsScrim")) scrim.addEventListener("click", ()=> closeModal(settingsModal));

    if (once(document.body, "settingsEsc")) {
      document.addEventListener("keydown", (e)=>{
        if (e.key === "Escape" && !settingsModal.hasAttribute("hidden")) closeModal(settingsModal);
      });
    }

    bindSettingsTabs(settingsModal); // no-op if tabs not present
  }
}

/* ------------------------- tabs (optional) ------------------------- */
function resolvePanelId(tabEl) {
  const ctrl = tabEl.getAttribute("aria-controls");
  if (ctrl) return ctrl;
  const key = tabEl.dataset.tab;
  return key ? `panel-${key}` : null;
}
function activateTab(tabs, panels, nextTab) {
  if (!nextTab) return;
  const nextId = resolvePanelId(nextTab);
  const nextPanel = nextId ? document.getElementById(nextId) : null;
  tabs.forEach(t => {
    const pid = resolvePanelId(t);
    const p = pid ? document.getElementById(pid) : null;
    const on = t === nextTab;
    t.classList.toggle("active", on);
    t.setAttribute("aria-selected", on ? "true" : "false");
    t.setAttribute("tabindex", on ? "0" : "-1");
    if (p) {
      p.classList.toggle("active", on);
      p.setAttribute("aria-hidden", on ? "false" : "true");
      p.setAttribute("tabindex", on ? "0" : "-1");
    }
  });
  nextTab.focus();
}
function bindSettingsTabs(modal) {
  const tablist = $(".settings-tabs", modal);
  const tabs    = $$(".settings-tab", modal);
  const panels  = $$(".settings-panel", modal);
  if (!tablist || !tabs.length || !panels.length) return;

  tablist.setAttribute("role", "tablist");
  tabs.forEach((t)=>{
    t.setAttribute("role","tab");
    const pid = resolvePanelId(t);
    if (pid) t.setAttribute("aria-controls", pid);
    t.setAttribute("aria-selected", t.classList.contains("active") ? "true" : "false");
    t.setAttribute("tabindex", t.classList.contains("active") ? "0" : "-1");
  });
  panels.forEach((p)=>{
    p.setAttribute("role","tabpanel");
    p.setAttribute("aria-hidden", p.classList.contains("active") ? "false" : "true");
    if (!p.hasAttribute("tabindex")) p.setAttribute("tabindex", p.classList.contains("active") ? "0" : "-1");
  });

  tabs.forEach(t => {
    if (once(t, "settingsTabClick")) {
      t.addEventListener("click", (e)=>{ e.preventDefault(); activateTab(tabs, panels, t); });
    }
  });
  if (once(tablist, "settingsTabKeys")) {
    tablist.addEventListener("keydown", (e)=>{
      const current = tabs.find(t => t.getAttribute("aria-selected")==="true") || tabs[0];
      const idx = tabs.indexOf(current);
      let nextIdx = idx;
      if (e.key === "ArrowRight") nextIdx = (idx + 1) % tabs.length;
      if (e.key === "ArrowLeft")  nextIdx = (idx - 1 + tabs.length) % tabs.length;
      if (e.key === "Home") nextIdx = 0;
      if (e.key === "End")  nextIdx = tabs.length - 1;
      if (nextIdx !== idx) { e.preventDefault(); activateTab(tabs, panels, tabs[nextIdx]); }
    });
  }
  const activeTab = tabs.find(t => t.classList.contains("active")) || tabs[0];
  activateTab(tabs, panels, activeTab);
}

/* ============================ SLIDEOUTS ============================ */
const LEFT_PANEL  = $("#panel-left");
const RIGHT_PANEL = $("#panel-right");
const LEFT_TITLE  = $("#slideout-left-title");
const RIGHT_TITLE = $("#slideout-right-title");
const LEFT_BODY   = $("#slideout-left-body");
const RIGHT_BODY  = $("#slideout-right-body");

if (LEFT_PANEL && !LEFT_PANEL.dataset.currentKey) LEFT_PANEL.dataset.currentKey = "";
if (RIGHT_PANEL && !RIGHT_PANEL.dataset.currentKey) RIGHT_PANEL.dataset.currentKey = "";

const SLIDEOUT_CONTENT = {
  "left:nodes":     { title: "Nodes",     tpl: "tpl-left-nodes" },
  "left:workflows": { title: "Workflows", tpl: "tpl-left-workflows" },
  "left:custom":    { title: "Custom",    tpl: "tpl-left-custom" },
  "right:history":  { title: "History",   tpl: "tpl-right-history" },
  "right:queue":    { title: "Queue",     tpl: "tpl-right-queue" }
};

const isOpen  = (w)=>{ const el = w==="right"?RIGHT_PANEL:LEFT_PANEL; return !!el && !el.hasAttribute("hidden") && el.classList.contains("is-open"); };

function openSlide(which) {
  const el = which === "right" ? RIGHT_PANEL : LEFT_PANEL;
  if (!el) return;
  el.classList.remove("is-closing");
  el.removeAttribute("hidden");
  // force reflow
  // eslint-disable-next-line no-unused-expressions
  el.offsetWidth;
  el.classList.add("is-open");
}
function closeSlide(which) {
  const el = which === "right" ? RIGHT_PANEL : LEFT_PANEL;
  if (!el) return;
  if (!el.classList.contains("is-open")) { el.setAttribute("hidden", ""); el.classList.remove("is-closing"); return; }
  el.classList.remove("is-open");
  el.classList.add("is-closing");
  const done = () => {
    el.setAttribute("hidden", "");
    el.classList.remove("is-closing");
    el.removeEventListener("transitionend", done);
  };
  el.addEventListener("transitionend", done);
  setTimeout(done, 300);
}

function setSlideoutContent(whichKey) {
  const conf = SLIDEOUT_CONTENT[whichKey];
  if (!conf) return;
  const tpl = document.getElementById(conf.tpl);

  // Swap titles
  if (whichKey.startsWith("left:")) {
    if (LEFT_TITLE) LEFT_TITLE.textContent = conf.title;
    if (LEFT_BODY) {
      if (whichKey === "left:nodes") {
        // Build grouped node palette dynamically
        LEFT_BODY.innerHTML = "";
        renderNodesPanel(LEFT_BODY);
      } else {
        LEFT_BODY.innerHTML = "";
        if (tpl) LEFT_BODY.appendChild(tpl.content.cloneNode(true));
      }
    }
    if (LEFT_PANEL) LEFT_PANEL.dataset.currentKey = whichKey;
  } else {
    if (RIGHT_TITLE) RIGHT_TITLE.textContent = conf.title;
    if (RIGHT_BODY) {
      RIGHT_BODY.innerHTML = "";
      if (tpl) RIGHT_BODY.appendChild(tpl.content.cloneNode(true));
    }
    if (RIGHT_PANEL) RIGHT_PANEL.dataset.currentKey = whichKey;
  }
}

function bindSlideouts() {
  // Rail buttons: switch behavior
  $$(".rail-btn[data-open]").forEach((btn)=>{
    if (!once(btn,"railBound")) return;
    btn.addEventListener("click",(e)=>{
      e.stopPropagation();
      const key = btn.dataset.open || "";           // e.g., "left:nodes"
      if (!key) return;
      if (btn.id === "open-settings") return;       // settings is modal

      const side = key.startsWith("right:") ? "right" : "left";
      const other = side === "right" ? "left" : "right";
      const panel = side === "right" ? RIGHT_PANEL : LEFT_PANEL;
      const currentKey = panel?.dataset.currentKey || "";

      if (isOpen(other)) closeSlide(other);

      if (isOpen(side)) {
        if (currentKey === key) {
          // toggle close
          closeSlide(side);
          panel.dataset.currentKey = "";
        } else {
          // swap content in place
          setSlideoutContent(key);
        }
      } else {
        setSlideoutContent(key);
        openSlide(side);
      }
    });
  });

  // Close buttons
  $$(".slideout__close").forEach((b)=>{
    if (!once(b,"slideClose")) return;
    b.addEventListener("click",()=>{
      const w = b.dataset.close || (b.closest("#panel-right") ? "right" : "left");
      closeSlide(w);
      const el = w === "right" ? RIGHT_PANEL : LEFT_PANEL;
      if (el) el.dataset.currentKey = "";
    });
  });

  // Outside click closes (ignore rails/menus/modals)
  if (once(document.body,"slideOutside")) {
    document.addEventListener("pointerdown",(e)=>{
      if (
        e.target.closest("#settings-modal") || e.target.closest(".modal__dialog") || e.target.closest(".modal__scrim") ||
        e.target.closest("#panel-left") || e.target.closest("#panel-right") ||
        e.target.closest(".rail") || e.target.closest(".menu") || e.target.closest(".menu-panel")
      ) return;
      if (isOpen("left"))  { closeSlide("left");  if (LEFT_PANEL) LEFT_PANEL.dataset.currentKey = ""; }
      if (isOpen("right")) { closeSlide("right"); if (RIGHT_PANEL) RIGHT_PANEL.dataset.currentKey = ""; }
    }, true);
  }
  // Esc
  if (once(document.body,"slideEsc")) {
    document.addEventListener("keydown",(e)=>{
      if (e.key==="Escape"){
        if (isOpen("left"))  { closeSlide("left");  if (LEFT_PANEL) LEFT_PANEL.dataset.currentKey = ""; }
        if (isOpen("right")) { closeSlide("right"); if (RIGHT_PANEL) RIGHT_PANEL.dataset.currentKey = ""; }
      }
    });
  }
}

/* ============================ FOOTER ============================ */
function bindFooter() {
  const fitBtn   = $("#footer-zoom-fit");
  const linksBtn = $("#footer-links-toggle");
  const miniBtn  = $("#footer-minimap-toggle");
  const edge     = $("#edgeCanvas");
  const minimap  = $("#minimap");
  const zoom     = $("#zoom");
  const zoomLbl  = $("#footer-zoom-label");

  if (fitBtn && once(fitBtn,"fitBound")) {
    fitBtn.addEventListener("click", ()=>{
      const g = getGraph(); if (!g?.nodes?.length) return;
      let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
      for (const n of g.nodes) { const w=n.width||300,h=n.height||140; minX=Math.min(minX,n.x); minY=Math.min(minY,n.y); maxX=Math.max(maxX,n.x+w); maxY=Math.max(maxY,n.y+h); }
      const stage = $(".canvas-wrap")?.getBoundingClientRect(); if (!stage) return;
      const cx=(minX+maxX)/2, cy=(minY+maxY)/2;
      transact((gg)=>{ gg.viewport.x = -cx + stage.width/2; gg.viewport.y = -cy + stage.height/2; }, "Center viewport");
    });
  }

  if (linksBtn && once(linksBtn,"linksBound")) {
    if (!linksBtn.hasAttribute("aria-pressed")) setPressed(linksBtn, true);
    linksBtn.addEventListener("click",(e)=>{
      const now = !isPressed(linksBtn);
      setPressed(linksBtn, now);
      if (edge) edge.style.display = now ? "" : "none";
      e.stopPropagation();
    });
  }

  if (miniBtn && once(miniBtn,"minimapBound")) {
    if (!miniBtn.hasAttribute("aria-pressed")) setPressed(miniBtn, true);
    miniBtn.addEventListener("click",(e)=>{
      const now = !isPressed(miniBtn);
      setPressed(miniBtn, now);
      if (minimap) minimap.style.display = now ? "" : "none";
      e.stopPropagation();
    });
  }

  if (zoom && zoomLbl && once(zoom,"zoomBound")) {
    const update = ()=> zoomLbl.textContent = `${Math.round(parseFloat(zoom.value)*100)}%`;
    zoom.addEventListener("input", update); update();
  }
}

/* ============================ INIT ============================ */
function init() {
  if (document.documentElement.dataset.uibridge === "1") return;
  document.documentElement.dataset.uibridge = "1";
  bindMenus();
  bindSlideouts();
  bindSettingsModal();
  bindFooter();

  const mo = new MutationObserver(()=>{
    bindMenus();
    bindSlideouts();
    bindSettingsModal();
    bindFooter();
  });
  mo.observe(document.body, { childList:true, subtree:true });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init, { once:true });
} else {
  init();
}