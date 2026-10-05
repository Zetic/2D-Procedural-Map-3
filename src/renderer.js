import { localToWorld, polygonPath } from "./geometry.js";
import { PALETTES } from "./world.js";

const BG = "#4b4b4b";

function strokeSegment(ctx, a, b, gapCenter = null, gapWidth = 0) {
  if (gapCenter === null || gapWidth <= 0) {
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    return;
  }

  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len <= 1e-6) return;
  const halfT = Math.min(0.45, gapWidth / (2 * len));
  const t0 = Math.max(0, gapCenter - halfT);
  const t1 = Math.min(1, gapCenter + halfT);

  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(a.x + dx * t0, a.y + dy * t0);
  ctx.moveTo(a.x + dx * t1, a.y + dy * t1);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
}

function drawRouteShape(ctx, shape, scale) {
  const palette = PALETTES[shape.palette % PALETTES.length];
  polygonPath(ctx, shape.corners);
  ctx.fillStyle = palette.route;
  ctx.fill();
  ctx.strokeStyle = palette.wall;
  ctx.lineWidth = Math.max(1.2 / scale, 1.6);
  ctx.globalAlpha = 0.82;
  ctx.stroke();
  ctx.globalAlpha = 1;
}

function drawLotFloor(ctx, lot) {
  const palette = PALETTES[lot.palette % PALETTES.length];
  polygonPath(ctx, lot.corners);
  ctx.fillStyle = palette.floor;
  ctx.fill();
}

function drawLotWalls(ctx, lot, scale) {
  const palette = PALETTES[lot.palette % PALETTES.length];
  ctx.strokeStyle = palette.wall;
  ctx.lineWidth = Math.max(1.3 / scale, 1.8);
  ctx.lineCap = "butt";

  const hw = lot.w / 2;
  const hh = lot.h / 2;
  const localCorners = [
    [-hw, -hh],
    [hw, -hh],
    [hw, hh],
    [-hw, hh],
  ];
  const corners = localCorners.map(([x, y]) => localToWorld(lot, x, y));

  // doorSide -1 means the wall nearest the parent route is local -Y.
  const doorEdge = lot.doorSide < 0 ? 0 : 2;
  for (let i = 0; i < 4; i += 1) {
    const a = corners[i];
    const b = corners[(i + 1) % 4];
    if (i === doorEdge) strokeSegment(ctx, a, b, 0.5, lot.outerDoorWidth);
    else strokeSegment(ctx, a, b);
  }

  for (const wall of lot.walls) {
    const a = localToWorld(lot, wall.x1, wall.y1);
    const b = localToWorld(lot, wall.x2, wall.y2);
    const length = Math.hypot(wall.x2 - wall.x1, wall.y2 - wall.y1);
    const gapT = wall.gapT;
    const gapWidth = Math.min(wall.gapWidth, length * 0.52);
    strokeSegment(ctx, a, b, gapT, gapWidth);
  }
}

function drawRoomTone(ctx, lot, room) {
  const p0 = localToWorld(lot, room.x, room.y);
  const p1 = localToWorld(lot, room.x + room.w, room.y);
  const p2 = localToWorld(lot, room.x + room.w, room.y + room.h);
  const p3 = localToWorld(lot, room.x, room.y + room.h);
  ctx.save();
  ctx.globalAlpha = room.colorShift < 0.5 ? 0.028 : 0.016;
  ctx.fillStyle = room.colorShift < 0.5 ? "#000000" : "#ffffff";
  polygonPath(ctx, [p0, p1, p2, p3]);
  ctx.fill();
  ctx.restore();
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
    this.debug = { routes: false, lots: false, ids: false };
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

  getBounds(camera) {
    return worldBounds(this.canvas, camera);
  }

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

    for (const route of data.routes) drawRouteShape(ctx, route, camera.scale);

    for (const lot of data.lots) {
      drawLotFloor(ctx, lot);
      for (const room of lot.rooms) drawRoomTone(ctx, lot, room);
    }

    for (const lot of data.lots) drawLotWalls(ctx, lot, camera.scale);

    if (this.debug.routes) {
      ctx.save();
      ctx.strokeStyle = "#ff6f61";
      ctx.fillStyle = "#ff8a7e";
      ctx.lineWidth = Math.max(1.1 / camera.scale, 1.2);
      ctx.setLineDash([18 / camera.scale, 12 / camera.scale]);
      for (const edge of data.edges) {
        ctx.beginPath();
        ctx.moveTo(edge.points[0].x, edge.points[0].y);
        for (let i = 1; i < edge.points.length; i += 1) ctx.lineTo(edge.points[i].x, edge.points[i].y);
        ctx.stroke();
      }
      ctx.restore();
    }

    if (this.debug.lots) {
      ctx.save();
      ctx.strokeStyle = "#75d5ff";
      ctx.lineWidth = Math.max(1 / camera.scale, 1);
      ctx.setLineDash([12 / camera.scale, 8 / camera.scale]);
      for (const lot of data.lots) {
        polygonPath(ctx, lot.corners);
        ctx.stroke();
      }
      ctx.restore();
    }

    if (this.debug.ids && camera.scale > 0.18) {
      ctx.save();
      ctx.fillStyle = "#333";
      ctx.font = `${Math.max(9 / camera.scale, 12)}px ui-monospace, monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      for (const lot of data.lots) {
        ctx.fillText(lot.profile.id, lot.x, lot.y);
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
