// Inspector modal: opens on "Properties" menu item
import { getGraph, transact } from "../core/store.js";
import { getNodeDefinition } from "../core/plugins.js";

const modal = document.getElementById("inspectorModal");
const form  = document.getElementById("inspectorForm");
const btnClose = document.getElementById("inspClose");
const btnApply = document.getElementById("inspApply");

let currentNodeId = null;

function open(){ modal.classList.remove("hidden"); btnClose.focus(); }
function close(){ modal.classList.add("hidden"); currentNodeId = null; form.innerHTML=""; }

btnClose.addEventListener("click",(e)=>{ e.preventDefault(); close(); });
modal.querySelector(".modal-backdrop").addEventListener("click", close);

window.addEventListener("gridflow:open-properties", (e)=>{
  const { nodeId } = e.detail || {};
  currentNodeId = nodeId;
  const g = getGraph();
  const n = g.nodes.find(x=>x.id===nodeId);
  if(!n){ return; }
  const def = getNodeDefinition(n.type) || {};
  const insp = (n.ui?.inspector || def.inspector || []);
  form.innerHTML = "";
  // Title edit
  const tWrap = document.createElement("label");
  tWrap.textContent = "Title";
  const tInput = document.createElement("input");
  tInput.value = n.title || "";
  tWrap.appendChild(tInput);
  form.appendChild(tWrap);

  for(const f of insp){
    const lab = document.createElement("label");
    lab.textContent = f.label || f.key;
    let field;
    switch(f.type){
      case "number": field = document.createElement("input"); field.type="number"; field.value = n.state?.[f.key] ?? ""; break;
      case "select":
        field = document.createElement("select");
        (f.options||[]).forEach(opt=>{
          const o = document.createElement("option");
          o.value = String(opt?.value ?? opt); o.textContent = String(opt?.label ?? opt);
          if(String(n.state?.[f.key])===o.value) o.selected = true;
          field.appendChild(o);
        });
        break;
      case "toggle":
        field = document.createElement("input"); field.type="checkbox"; field.checked = !!n.state?.[f.key]; break;
      case "code":
      case "json":
        field = document.createElement("textarea"); field.rows = 6; field.value = n.state?.[f.key] ?? ""; break;
      default:
        field = document.createElement("input"); field.type="text"; field.value = n.state?.[f.key] ?? "";
    }
    field.dataset.key = f.key;
    lab.appendChild(field);
    form.appendChild(lab);
  }
  open();
});

btnApply.addEventListener("click",(e)=>{
  e.preventDefault();
  if(!currentNodeId) return close();
  const fields = [...form.querySelectorAll("[data-key]")];
  const title = form.querySelector("label:first-child input")?.value ?? "";
  transact(g=>{
    const n = g.nodes.find(x=>x.id===currentNodeId);
    if(!n) return;
    n.title = title;
    n.state = n.state || {};
    for(const el of fields){
      const key = el.dataset.key;
      if(el.type==="checkbox") n.state[key] = el.checked;
      else if(el.tagName==="TEXTAREA"){
        if(el.dataset.keyType==="json"){
          try{ n.state[key] = JSON.parse(el.value); }catch{ n.state[key] = el.value; }
        }else n.state[key] = el.value;
      }else if(el.type==="number") n.state[key] = Number(el.value);
      else n.state[key] = el.value;
    }
  }, "Update properties");
  close();
});
