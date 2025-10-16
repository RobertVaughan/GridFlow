/* NodeSmith • UI extensions (rails + slideouts + menus + settings modal + footer buttons) */

(function () {
  "use strict";

  const $  = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  /* ---------- Header Menus ---------- */
  const menus = [
    { btn: $("#menu-file-btn"), panel: $("#menu-file") },
    { btn: $("#menu-edit-btn"), panel: $("#menu-edit") },
    { btn: $("#menu-view-btn"), panel: $("#menu-view") },
  ].filter(m => m.btn && m.panel);

  function closeAllMenus() {
    menus.forEach(({ btn, panel }) => {
      btn.setAttribute("aria-expanded", "false");
      panel.hidden = true;
      panel.style.left = ""; panel.style.right = ""; panel.style.top = "";
    });
  }

  function positionMenu(btn, panel) {
    const btnRect = btn.getBoundingClientRect();
    panel.hidden = false;
    panel.style.right = "0"; panel.style.left = "auto";
    panel.style.top = `calc(100% + 6px)`;
    const panRect = panel.getBoundingClientRect();
    if (panRect.right > window.innerWidth - 8) { panel.style.right = "auto"; panel.style.left = "0"; }
    const panRect2 = panel.getBoundingClientRect();
    if (panRect2.left < 8) { panel.style.left = `${8 - btnRect.left}px`; panel.style.right = "auto"; }
  }

  function toggleMenu(btn, panel) {
    const isOpen = btn.getAttribute("aria-expanded") === "true";
    closeAllMenus();
    if (!isOpen) {
      btn.setAttribute("aria-expanded", "true");
      positionMenu(btn, panel);
      panel.querySelector("button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])")?.focus();
    }
  }

  menus.forEach(({ btn, panel }) => {
    btn.addEventListener("click", (e) => { e.stopPropagation(); toggleMenu(btn, panel); });
    panel.addEventListener("keydown", (e) => { if (e.key === "Escape") { closeAllMenus(); btn.focus(); } });
  });
  document.addEventListener("click", (e) => {
    const inMenu = menus.some(({ btn, panel }) => btn.contains(e.target) || panel.contains(e.target));
    if (!inMenu) closeAllMenus();
  });
  menus.forEach(({ btn, panel }) => {
    btn.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") { e.preventDefault(); toggleMenu(btn, panel); }
    });
  });

  // Dispatchers used by app.js
  const action = (id, name) => { $("#"+id)?.addEventListener("click", () => { document.dispatchEvent(new CustomEvent(name)); closeAllMenus(); }); };
  action("action-new","nodesmith:new-project");
  action("action-open","nodesmith:open");
  action("action-save","nodesmith:save");
  action("action-export","nodesmith:export-json");
  action("action-import","nodesmith:import-json");
  action("action-undo","nodesmith:undo");
  action("action-redo","nodesmith:redo");
  action("action-select-all","nodesmith:select-all");
  action("action-delete","nodesmith:delete");
  action("action-center","nodesmith:center");
  action("action-fit","nodesmith:fit");
  $("#zoom")?.addEventListener("input", (e) => {
    const value = parseFloat(e.target.value || "1");
    document.dispatchEvent(new CustomEvent("nodesmith:zoom", { detail: { value } }));
  });

  /* ---------- Rails & Slideouts ---------- */
  const leftPanel  = $("#panel-left");
  const rightPanel = $("#panel-right");
  const leftTitle  = $("#slideout-left-title");
  const rightTitle = $("#slideout-right-title");
  const leftBody   = $("#slideout-left-body");
  const rightBody  = $("#slideout-right-body");

  const tpl = {
    nodes: `
      <div class="mgB10">
        <input id="node-search" class="input w100" type="search" placeholder="Search nodes…" autocomplete="off" />
      </div>
      <ul class="slide-list">
        <li><button class="slide-link" data-node="nodesmith/constant">Constant</button></li>
        <li><button class="slide-link" data-node="nodesmith/add">Add</button></li>
        <li><button class="slide-link" data-node="nodesmith/log">Log</button></li>
      </ul>
    `,
    workflows: `<p class="mg0">Saved workflows (coming soon)…</p>`,
    custom: `<p class="mg0">Custom node packs (coming soon)…</p>`,
    history: `<p class="mg0">Recent edits and runs (coming soon)…</p>`,
    queue: `<p class="mg0">Execution queue (coming soon)…</p>`
  };

  function openSlide(which, id) {
    if (which === "left") {
      leftBody.innerHTML = tpl[id] || "<p class='mg0'>No content.</p>";
      leftTitle.textContent = id.charAt(0).toUpperCase() + id.slice(1);
      leftPanel.hidden = false;
      requestAnimationFrame(() => { leftPanel.classList.add("is-open"); leftPanel.setAttribute("aria-hidden","false"); });
      if (id === "nodes") hookNodeButtons(leftPanel);
    } else {
      rightBody.innerHTML = tpl[id] || "<p class='mg0'>No content.</p>";
      rightTitle.textContent = id.charAt(0).toUpperCase() + id.slice(1);
      rightPanel.hidden = false;
      requestAnimationFrame(() => { rightPanel.classList.add("is-open"); rightPanel.setAttribute("aria-hidden","false"); });
    }
  }
  function closeSlide(which) {
    const panel = which === "left" ? leftPanel : rightPanel;
    panel.classList.remove("is-open");
    panel.setAttribute("aria-hidden","true");
    setTimeout(() => { panel.hidden = true; }, 180);
  }

  $$(".rail-left .rail-btn").forEach(btn => {
    const target = btn.dataset.open?.split(":")[1];
    if (target === "settings") return; // handled by modal below
    btn.addEventListener("click", () => {
      if (!leftPanel.hidden && leftTitle.textContent.toLowerCase() === target) { closeSlide("left"); return; }
      openSlide("left", target);
    });
  });
  $$(".rail-right .rail-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.open.split(":")[1];
      if (!rightPanel.hidden && rightTitle.textContent.toLowerCase() === id) { closeSlide("right"); return; }
      openSlide("right", id);
    });
  });

  $$(".slideout__close").forEach(btn => btn.addEventListener("click", () => closeSlide(btn.dataset.close)));

  document.addEventListener("click", (e) => {
    const inLeft  = leftPanel.contains(e.target)  || e.target.closest(".rail-left");
    const inRight = rightPanel.contains(e.target) || e.target.closest(".rail-right");
    if (!inLeft  && !leftPanel.hidden)  closeSlide("left");
    if (!inRight && !rightPanel.hidden) closeSlide("right");
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") { if (!leftPanel.hidden) closeSlide("left"); if (!rightPanel.hidden) closeSlide("right"); } });

  function hookNodeButtons(scope) {
    scope.querySelector("#node-search")?.addEventListener("input", (e) => {
      const ql = String(e.target.value || "").toLowerCase();
      scope.querySelectorAll(".slide-link").forEach(it => {
        const label = (it.textContent || "").toLowerCase();
        it.parentElement.style.display = (!ql || label.includes(ql)) ? "" : "none";
      });
    });
    scope.querySelectorAll(".slide-link").forEach(btn => {
      btn.addEventListener("click", () => {
        const type = btn.getAttribute("data-node");
        if (type) document.dispatchEvent(new CustomEvent("nodesmith:add-node", { detail: { type } }));
      });
    });
  }

  /* ---------- Settings modal ---------- */
  const settingsModal = $("#settings-modal");
  const openSettings  = $("#open-settings");
  function openSettingsModal() {
    settingsModal.hidden = false;
    settingsModal.setAttribute("aria-hidden","false");
    document.body.classList.add("modal-open");
    settingsModal.querySelector("#settings-title")?.focus?.();
    document.dispatchEvent(new CustomEvent("nodesmith:settings-open"));
  }
  function closeSettingsModal() {
    settingsModal.hidden = true;
    settingsModal.setAttribute("aria-hidden","true");
    document.body.classList.remove("modal-open");
    document.dispatchEvent(new CustomEvent("nodesmith:settings-close"));
  }
  openSettings?.addEventListener("click", openSettingsModal);
  settingsModal?.addEventListener("click", (e) => { if (e.target.matches("[data-close='settings'], .modal__scrim")) closeSettingsModal(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !settingsModal?.hidden) closeSettingsModal(); });

  // side tabs
  const tabs = $$(".settings-tab");
  const panels = {
    app: $("#panel-app"),
    litegraph: $("#panel-litegraph"),
    appearance: $("#panel-appearance"),
    keybinding: $("#panel-keybinding"),
    extensions: $("#panel-extensions"),
    about: $("#panel-about"),
    help: $("#panel-help")
  };
  tabs.forEach(btn => {
    btn.addEventListener("click", () => {
      tabs.forEach(t => t.classList.toggle("active", t === btn));
      Object.values(panels).forEach(p => p.classList.remove("active"));
      const id = btn.dataset.tab;
      (panels[id])?.classList.add("active");
    });
  });

  // Save / Reset buttons are handled in app.js (we dispatch events here)
  $("#settings-save")?.addEventListener("click", () => document.dispatchEvent(new CustomEvent("nodesmith:settings-save")));
  $("#settings-reset")?.addEventListener("click", () => document.dispatchEvent(new CustomEvent("nodesmith:settings-reset")));

  /* ---------- Footer quick actions ---------- */
  $("#footer-zoom-fit")?.addEventListener("click", () => document.dispatchEvent(new CustomEvent("nodesmith:fit")));
  $("#footer-minimap-toggle")?.addEventListener("click", (e) => {
    const pressed = e.currentTarget.getAttribute("aria-pressed") === "true";
    e.currentTarget.setAttribute("aria-pressed", String(!pressed));
    document.dispatchEvent(new CustomEvent("nodesmith:minimap-toggle", { detail: { visible: !pressed } }));
  });
  $("#footer-links-toggle")?.addEventListener("click", (e) => {
    const pressed = e.currentTarget.getAttribute("aria-pressed") === "true";
    e.currentTarget.setAttribute("aria-pressed", String(!pressed));
    document.dispatchEvent(new CustomEvent("nodesmith:links-toggle", { detail: { visible: !pressed } }));
  });

})();
