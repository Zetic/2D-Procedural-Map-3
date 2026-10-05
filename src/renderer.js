import { PALETTES } from "./world.js";

const BG = "#4b4b4b";

function appendPolygon(ctx, poly) {
  if (!poly?.length) return;
  ctx.moveTo(poly[0].x, poly[0].y);
  for (let i = 1; i < poly.length; i += 1) ctx.lineTo(poly[i].x, poly[i].y);
  ctx.closePath();
}

function worldBounds(canvas, camera) {
  const halfW = canvas.clientWidth / (2 * camera.scale);
  const halfH = canvas.clientHeight / (2 * camera.scale);
  return {
    minX: camera.x - halfW,
    maxX: camera.x + halfW,
    minY: camera.y - halfH,
    maxY: camera.y + halfH,
  };
}

export class MapRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.debug = { portals: false, districts: false, ids: false };
  }

  resize() {
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    const width = Math.max(1, Math.floor(this.canvas.clientWidth * ratio));
    const height = Math.max(1, Math.floor(this.canvas.clientHeight * ratio));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    return ratio;
  }

  getBounds(camera) { return worldBounds(this.canvas, camera); }

  render(data, camera) {
    const ratio = this.resize();
    const ctx = this.ctx;
    const cssW = this.canvas.clientWidth;
    const cssH = this.canvas.clientHeight;

    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, cssW, cssH);

    ctx.save();
    ctx.translate(cssW / 2, cssH / 2);
    ctx.scale(camera.scale, camera.scale);
    ctx.translate(-camera.x, -camera.y);

    // Fill all cells of a palette in one path. Shared partition edges therefore
    // do not produce raster hairlines, and room identity remains a wall concern.
    for (let palette = 0; palette < PALETTES.length; palette += 1) {
      const cells = data.cells.filter((cell) => cell.palette === palette);
      if (!cells.length) continue;
      ctx.beginPath();
      for (const cell of cells) appendPolygon(ctx, cell.poly);
      ctx.fillStyle = PALETTES[palette].floor;
      ctx.fill();
    }

    // Semantic room walls. There is no route/corridor rendering layer.
    ctx.lineCap = "butt";
    ctx.lineJoin = "miter";
    for (let palette = 0; palette < PALETTES.length; palette += 1) {
      const walls = data.walls.filter((wall) => wall.palette === palette);
      if (!walls.length) continue;
      ctx.beginPath();
      for (const wall of walls) {
        ctx.moveTo(wall.p1.x, wall.p1.y);
        ctx.lineTo(wall.p2.x, wall.p2.y);
      }
      ctx.strokeStyle = PALETTES[palette].wall;
      ctx.lineWidth = Math.max(1.25 / camera.scale, 2.0);
      ctx.stroke();
    }

    if (this.debug.districts) {
      ctx.save();
      ctx.strokeStyle = "#75d5ff";
      ctx.lineWidth = Math.max(1 / camera.scale, 1.2);
      ctx.setLineDash([18 / camera.scale, 12 / camera.scale]);
      for (const district of data.districts) {
        ctx.beginPath();
        appendPolygon(ctx, district.poly);
        ctx.stroke();
      }
      ctx.restore();
    }

    if (this.debug.portals) {
      ctx.save();
      ctx.strokeStyle = "#ff6f61";
      ctx.fillStyle = "#ff6f61";
      ctx.lineWidth = Math.max(3 / camera.scale, 4);
      for (const portal of data.portals) {
        ctx.beginPath();
        ctx.moveTo(portal.p1.x, portal.p1.y);
        ctx.lineTo(portal.p2.x, portal.p2.y);
        ctx.stroke();
        const r = Math.max(3 / camera.scale, 4);
        ctx.beginPath();
        ctx.arc(portal.center.x, portal.center.y, r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    if (this.debug.ids && camera.scale > 0.11) {
      ctx.save();
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = `${Math.max(10 / camera.scale, 13)}px ui-monospace, monospace`;
      ctx.fillStyle = "rgba(25,25,25,.75)";
      for (const district of data.districts) {
        ctx.fillText(`${district.mx},${district.my} · ${district.profile.id}`, district.centroid.x, district.centroid.y);
      }
      ctx.restore();
    }

    ctx.restore();
  }

  exportPng(filename = "procedural-map.png") {
    const link = document.createElement("a");
    link.download = filename;
    link.href = this.canvas.toDataURL("image/png");
    link.click();
  }
}
