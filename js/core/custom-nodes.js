// js/core/custom-nodes.js
export async function loadCustomNodePacks() {
  try {
    const res = await fetch("custom-nodes/index.json");
    const packs = await res.json();
    window.gridflowCustomNodes = packs;
    console.log(`[GridFlow] Loaded ${packs.length} custom node pack(s).`);
  } catch (e) {
    console.warn("[GridFlow] No custom node packs found.");
    window.gridflowCustomNodes = [];
  }
}