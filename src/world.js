import { chance, hashParts, hashString, rand01, randInt, randRange, signed } from "./prng.js";

export const GENERATOR_VERSION = 2;
export const DISTRICT_SIZE = 1050;
export const DISTRICT_JITTER = 0.065;
export const QUERY_MARGIN = DISTRICT_SIZE * 0.22;

const EPS = 1e-7;
const WALL_EPS = 1e-5;

export const PALETTES = [
  { floor: "#ead5a6", wall: "#877451" },
  { floor: "#e4c98f", wall: "#806b49" },
  { floor: "#e9d1b3", wall: "#88715f" },
  { floor: "#ddb19f", wall: "#7e5d54" },
  { floor: "#b7c4cf", wall: "#62717d" },
  { floor: "#bdca9d", wall: "#697451" },
  { floor: "#d9b985", wall: "#7d6545" },
];

const PROFILES = [
  { id: "office", cells: [48, 62], density: 0.64, merge: 0.38, maxMerge: 4, loops: 0.24, door: [20, 38], lobes: [2, 4] },
  { id: "service", cells: [42, 58], density: 0.54, merge: 0.28, maxMerge: 3, loops: 0.18, door: [16, 30], lobes: [2, 4] },
  { id: "institutional", cells: [36, 50], density: 0.61, merge: 0.46, maxMerge: 5, loops: 0.22, door: [22, 42], lobes: [2, 3] },
  { id: "liminal", cells: [26, 38], density: 0.46, merge: 0.62, maxMerge: 7, loops: 0.15, door: [26, 52], lobes: [1, 3] },
  { id: "archive", cells: [54, 70], density: 0.68, merge: 0.22, maxMerge: 3, loops: 0.28, door: [16, 28], lobes: [2, 4] },
  { id: "flooded", cells: [32, 46], density: 0.54, merge: 0.54, maxMerge: 6, loops: 0.22, door: [24, 46], lobes: [1, 3] },
  { id: "overgrown", cells: [38, 54], density: 0.57, merge: 0.48, maxMerge: 5, loops: 0.27, door: [22, 44], lobes: [2, 4] },
];

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function key2(x, y) { return x + "," + y; }
function canonicalPair(ax, ay, bx, by) {
  const a = key2(ax, ay), b = key2(bx, by);
  return a < b ? a + "|" + b : b + "|" + a;
}
function sign(v) { return v < 0 ? -1 : v > 0 ? 1 : 0; }
function dist2(a, b) { const dx = a.x - b.x, dy = a.y - b.y; return dx * dx + dy * dy; }

function polygonAreaSigned(poly) {
  let sum = 0;
  for (let i = 0; i < poly.length; i += 1) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return sum * 0.5;
}
export function polygonArea(poly) { return Math.abs(polygonAreaSigned(poly)); }

function ensureCcw(poly) {
  return polygonAreaSigned(poly) < 0 ? [...poly].reverse() : poly;
}

function polygonCentroid(poly) {
  const signed = polygonAreaSigned(poly);
  if (Math.abs(signed) < EPS) {
    const x = poly.reduce((s, p) => s + p.x, 0) / Math.max(1, poly.length);
    const y = poly.reduce((s, p) => s + p.y, 0) / Math.max(1, poly.length);
    return { x, y };
  }
  let cx = 0, cy = 0;
  for (let i = 0; i < poly.length; i += 1) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const cross = a.x * b.y - b.x * a.y;
    cx += (a.x + b.x) * cross;
    cy += (a.y + b.y) * cross;
  }
  const factor = 1 / (6 * signed);
  return { x: cx * factor, y: cy * factor };
}

function polygonBounds(poly) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of poly) {
    minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
  }
  return { minX, minY, maxX, maxY };
}

function boundsIntersect(a, b) {
  return !(a.maxX < b.minX || a.minX > b.maxX || a.maxY < b.minY || a.minY > b.maxY);
}

function dedupePolygon(poly) {
  const out = [];
  for (const p of poly) {
    const prev = out[out.length - 1];
    if (!prev || Math.hypot(prev.x - p.x, prev.y - p.y) > 1e-6) out.push(p);
  }
  if (out.length > 2 && Math.hypot(out[0].x - out[out.length - 1].x, out[0].y - out[out.length - 1].y) < 1e-6) out.pop();
  return out;
}

function clipHalfPlane(poly, nx, ny, c, keepLess) {
  if (!poly.length) return [];
  const out = [];
  const inside = (p) => keepLess ? nx * p.x + ny * p.y <= c + EPS : nx * p.x + ny * p.y >= c - EPS;
  for (let i = 0; i < poly.length; i += 1) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const ia = inside(a), ib = inside(b);
    const da = nx * a.x + ny * a.y - c;
    const db = nx * b.x + ny * b.y - c;
    if (ia) out.push(a);
    if (ia !== ib) {
      const denom = da - db;
      if (Math.abs(denom) > EPS) {
        const t = da / denom;
        out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      }
    }
  }
  return dedupePolygon(out);
}

