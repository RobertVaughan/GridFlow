// Minimap: simple overview of nodes
import { subscribe, getGraph } from "../core/store.js";

const el = document.getElementById("minimap");
const cvs = document.createElement("canvas");
cvs.width = 180; cvs.height = 120;
el.appendChild(cvs);
const ctx = cvs.getContext("2d");

function draw(){
  const g = getGraph();
  ctx.clearRect(0,0,cvs.width,cvs.height);
  ctx.fillStyle = "#0b0d13"; ctx.fillRect(0,0,cvs.width,cvs.height);
  ctx.strokeStyle = "#334155"; ctx.strokeRect(0,0,cvs.width,cvs.height);
  // Coarse fit: assume world extents
  const xs = g.nodes.map(n=>n.x), ys = g.nodes.map(n=>n.y);
  const minX = Math.min(0, ...xs), minY = Math.min(0, ...ys);
  const maxX = Math.max(800, ...xs.map((x,i)=>x+(g.nodes[i]?.width||180)));
  const maxY = Math.max(600, ...ys.map((y)=>y+100));
  const sx = cvs.width/(maxX-minX+1), sy = cvs.height/(maxY-minY+1);
  for(const n of g.nodes){
    const x = (n.x - minX) * sx, y = (n.y - minY) * sy;
    ctx.fillStyle = "#7dd3fc";
    ctx.fillRect(x, y, (n.width||180)*sx, 60*sy);
  }
}
subscribe(draw); draw();
