import { registerSandboxNode, listOptionResolvers, toast } from "../core/plugins.js";
import { addNode } from "../core/store.js";

const elType = document.getElementById("nbType");
const elTitle = document.getElementById("nbTitle");
const elInputs = document.getElementById("nbInputs");
const elOutputs = document.getElementById("nbOutputs");
const elInspector = document.getElementById("nbInspector");
const elCode = document.getElementById("nbCode");
const btnRegister = document.getElementById("nbRegister");
const btnSpawn = document.getElementById("nbSpawn");

btnRegister.addEventListener("click", () => {
  try{
    const def = {
      type: elType.value.trim(),
      title: elTitle.value.trim(),
      inputs: JSON.parse(elInputs.value || "[]"),
      outputs: JSON.parse(elOutputs.value || "[]"),
      inspector: JSON.parse(elInspector.value || "[]"),
      // The code becomes the return body of async function run(ctx) { <code>; }
      code: elCode.value
    };
    if(!def.type || !def.title) throw new Error("Type and Title required");
    registerSandboxNode(def);
    toast(`Registered ${def.type}`, "ok");
  }catch(e){ alert("Invalid definition: " + e.message); }
});

btnSpawn.addEventListener("click", () => {
  const type = elType.value.trim();
  if(!type) return;
  addNode({
    id: crypto.randomUUID(),
    type,
    title: elTitle.value.trim() || type,
    x: 80 + Math.random()*120, y: 80 + Math.random()*120,
    inputs: JSON.parse(elInputs.value || "[]"),
    outputs: JSON.parse(elOutputs.value || "[]"),
    state: {},
  });
});