function splitPolygon(poly, nx, ny, c) {
  return [clipHalfPlane(poly, nx, ny, c, true), clipHalfPlane(poly, nx, ny, c, false)];
}

function pointInConvex(poly, point) {
  let last = 0;
  for (let i = 0; i < poly.length; i += 1) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const cross = (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x);
    if (Math.abs(cross) < 1e-5) continue;
    const s = Math.sign(cross);
    if (last && s !== last) return false;
    last = s;
  }
  return true;
}

function pointLineDistance(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < EPS) return Math.hypot(p.x - a.x, p.y - a.y);
  return Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / len;
}

function sharedSegment(a1, a2, b1, b2) {
  const adx = a2.x - a1.x, ady = a2.y - a1.y;
  const alen = Math.hypot(adx, ady);
  if (alen < EPS) return null;
  if (pointLineDistance(b1, a1, a2) > WALL_EPS || pointLineDistance(b2, a1, a2) > WALL_EPS) return null;

  const ux = adx / alen, uy = ady / alen;
  const proj = (p) => (p.x - a1.x) * ux + (p.y - a1.y) * uy;
  const b0 = proj(b1), b1p = proj(b2);
  const lo = Math.max(0, Math.min(b0, b1p));
  const hi = Math.min(alen, Math.max(b0, b1p));
  if (hi - lo <= 1e-5) return null;
  return {
    p1: { x: a1.x + ux * lo, y: a1.y + uy * lo },
    p2: { x: a1.x + ux * hi, y: a1.y + uy * hi },
    length: hi - lo,
  };
}

function longestSharedBoundary(polyA, polyB) {
  let best = null;
  for (let i = 0; i < polyA.length; i += 1) {
    const a1 = polyA[i], a2 = polyA[(i + 1) % polyA.length];
    for (let j = 0; j < polyB.length; j += 1) {
      const b1 = polyB[j], b2 = polyB[(j + 1) % polyB.length];
      const overlap = sharedSegment(a1, a2, b1, b2);
      if (overlap && (!best || overlap.length > best.length)) best = overlap;
    }
  }
  return best;
}

function clipConvex(subject, clipper) {
  let out = ensureCcw(subject);
  const clip = ensureCcw(clipper);
  for (let i = 0; i < clip.length && out.length; i += 1) {
    const a = clip[i], b = clip[(i + 1) % clip.length];
    const dx = b.x - a.x, dy = b.y - a.y;
    // CCW polygon interior lies left of every directed edge: dy*x - dx*y <= dy*a.x - dx*a.y
    const nx = dy, ny = -dx, c = nx * a.x + ny * a.y;
    out = clipHalfPlane(out, nx, ny, c, true);
  }
  return out;
}

export function convexIntersectionArea(a, b) {
  const clipped = clipConvex(a, b);
  return clipped.length >= 3 ? polygonArea(clipped) : 0;
}

function warpedVertex(seed, vx, vy) {
  const jitter = DISTRICT_SIZE * DISTRICT_JITTER;
  return {
    x: vx * DISTRICT_SIZE + signed(jitter, seed, "vertex-x", vx, vy),
    y: vy * DISTRICT_SIZE + signed(jitter, seed, "vertex-y", vx, vy),
  };
}

function districtPolygon(seed, mx, my) {
  return ensureCcw([
    warpedVertex(seed, mx, my),
    warpedVertex(seed, mx + 1, my),
    warpedVertex(seed, mx + 1, my + 1),
    warpedVertex(seed, mx, my + 1),
  ]);
}

function districtBoundaryEdges(seed, mx, my) {
  const p = districtPolygon(seed, mx, my);
  return {
    top: [p[0], p[1]],
    right: [p[1], p[2]],
    bottom: [p[2], p[3]],
    left: [p[3], p[0]],
  };
}

function profileFor(seed, mx, my) {
  const zx = Math.floor(mx / 2), zy = Math.floor(my / 2);
  let index = randInt(0, PROFILES.length - 1, seed, "profile-zone", zx, zy);
  if (chance(0.18, seed, "profile-mutation", mx, my)) index = randInt(0, PROFILES.length - 1, seed, "profile", mx, my);
  return PROFILES[index];
}

function paletteFor(seed, mx, my) {
  const zx = Math.floor(mx / 3), zy = Math.floor(my / 3);
  const rare = rand01(seed, "palette-zone-rare", zx, zy);
  if (rare < 0.82) return randInt(0, 2, seed, "palette-zone-common", zx, zy);
  return randInt(3, PALETTES.length - 1, seed, "palette-zone-color", zx, zy);
}

function parentFor(seed, mx, my) {
  if (mx === 0 && my === 0) return null;
  if (mx === 0) return [0, my - sign(my)];
  if (my === 0) return [mx - sign(mx), 0];
  const ax = Math.abs(mx), ay = Math.abs(my);
  if (ax > ay) return [mx - sign(mx), my];
  if (ay > ax) return [mx, my - sign(my)];
  return chance(0.5, seed, "parent-axis", mx, my) ? [mx - sign(mx), my] : [mx, my - sign(my)];
}

