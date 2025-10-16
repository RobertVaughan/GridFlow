/**
 * Nodes Panel — builds a grouped node palette:
 * - "Basic" section (built-ins)
 * - One section per custom pack (e.g., "Ollama")
 *
 * How it finds nodes:
 *  - Preferred: import { listNodes } from "../core/plugins.js"
 *  - Fallbacks: window.GF_NODES (array) or window.GF_NODE_REGISTRY (Map-like)
 *
 * How it adds nodes:
 *  - Dispatches CustomEvent("gf:add-node", { detail: { type } })
 *    Your app.js (or renderer) should listen and actually create the node.
 */

let listNodesFn = null;

// Try to import from core/plugins.js if available
try {
  // eslint-disable-next-line import/no-unresolved
  const mod = await import("../core/plugins.js");
  if (typeof mod.listNodes === "function") listNodesFn = mod.listNodes;
} catch (e) {
  // ignore — fallback to globals
}

/* ----------------------------- helpers ----------------------------- */

function titleCase(s) {
  return String(s || "")
    .replace(/[-_.]+/g, " ")
    .replace(/\b\w/g, (m) => m.toUpperCase())
    .trim();
}

// Heuristic: which node types count as "basic"
const BASIC_PREFIXES = ["const", "math", "flow", "text", "json", "net", "util"];

/**
 * Get node registry as an array of { type, title, pack?, category? }
 */
function getAllNodes() {
  if (listNodesFn) {
    // Expected shape: [{ type, title, pack?, category?, ... }, ...]
    return listNodesFn() || [];
  }
  // Fallbacks:
  if (Array.isArray(window.GF_NODES)) return window.GF_NODES;
  if (window.GF_NODE_REGISTRY && typeof window.GF_NODE_REGISTRY.forEach === "function") {
    const out = [];
    window.GF_NODE_REGISTRY.forEach((def) => out.push(def));
    return out;
  }
  // Last resort: nothing known yet
  return [];
}

/**
 * Determine the display group name for a node
 */
function resolveGroup(n) {
  // If node advertises an explicit pack or category, prefer that
  const explicit = n.pack || n.category;
  if (explicit) {
    // if it looks like "gridflow-ollama", present "Ollama"
    if (/^gridflow[-_]/i.test(explicit)) {
      const short = explicit.replace(/^gridflow[-_]/i, "");
      return titleCase(short);
    }
    return titleCase(explicit);
  }

  // Otherwise, use the prefix of the type before the first dot
  const prefix = String(n.type || "").split(".")[0];
  if (BASIC_PREFIXES.includes(prefix)) return "Basic";
  return titleCase(prefix);
}

/**
 * Split nodes into groups: { "Basic": [...], "Ollama": [...], ... }
 */
function groupNodes(nodes) {
  const groups = new Map();
  for (const n of nodes) {
    const g = resolveGroup(n);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(n);
  }

  // Sort groups: Basic first, then alphabetical
  const entries = [...groups.entries()];
  entries.sort((a, b) => {
    if (a[0] === "Basic") return -1;
    if (b[0] === "Basic") return 1;
    return a[0].localeCompare(b[0]);
  });

  // Sort nodes by title then type
  for (const [, arr] of entries) {
    arr.sort((x, y) => (x.title || x.type).localeCompare(y.title || y.type));
  }

  return entries;
}

/**
 * Render a single group section
 */
function renderGroupSection(doc, name, nodes) {
  const sec = doc.createElement("section");
  sec.className = "nodes-group";

  const h = doc.createElement("h4");
  h.className = "nodes-group__title";
  h.textContent = name;
  sec.appendChild(h);

  const grid = doc.createElement("div");
  grid.className = "nodes-grid";
  for (const n of nodes) {
    const btn = doc.createElement("button");
    btn.className = "node-pill";
    btn.type = "button";
    btn.dataset.nodeType = n.type;
    btn.title = n.title || n.type;
    btn.innerHTML = `
      <i class="ti ti-circuit-bulb" aria-hidden="true"></i>
      <span class="label">${escapeHtml(n.title || n.type)}</span>
    `;
    grid.appendChild(btn);
  }
  sec.appendChild(grid);
  return sec;
}

/* ----------------------------- public API ----------------------------- */

export function renderNodesPanel(container) {
  if (!container) return;

  // Shell: search + groups
  container.innerHTML = `
    <div class="panel-section">
      <div class="inline-field">
        <label for="nodes-search">Search</label>
        <input id="nodes-search" type="text" placeholder="Search nodes…"/>
      </div>
      <div class="nodes-groups-wrap"></div>
    </div>
  `;

  const wrap = container.querySelector(".nodes-groups-wrap");
  const search = /** @type {HTMLInputElement|null} */ (container.querySelector("#nodes-search"));

  const all = getAllNodes();
  let view = all.slice();

  const rerender = () => {
    wrap.innerHTML = "";
    const frag = document.createDocumentFragment();
    const groups = groupNodes(view);
    for (const [name, nodes] of groups) {
      frag.appendChild(renderGroupSection(container.ownerDocument, name, nodes));
    }
    wrap.appendChild(frag);
  };

  rerender();

  // Filter
  search?.addEventListener("input", () => {
    const q = (search.value || "").toLowerCase().trim();
    view = !q
      ? all.slice()
      : all.filter((n) =>
          (n.title || "").toLowerCase().includes(q) ||
          (n.type || "").toLowerCase().includes(q) ||
          (n.pack || "").toLowerCase().includes(q)
        );
    rerender();
  });

  // Click to request a new node
  container.addEventListener("click", (e) => {
    const btn = e.target.closest(".node-pill");
    if (!btn) return;
    const type = btn.dataset.nodeType;
    if (!type) return;
    container.dispatchEvent(
      new CustomEvent("gf:add-node", { bubbles: true, detail: { type } })
    );
  });
}

/* ----------------------------- utils ----------------------------- */

function escapeHtml(s) {
  return String(s)
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}
