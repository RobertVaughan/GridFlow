import { getGraph, subscribe } from "../core/store.js";
import { resolveOptions } from "../core/plugins.js";

const form = document.getElementById("inspectorForm");

function render(){
  const g = getGraph();
  form.innerHTML = "";
  // Pick the first focused/selected node for now (simple)
  const sel = document.querySelector(".node.selected")?.dataset.node;
  const n = g.nodes.find(x=>x.id===sel);
  if(!n){ form.innerHTML = "<em>No node selected</em>"; return; }
  const ui = n.ui || {};
  const fields = ui.inspector || n.inspector || [];
  for(const f of fields){
    const wrap = document.createElement("label");
    wrap.textContent = f.label || f.key;
    let input = null;

    if(f.type === "select"){
      input = document.createElement("select");
      input.disabled = !!(typeof f.options === "string" && f.options.startsWith("async:"));
      (async ()=>{
        let opts = [];
        if(Array.isArray(f.options)) opts = f.options;
        else if(typeof f.options === "string" && f.options.startsWith("async:")){
          const key = f.options.split(":")[1];
          opts = await resolveOptions(key);
        }
        input.innerHTML = opts.map(o => {
          const val = (typeof o === "string") ? o : (o.value ?? o.id ?? o.name);
          const label = (typeof o === "string") ? o : (o.label ?? o.name ?? val);
          return `<option value="${String(val)}">${String(label)}</option>`;
        }).join("");
        input.disabled = false;
        input.value = n.state?.[f.key] ?? "";
      })();
    }else if(f.type === "toggle"){
      input = document.createElement("input"); input.type = "checkbox";
      input.checked = !!n.state?.[f.key];
    }else if(f.type === "number"){
      input = document.createElement("input"); input.type="number";
      input.value = Number(n.state?.[f.key] ?? 0);
    }else if(f.type === "json" || f.type === "code"){
      input = document.createElement("textarea"); input.rows = 6;
      input.value = n.state?.[f.key] ? JSON.stringify(n.state[f.key], null, 2) : "";
    }else{
      input = document.createElement("input"); input.type="text";
      input.value = n.state?.[f.key] ?? "";
    }

    input.addEventListener("change", ()=>{
      const val = (f.type === "toggle") ? input.checked
        : (f.type === "number") ? Number(input.value)
        : (f.type === "json" || f.type === "code") ? safeParse(input.value)
        : input.value;
      n.state ||= {};
      n.state[f.key] = val;
    });

    wrap.appendChild(input);
    form.appendChild(wrap);
  }
}

function safeParse(s){ try{ return JSON.parse(s); }catch{ return s; } }

subscribe(render);
window.addEventListener("gridflow:selection-changed", render);