export function parentCell(seedText, mx, my) {
  const seed = hashString("v" + GENERATOR_VERSION + ":" + String(seedText));
  return parentFor(seed, mx, my);
}

function isParentLink(seed, ax, ay, bx, by) {
  const pa = parentFor(seed, ax, ay);
  if (pa && pa[0] === bx && pa[1] === by) return true;
  const pb = parentFor(seed, bx, by);
  return Boolean(pb && pb[0] === ax && pb[1] === ay);
}

function activeEdge(seed, ax, ay, bx, by) {
  if (Math.abs(ax - bx) + Math.abs(ay - by) !== 1) return false;
  if (isParentLink(seed, ax, ay, bx, by)) return true;
  return chance(0.09, seed, "optional-edge", canonicalPair(ax, ay, bx, by));
}

function canonicalBoundary(seed, ax, ay, bx, by) {
  if (ay === by) {
    const gx = Math.max(ax, bx), gy = ay;
    return [warpedVertex(seed, gx, gy), warpedVertex(seed, gx, gy + 1)];
  }
  const gx = ax, gy = Math.max(ay, by);
  return [warpedVertex(seed, gx, gy), warpedVertex(seed, gx + 1, gy)];
}

function portalFor(seed, ax, ay, bx, by) {
  const pair = canonicalPair(ax, ay, bx, by);
  const [a, b] = canonicalBoundary(seed, ax, ay, bx, by);
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  const width = Math.min(randRange(34, 70, seed, "portal-width", pair), length * 0.16);
  const halfT = width / (2 * length);
  const t = clamp(randRange(0.24, 0.84, seed, "portal-position", pair), halfT + 0.04, 1 - halfT - 0.04);
  const interp = (tt) => ({ x: a.x + (b.x - a.x) * tt, y: a.y + (b.y - a.y) * tt });
  return {
    id: "portal:" + pair,
    pair,
    neighbor: ax === bx ? [bx, by] : [bx, by],
    center: interp(t),
    p1: interp(t - halfT),
    p2: interp(t + halfT),
    width,
  };
}

function incidentPortals(seed, mx, my) {
  const out = [];
  const dirs = [[1,0],[0,1],[-1,0],[0,-1]];
  for (const [dx, dy] of dirs) {
    const nx = mx + dx, ny = my + dy;
    if (!activeEdge(seed, mx, my, nx, ny)) continue;
    out.push({ ...portalFor(seed, mx, my, nx, ny), nx, ny, required: isParentLink(seed, mx, my, nx, ny) });
  }
  out.sort((a, b) => a.id.localeCompare(b.id));
  return out;
}

function minProjectionSpan(poly) {
  const b = polygonBounds(poly);
  return Math.min(b.maxX - b.minX, b.maxY - b.minY);
}

function subdivideDistrict(seed, districtId, polygon, profile) {
  const target = randInt(profile.cells[0], profile.cells[1], seed, districtId, "cell-count");
  const districtArea = polygonArea(polygon);
  const minArea = districtArea / (target * 3.1);
  const top = { x: polygon[1].x - polygon[0].x, y: polygon[1].y - polygon[0].y };
  const baseAngle = Math.atan2(top.y, top.x) + signed(0.14, seed, districtId, "orientation");
  const leaves = [{ id: districtId + ":cell:0", poly: polygon }];
  let serial = 1;
  let guard = 0;

  while (leaves.length < target && guard++ < target * 10) {
    let pickIndex = -1;
    let best = -Infinity;
    for (let i = 0; i < leaves.length; i += 1) {
      const area = polygonArea(leaves[i].poly);
      if (area < minArea * 2.15) continue;
      const score = area * (0.94 + rand01(seed, districtId, "pick", guard, leaves[i].id) * 0.12);
      if (score > best) { best = score; pickIndex = i; }
    }
    if (pickIndex < 0) break;

    const leaf = leaves[pickIndex];
    let split = null;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const mode = randInt(0, 99, seed, districtId, leaf.id, "split-mode", attempt);
      let wallAngle;
      if (mode < 47) wallAngle = baseAngle;
      else if (mode < 94) wallAngle = baseAngle + Math.PI / 2;
      else if (mode < 97) wallAngle = baseAngle + Math.PI / 4;
      else wallAngle = baseAngle - Math.PI / 4;
      wallAngle += signed(mode < 94 ? 0.035 : 0.07, seed, districtId, leaf.id, "split-jitter", attempt);
      const nx = -Math.sin(wallAngle), ny = Math.cos(wallAngle);
      let lo = Infinity, hi = -Infinity;
      for (const p of leaf.poly) {
        const d = nx * p.x + ny * p.y;
        lo = Math.min(lo, d); hi = Math.max(hi, d);
      }
      const ratio = randRange(0.39, 0.61, seed, districtId, leaf.id, "split-ratio", attempt);
      const c = lo + (hi - lo) * ratio;
      const [a, b] = splitPolygon(leaf.poly, nx, ny, c);
      if (a.length < 3 || b.length < 3) continue;
      const aa = polygonArea(a), ba = polygonArea(b);
      if (aa < minArea || ba < minArea) continue;
      if (minProjectionSpan(a) < 34 || minProjectionSpan(b) < 34) continue;
      split = [ensureCcw(a), ensureCcw(b)];
      break;
    }

    if (!split) {
      // Mark this leaf effectively unsplittable by reducing its selection area.
      leaf.locked = true;
      if (leaves.every((x) => x.locked || polygonArea(x.poly) < minArea * 2.15)) break;
      continue;
    }

    leaves.splice(pickIndex, 1,
      { id: districtId + ":cell:" + serial++, poly: split[0] },
      { id: districtId + ":cell:" + serial++, poly: split[1] },
    );
  }

  return leaves.map((leaf, index) => ({
    ...leaf,
    index,
    area: polygonArea(leaf.poly),
    centroid: polygonCentroid(leaf.poly),
    bounds: polygonBounds(leaf.poly),
  }));
}

