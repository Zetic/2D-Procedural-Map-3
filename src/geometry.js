const EPS = 1e-7;

export function aabb(minX, minY, maxX, maxY) {
  return { minX, minY, maxX, maxY };
}

export function aabbIntersects(a, b) {
  return !(a.maxX < b.minX || a.minX > b.maxX || a.maxY < b.minY || a.minY > b.maxY);
}

export function expandAabb(b, amount) {
  return { minX: b.minX - amount, minY: b.minY - amount, maxX: b.maxX + amount, maxY: b.maxY + amount };
}

export function obb(x, y, w, h, angle, meta = {}) {
  const value = { x, y, w, h, angle, ...meta };
  value.corners = obbCorners(value);
  value.aabb = cornersAabb(value.corners);
  return value;
}

export function localToWorld(box, lx, ly) {
  const c = Math.cos(box.angle);
  const s = Math.sin(box.angle);
  return {
    x: box.x + lx * c - ly * s,
    y: box.y + lx * s + ly * c,
  };
}

export function obbCorners(box) {
  const hw = box.w / 2;
  const hh = box.h / 2;
  return [
    localToWorld(box, -hw, -hh),
    localToWorld(box, hw, -hh),
    localToWorld(box, hw, hh),
    localToWorld(box, -hw, hh),
  ];
}

export function cornersAabb(points) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { minX, minY, maxX, maxY };
}

function axesFor(box) {
  const c = Math.cos(box.angle);
  const s = Math.sin(box.angle);
  return [
    { x: c, y: s },
    { x: -s, y: c },
  ];
}

function projectedRadius(box, axis) {
  const axes = axesFor(box);
  return Math.abs(axis.x * axes[0].x + axis.y * axes[0].y) * box.w / 2 +
    Math.abs(axis.x * axes[1].x + axis.y * axes[1].y) * box.h / 2;
}

export function obbOverlapStrict(a, b, clearance = 0) {
  if (!aabbIntersects(
    { minX: a.aabb.minX - clearance, minY: a.aabb.minY - clearance, maxX: a.aabb.maxX + clearance, maxY: a.aabb.maxY + clearance },
    b.aabb,
  )) return false;

  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const axes = [...axesFor(a), ...axesFor(b)];
  for (const axis of axes) {
    const distance = Math.abs(dx * axis.x + dy * axis.y);
    const limit = projectedRadius(a, axis) + projectedRadius(b, axis) + clearance;
    if (distance >= limit - EPS) return false;
  }
  return true;
}

export function pointSegmentDistance(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const d2 = dx * dx + dy * dy;
  if (d2 <= EPS) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / d2));
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}

export function rectsOverlapLocal(a, b) {
  return a.x < b.x + b.w - EPS && a.x + a.w > b.x + EPS &&
    a.y < b.y + b.h - EPS && a.y + a.h > b.y + EPS;
}

export function polygonPath(ctx, points) {
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i += 1) ctx.lineTo(points[i].x, points[i].y);
  ctx.closePath();
}
