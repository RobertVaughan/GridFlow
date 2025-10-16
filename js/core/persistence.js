// Persistence: JSON (versioned), migrations, autosave, localStorage + PHP API
import { getGraph, setGraph, createEmptyGraph, VERSION, status } from "./store.js";

// Minimal Zod-like validators for Graph/Node/Port using runtime checks
function isString(x){ return typeof x === "string"; }
function isNum(x){ return typeof x === "number" && isFinite(x); }
function isBool(x){ return typeof x === "boolean"; }
function isObj(x){ return x && typeof x === "object" && !Array.isArray(x); }

export function validateGraph(g){
  if(!isObj(g)) throw new Error("Graph must be object");
  if(!isString(g.id)) throw new Error("Graph.id");
  if(!isString(g.name)) throw new Error("Graph.name");
  if(!isString(g.version)) throw new Error("Graph.version");
  if(!isObj(g.settings)) throw new Error("Graph.settings");
  if(!isNum(g.settings.gridSize)) throw new Error("settings.gridSize");
  if(!isBool(g.settings.snapToGrid)) throw new Error("settings.snapToGrid");
  if(!isObj(g.viewport)) throw new Error("Graph.viewport");
  if(!Array.isArray(g.nodes) || !Array.isArray(g.wires) || !Array.isArray(g.groups)) throw new Error("Graph arrays");
  return true;
}

// Migrations registry
const migrations = [
  // Example: bump to 1.0.0 (no-op)
  { to: "1.0.0", run: g => g }
];

export function migrate(g){
  // Very simple semver forward-only
  for(const m of migrations){
    if(g.version !== m.to){
      g = m.run(g); g.version = m.to;
    }
  }
  return g;
}

// Local autosave
const AUTOSAVE_KEY = "gridflow/autosave";
export function autosave(){
  const g = getGraph();
  localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(g));
}
export function tryLoadAutosave(){
  const raw = localStorage.getItem(AUTOSAVE_KEY);
  if(!raw) return;
  try{
    let g = JSON.parse(raw);
    g = migrate(g);
    validateGraph(g);
    setGraph(g); status("↻ Restored autosave");
  }catch(e){
    console.warn("Autosave corrupted", e);
  }
}

// File import/export
export function exportJSON(){
  const blob = new Blob([JSON.stringify(getGraph(), null, 2)], {type:"application/json"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = (getGraph().name || "project") + ".gridflow.json";
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(a.href);
}
export function importJSON(file){
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => {
      try{
        let g = JSON.parse(r.result);
        g = migrate(g);
        validateGraph(g);
        setGraph(g);
        res(true);
      }catch(e){ rej(e); }
    };
    r.onerror = rej;
    r.readAsText(file);
  });
}

// PHP API helpers (optional server persistence)
async function api(path, body){
  const r = await fetch(`api/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body||{})
  });
  if(!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}
export async function saveProjectServer(){
  const g = getGraph(); validateGraph(g);
  const res = await api("save_project.php", { graph: g });
  status("💾 Saved to server as " + res.id);
  return res;
}
export async function loadProjectServer(id){
  const res = await api("load_project.php", { id });
  const g = migrate(res.graph); validateGraph(g); setGraph(g);
  status("📂 Loaded " + (g.name||id));
}
export async function listProjectsServer(){
  return api("list_projects.php", {});
}