function buildAdjacency(cells) {
  const edges = [];
  const neighbors = Array.from({ length: cells.length }, () => []);
  for (let i = 0; i < cells.length; i += 1) {
    for (let j = i + 1; j < cells.length; j += 1) {
      if (!boundsIntersect(cells[i].bounds, cells[j].bounds)) continue;
      const shared = longestSharedBoundary(cells[i].poly, cells[j].poly);
      if (!shared || shared.length < 1e-4) continue;
      const edge = {
        id: cells[i].id < cells[j].id ? cells[i].id + "|" + cells[j].id : cells[j].id + "|" + cells[i].id,
        a: i,
        b: j,
        p1: shared.p1,
        p2: shared.p2,
        length: shared.length,
      };
      const index = edges.length;
      edges.push(edge);
      neighbors[i].push({ cell: j, edge: index });
      neighbors[j].push({ cell: i, edge: index });
    }
  }
  return { edges, neighbors };
}

function boundaryEdgeOverlap(cell, districtPoly) {
  const out = [];
  for (let i = 0; i < cell.poly.length; i += 1) {
    const a1 = cell.poly[i], a2 = cell.poly[(i + 1) % cell.poly.length];
    for (let j = 0; j < districtPoly.length; j += 1) {
      const b1 = districtPoly[j], b2 = districtPoly[(j + 1) % districtPoly.length];
      const overlap = sharedSegment(a1, a2, b1, b2);
      if (overlap) out.push({ ...overlap, cellEdge: i, districtEdge: j });
    }
  }
  return out;
}

function portalCells(cells, portals) {
  const map = new Map();
  for (const portal of portals) {
    const hits = [];
    for (const cell of cells) {
      let matched = false;
      for (let i = 0; i < cell.poly.length && !matched; i += 1) {
        const a = cell.poly[i], b = cell.poly[(i + 1) % cell.poly.length];
        const overlap = sharedSegment(a, b, portal.p1, portal.p2);
        if (overlap && overlap.length > 0.5) matched = true;
      }
      if (matched) hits.push(cell.index);
    }
    if (!hits.length) {
      // Numerical fallback: pick the polygon containing the portal center, then nearest centroid.
      let index = cells.findIndex((cell) => pointInConvex(cell.poly, portal.center));
      if (index < 0) {
        let best = Infinity;
        for (const cell of cells) {
          const d = dist2(cell.centroid, portal.center);
          if (d < best) { best = d; index = cell.index; }
        }
      }
      hits.push(index);
    }
    map.set(portal.id, [...new Set(hits)]);
  }
  return map;
}

function shortestPath(seed, districtId, cells, neighbors, source, target) {
  if (source === target) return [source];
  const n = cells.length;
  const dist = new Array(n).fill(Infinity);
  const prev = new Array(n).fill(-1);
  const used = new Array(n).fill(false);
  dist[source] = 0;

  for (let step = 0; step < n; step += 1) {
    let u = -1, best = Infinity;
    for (let i = 0; i < n; i += 1) {
      if (!used[i] && dist[i] < best) { best = dist[i]; u = i; }
    }
    if (u < 0 || u === target) break;
    used[u] = true;
    for (const item of neighbors[u]) {
      const v = item.cell;
      const areaBias = 0.22 * (1 - clamp(cells[v].area / (DISTRICT_SIZE * DISTRICT_SIZE * 0.04), 0, 1));
      const jitter = rand01(seed, districtId, "path-cost", cells[u].id, cells[v].id) * 0.18;
      const nd = dist[u] + 1 + areaBias + jitter;
      if (nd < dist[v] - 1e-9) { dist[v] = nd; prev[v] = u; }
    }
  }

  if (!Number.isFinite(dist[target])) return [];
  const path = [];
  for (let cur = target; cur >= 0; cur = prev[cur]) {
    path.push(cur);
    if (cur === source) break;
  }
  return path.reverse();
}

function chooseLobeAnchors(seed, districtId, cells, boundarySet, count) {
  const candidates = cells
    .filter((cell) => !boundarySet.has(cell.index))
    .sort((a, b) => {
      const sa = rand01(seed, districtId, "lobe-rank", a.id) + clamp(a.area / 80000, 0, 0.35);
      const sb = rand01(seed, districtId, "lobe-rank", b.id) + clamp(b.area / 80000, 0, 0.35);
      return sb - sa || a.id.localeCompare(b.id);
    });
  const chosen = [];
  for (const candidate of candidates) {
    if (chosen.length >= count) break;
    if (chosen.every((other) => Math.hypot(candidate.centroid.x - other.centroid.x, candidate.centroid.y - other.centroid.y) > DISTRICT_SIZE * 0.22)) {
      chosen.push(candidate);
    }
  }
  return chosen.map((x) => x.index);
}

function chooseActiveCells(seed, districtId, cells, adjacency, profile, portals, portalMap, districtPoly) {
  const active = new Set();
  const forced = new Set();
  for (const ids of portalMap.values()) for (const id of ids) { active.add(id); forced.add(id); }

  const required = [...forced].sort((a, b) => cells[a].id.localeCompare(cells[b].id));
  const boundarySet = new Set();
  for (const cell of cells) if (boundaryEdgeOverlap(cell, districtPoly).length) boundarySet.add(cell.index);

  let root = required[0] ?? 0;
  active.add(root);
  for (const target of required.slice(1)) {
    for (const cell of shortestPath(seed, districtId, cells, adjacency.neighbors, root, target)) active.add(cell);
  }

  const lobeCount = randInt(profile.lobes[0], profile.lobes[1], seed, districtId, "lobe-count");
  for (const anchor of chooseLobeAnchors(seed, districtId, cells, boundarySet, lobeCount)) {
    for (const cell of shortestPath(seed, districtId, cells, adjacency.neighbors, root, anchor)) active.add(cell);
  }

  const density = clamp(profile.density + signed(0.11, seed, districtId, "density"), 0.34, 0.78);
  const targetCount = Math.max(active.size, Math.round(cells.length * density));

  while (active.size < targetCount) {
    let chosen = -1;
    let bestScore = Infinity;
    for (const cell of cells) {
      if (active.has(cell.index)) continue;
      let activeNeighbors = 0;
      for (const n of adjacency.neighbors[cell.index]) if (active.has(n.cell)) activeNeighbors += 1;
      if (!activeNeighbors) continue;
      const boundaryPenalty = boundarySet.has(cell.index) && !forced.has(cell.index) ? 1.4 : 0;
      const compactBonus = -0.19 * activeNeighbors;
      const score = rand01(seed, districtId, "growth", cell.id) + boundaryPenalty + compactBonus;
      if (score < bestScore) { bestScore = score; chosen = cell.index; }
    }
    if (chosen < 0) break;
    active.add(chosen);
  }

  return { active, forced, boundarySet, density };
}

class UnionFind {
  constructor(n) { this.parent = Array.from({ length: n }, (_, i) => i); this.size = new Array(n).fill(1); }
  find(x) { while (this.parent[x] !== x) { this.parent[x] = this.parent[this.parent[x]]; x = this.parent[x]; } return x; }
  union(a, b) {
    a = this.find(a); b = this.find(b); if (a === b) return a;
    if (this.size[a] < this.size[b]) [a, b] = [b, a];
    this.parent[b] = a; this.size[a] += this.size[b]; return a;
  }
}

function assignRooms(seed, districtId, cells, adjacency, active, profile, portalMap) {
  const uf = new UnionFind(cells.length);
  const areaByRoot = cells.map((cell) => cell.area);

  // A shared portal is one architectural opening, even if a partition vertex cuts through it.
  for (const ids of portalMap.values()) {
    const set = new Set(ids);
    for (const edge of adjacency.edges) {
      if (set.has(edge.a) && set.has(edge.b)) uf.union(edge.a, edge.b);
    }
  }

  const mergeEdges = adjacency.edges
    .filter((edge) => active.has(edge.a) && active.has(edge.b))
    .sort((a, b) => hashParts(seed, districtId, "merge-order", a.id) - hashParts(seed, districtId, "merge-order", b.id) || a.id.localeCompare(b.id));

  for (const edge of mergeEdges) {
    let ra = uf.find(edge.a), rb = uf.find(edge.b);
    if (ra === rb) continue;
    const combinedCount = uf.size[ra] + uf.size[rb];
    const combinedArea = (areaByRoot[ra] ?? cells[ra].area) + (areaByRoot[rb] ?? cells[rb].area);
    if (combinedCount > profile.maxMerge) continue;
    if (combinedArea > DISTRICT_SIZE * DISTRICT_SIZE * 0.105) continue;
    if (!chance(profile.merge, seed, districtId, "merge", edge.id)) continue;
    const root = uf.union(ra, rb);
    areaByRoot[root] = combinedArea;
  }

  const members = new Map();
  for (const cell of cells) {
    if (!active.has(cell.index)) continue;
    const root = uf.find(cell.index);
    if (!members.has(root)) members.set(root, []);
    members.get(root).push(cell.index);
  }

  const roots = [...members.keys()].sort((a, b) => cells[Math.min(...members.get(a))].id.localeCompare(cells[Math.min(...members.get(b))].id));
  const cellRoom = new Map();
  const rooms = roots.map((root, index) => {
    const ids = members.get(root).sort((a, b) => a - b);
    let area = 0, cx = 0, cy = 0;
    for (const ci of ids) { area += cells[ci].area; cx += cells[ci].centroid.x * cells[ci].area; cy += cells[ci].centroid.y * cells[ci].area; }
    const room = { id: districtId + ":room:" + index, cells: ids, area, centroid: { x: cx / area, y: cy / area } };
    for (const ci of ids) cellRoom.set(ci, room.id);
    return room;
  });

  return { rooms, cellRoom };
}

function roomDoorGraph(seed, districtId, cells, adjacency, active, roomData, profile) {
  const pairEdges = new Map();
  for (const edge of adjacency.edges) {
    if (!active.has(edge.a) || !active.has(edge.b)) continue;
    const ra = roomData.cellRoom.get(edge.a), rb = roomData.cellRoom.get(edge.b);
    if (!ra || !rb || ra === rb) continue;
    const pair = ra < rb ? ra + "|" + rb : rb + "|" + ra;
    if (!pairEdges.has(pair)) pairEdges.set(pair, []);
    pairEdges.get(pair).push(edge);
  }

  const roomIndex = new Map(roomData.rooms.map((room, i) => [room.id, i]));
  const uf = new UnionFind(roomData.rooms.length);
  const candidates = [];
  for (const [pair, edges] of pairEdges) {
    const [a, b] = pair.split("|");
    const ordered = [...edges].sort((x, y) => hashParts(seed, districtId, "door-segment", x.id) - hashParts(seed, districtId, "door-segment", y.id));
    candidates.push({ pair, a, b, edge: ordered[0], score: hashParts(seed, districtId, "door-tree", pair) });
  }
  candidates.sort((a, b) => a.score - b.score || a.pair.localeCompare(b.pair));

  const doors = new Map();
  for (const item of candidates) {
    const a = roomIndex.get(item.a), b = roomIndex.get(item.b);
    if (uf.find(a) === uf.find(b)) continue;
    uf.union(a, b);
    doors.set(item.pair, makeDoor(seed, districtId, item.pair, item.edge, profile));
  }

  for (const item of candidates) {
    if (doors.has(item.pair)) continue;
    if (chance(profile.loops, seed, districtId, "door-loop", item.pair)) {
      doors.set(item.pair, makeDoor(seed, districtId, item.pair, item.edge, profile));
    }
  }
  return doors;
}

function makeDoor(seed, districtId, pair, edge, profile) {
  const dx = edge.p2.x - edge.p1.x, dy = edge.p2.y - edge.p1.y;
  const length = Math.hypot(dx, dy);
  const width = Math.min(randRange(profile.door[0], profile.door[1], seed, districtId, "door-width", pair), length * 0.58);
  const t = clamp(randRange(0.38, 0.62, seed, districtId, "door-position", pair), width / (2 * length) + 0.03, 1 - width / (2 * length) - 0.03);
  const ux = dx / length, uy = dy / length;
  const cx = edge.p1.x + dx * t, cy = edge.p1.y + dy * t;
  return {
    id: districtId + ":door:" + pair,
    pair,
    p1: { x: cx - ux * width / 2, y: cy - uy * width / 2 },
    p2: { x: cx + ux * width / 2, y: cy + uy * width / 2 },
    center: { x: cx, y: cy }, width,
  };
}

function subtractCollinearGap(a, b, gapA, gapB) {
  const overlap = sharedSegment(a, b, gapA, gapB);
  if (!overlap) return [{ p1: a, p2: b }];
  const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy);
  const ux = dx / len, uy = dy / len;
  const t = (p) => (p.x - a.x) * ux + (p.y - a.y) * uy;
  let lo = Math.min(t(overlap.p1), t(overlap.p2)), hi = Math.max(t(overlap.p1), t(overlap.p2));
  lo = clamp(lo, 0, len); hi = clamp(hi, 0, len);
  const out = [];
  if (lo > 0.5) out.push({ p1: a, p2: { x: a.x + ux * lo, y: a.y + uy * lo } });
  if (len - hi > 0.5) out.push({ p1: { x: a.x + ux * hi, y: a.y + uy * hi }, p2: b });
  return out;
}

function buildWalls(cells, adjacency, active, roomData, doors, districtPoly, portals) {
  const walls = [];
  const doorList = [...doors.values()];
  const doorByPair = doors;

  for (const edge of adjacency.edges) {
    const aa = active.has(edge.a), bb = active.has(edge.b);
    if (!aa && !bb) continue;
    if (aa && bb) {
      const ra = roomData.cellRoom.get(edge.a), rb = roomData.cellRoom.get(edge.b);
      if (ra === rb) continue;
      const pair = ra < rb ? ra + "|" + rb : rb + "|" + ra;
      const door = doorByPair.get(pair);
      if (door) walls.push(...subtractCollinearGap(edge.p1, edge.p2, door.p1, door.p2));
      else walls.push({ p1: edge.p1, p2: edge.p2 });
    } else {
      walls.push({ p1: edge.p1, p2: edge.p2 });
    }
  }

  // District outer boundary. Only canonical portal intervals are opened.
  for (const cell of cells) {
    if (!active.has(cell.index)) continue;
    for (let i = 0; i < cell.poly.length; i += 1) {
      const a = cell.poly[i], b = cell.poly[(i + 1) % cell.poly.length];
      let outer = false;
      for (let j = 0; j < districtPoly.length; j += 1) {
        if (sharedSegment(a, b, districtPoly[j], districtPoly[(j + 1) % districtPoly.length])) { outer = true; break; }
      }
      if (!outer) continue;
      let pieces = [{ p1: a, p2: b }];
      for (const portal of portals) {
        const next = [];
        for (const piece of pieces) next.push(...subtractCollinearGap(piece.p1, piece.p2, portal.p1, portal.p2));
        pieces = next;
      }
      walls.push(...pieces);
    }
  }

  return { walls, doors: doorList };
}

function verifyRoomConnectivity(rooms, doors) {
  if (rooms.length <= 1) return true;
  const adj = new Map(rooms.map((r) => [r.id, []]));
  for (const door of doors) {
    const parts = door.pair.split("|");
    // room ids themselves contain ':' but not '|'
    const a = parts[0], b = parts[1];
    if (adj.has(a) && adj.has(b)) { adj.get(a).push(b); adj.get(b).push(a); }
  }
  const seen = new Set([rooms[0].id]);
  const queue = [rooms[0].id];
  while (queue.length) {
    const cur = queue.shift();
    for (const next of adj.get(cur) ?? []) if (!seen.has(next)) { seen.add(next); queue.push(next); }
  }
  return seen.size === rooms.length;
}

function stableDistrictSignature(district) {
  let h = 2166136261 >>> 0;
  const mix = (v) => { const s = String(v); for (let i = 0; i < s.length; i += 1) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } };
  mix(district.id); mix(district.profile.id); mix(district.palette);
  for (const cell of district.cells) {
    if (!cell.active) continue;
    mix(cell.id + ":" + cell.roomId + ":");
    for (const p of cell.poly) mix(p.x.toFixed(4) + "," + p.y.toFixed(4) + ";");
  }
  for (const wall of district.walls) mix(wall.p1.x.toFixed(3) + "," + wall.p1.y.toFixed(3) + ">" + wall.p2.x.toFixed(3) + "," + wall.p2.y.toFixed(3));
  return (h >>> 0).toString(16).padStart(8, "0");
}

function generateDistrict(seed, mx, my) {
  const id = "district:" + key2(mx, my);
  const poly = districtPolygon(seed, mx, my);
  const profile = profileFor(seed, mx, my);
  const palette = paletteFor(seed, mx, my);
  const portals = incidentPortals(seed, mx, my);
  const cells = subdivideDistrict(seed, id, poly, profile);
  const adjacency = buildAdjacency(cells);
  const portalMap = portalCells(cells, portals);
  const selection = chooseActiveCells(seed, id, cells, adjacency, profile, portals, portalMap, poly);
  const roomData = assignRooms(seed, id, cells, adjacency, selection.active, profile, portalMap);
  const doors = roomDoorGraph(seed, id, cells, adjacency, selection.active, roomData, profile);
  const wallData = buildWalls(cells, adjacency, selection.active, roomData, doors, poly, portals);

  const activeCells = cells.map((cell) => ({
    ...cell,
    active: selection.active.has(cell.index),
    roomId: roomData.cellRoom.get(cell.index) ?? null,
  }));

  const district = {
    id, mx, my,
    poly,
    bounds: polygonBounds(poly),
    centroid: polygonCentroid(poly),
    profile,
    palette,
    portals,
    portalCells: Object.fromEntries([...portalMap.entries()]),
    cells: activeCells,
    rooms: roomData.rooms,
    walls: wallData.walls,
    doors: wallData.doors,
    density: selection.density,
    connected: verifyRoomConnectivity(roomData.rooms, wallData.doors),
  };
  district.signature = stableDistrictSignature(district);
  return district;
}

function queryDistrictCoords(bounds) {
  const margin = DISTRICT_SIZE * (DISTRICT_JITTER + 0.12);
  const minX = Math.floor((bounds.minX - margin) / DISTRICT_SIZE) - 1;
  const maxX = Math.floor((bounds.maxX + margin) / DISTRICT_SIZE) + 1;
  const minY = Math.floor((bounds.minY - margin) / DISTRICT_SIZE) - 1;
  const maxY = Math.floor((bounds.maxY + margin) / DISTRICT_SIZE) + 1;
  const out = [];
  for (let y = minY; y <= maxY; y += 1) for (let x = minX; x <= maxX; x += 1) out.push([x, y]);
  return out;
}

export class WorldGenerator {
  constructor(seedText = "71-days-after-arrival") { this.setSeed(seedText); }
  setSeed(seedText) {
    this.seedText = String(seedText || "71-days-after-arrival");
    this.seed = hashString("v" + GENERATOR_VERSION + ":" + this.seedText);
    this.cache = new Map();
    this.clock = 0;
  }
  trimCache(limit = 180) {
    if (this.cache.size <= limit) return;
    const entries = [...this.cache.entries()].sort((a, b) => a[1].used - b[1].used || a[0].localeCompare(b[0]));
    for (let i = 0; i < entries.length - limit; i += 1) this.cache.delete(entries[i][0]);
  }
  getDistrict(mx, my) {
    const key = key2(mx, my);
    let entry = this.cache.get(key);
    if (!entry) {
      entry = { district: generateDistrict(this.seed, mx, my), used: ++this.clock };
      this.cache.set(key, entry);
    } else {
      entry.used = ++this.clock;
    }
    if (this.cache.size > 220) this.trimCache(180);
    return entry.district;
  }
  query(bounds) {
    const districts = queryDistrictCoords(bounds)
      .map(([x, y]) => this.getDistrict(x, y))
      .filter((d) => boundsIntersect(d.bounds, bounds))
      .sort((a, b) => a.id.localeCompare(b.id));
    this.trimCache(180);

    const cells = districts.flatMap((d) => d.cells.filter((c) => c.active && boundsIntersect(c.bounds, bounds)).map((c) => ({ ...c, districtId: d.id, palette: d.palette, profileId: d.profile.id })));
    const walls = districts.flatMap((d) => d.walls.filter((w) => boundsIntersect(polygonBounds([w.p1, w.p2]), bounds)).map((w) => ({ ...w, districtId: d.id, palette: d.palette })));
    const doors = districts.flatMap((d) => d.doors.map((door) => ({ ...door, districtId: d.id })));
    const portals = districts.flatMap((d) => d.portals.map((portal) => ({ ...portal, districtId: d.id })));
    const rooms = districts.flatMap((d) => d.rooms.map((room) => ({ ...room, districtId: d.id, palette: d.palette, profileId: d.profile.id })));

    let h = 2166136261 >>> 0;
    const mix = (v) => { const s = String(v); for (let i = 0; i < s.length; i += 1) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } };
    for (const district of districts) mix(district.id + ":" + district.signature + ";");

    return {
      seed: this.seedText,
      bounds,
      districts,
      cells,
      rooms,
      walls,
      doors,
      portals,
      stats: {
        districts: districts.length,
        cells: cells.length,
        rooms: rooms.length,
        doors: doors.length,
        portals: portals.length,
        averageDensity: districts.length ? districts.reduce((s, d) => s + d.density, 0) / districts.length : 0,
      },
      signature: (h >>> 0).toString(16).padStart(8, "0"),
    };
  }
}

export function districtSnapshot(generator, mx, my) {
  const d = generator.getDistrict(mx, my);
  return {
    id: d.id,
    signature: d.signature,
    profile: d.profile.id,
    palette: d.palette,
    portals: d.portals.map((p) => [p.id, p.p1.x, p.p1.y, p.p2.x, p.p2.y]),
    activeCells: d.cells.filter((c) => c.active).map((c) => [c.id, c.roomId, c.poly.map((p) => [p.x, p.y])]),
    rooms: d.rooms.map((r) => [r.id, [...r.cells]]),
  };
}

export function validateDistrictNoOverlap(district) {
  const active = district.cells.filter((c) => c.active);
  for (let i = 0; i < active.length; i += 1) {
    for (let j = i + 1; j < active.length; j += 1) {
      const area = convexIntersectionArea(active[i].poly, active[j].poly);
      if (area > 1e-4) return { ok: false, a: active[i].id, b: active[j].id, area };
    }
  }
  return { ok: true };
}

export function validateAdjacentDistrictsNoOverlap(a, b) {
  for (const ca of a.cells.filter((c) => c.active)) {
    for (const cb of b.cells.filter((c) => c.active)) {
      if (!boundsIntersect(ca.bounds, cb.bounds)) continue;
      const area = convexIntersectionArea(ca.poly, cb.poly);
      if (area > 1e-4) return { ok: false, a: ca.id, b: cb.id, area };
    }
  }
  return { ok: true };
}

export function validatePortalSymmetry(generator, ax, ay, bx, by) {
  const a = generator.getDistrict(ax, ay);
  const b = generator.getDistrict(bx, by);
  const pair = canonicalPair(ax, ay, bx, by);
  const pa = a.portals.find((p) => p.pair === pair);
  const pb = b.portals.find((p) => p.pair === pair);
  if (!pa || !pb) return false;
  return Math.hypot(pa.p1.x - pb.p1.x, pa.p1.y - pb.p1.y) < 1e-6 && Math.hypot(pa.p2.x - pb.p2.x, pa.p2.y - pb.p2.y) < 1e-6;
}
