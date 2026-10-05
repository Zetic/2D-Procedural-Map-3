import { chance, hashParts, hashString, rand01, randInt, randRange, signed } from "./prng.js";
import { aabbIntersects, expandAabb, obb, obbOverlapStrict, rectsOverlapLocal } from "./geometry.js";

export const GENERATOR_VERSION = 1;
export const MACRO_SIZE = 1100;
export const QUERY_INFLUENCE = 2100;
export const CONFLICT_HALO = 620;
export const LOT_CLEARANCE = 7;

export const PALETTES = [
  { floor: "#ead5a6", route: "#dfc78e", wall: "#8b7654" },
  { floor: "#e5c98f", route: "#d9bb79", wall: "#87714c" },
  { floor: "#e8d0b4", route: "#dbc1a0", wall: "#88715f" },
  { floor: "#dbb59f", route: "#cfa38f", wall: "#805f55" },
  { floor: "#b8c4cf", route: "#aeb9c3", wall: "#626f7b" },
  { floor: "#bcc99c", route: "#afbd8d", wall: "#697252" },
  { floor: "#d8b986", route: "#cdaa70", wall: "#7d6546" },
];

const PROFILES = [
  { id: "office", spawn: 0.83, route: [30, 42], spacing: [120, 165], along: [88, 185], depth: [86, 180], maxLeaves: 6, palette: 0 },
  { id: "service", spawn: 0.72, route: [24, 36], spacing: [115, 160], along: [70, 150], depth: [72, 150], maxLeaves: 4, palette: 1 },
  { id: "institutional", spawn: 0.76, route: [34, 48], spacing: [145, 205], along: [115, 230], depth: [105, 220], maxLeaves: 7, palette: 2 },
  { id: "liminal", spawn: 0.62, route: [38, 58], spacing: [170, 240], along: [150, 290], depth: [140, 280], maxLeaves: 3, palette: 0 },
  { id: "archive", spawn: 0.88, route: [26, 38], spacing: [105, 145], along: [72, 135], depth: [95, 205], maxLeaves: 6, palette: 6 },
  { id: "flooded", spawn: 0.66, route: [30, 44], spacing: [140, 210], along: [100, 220], depth: [100, 230], maxLeaves: 4, palette: 4 },
  { id: "overgrown", spawn: 0.68, route: [30, 46], spacing: [135, 205], along: [100, 230], depth: [95, 240], maxLeaves: 5, palette: 5 },
];

function nodeKey(x, y) {
  return x + "," + y;
}

function canonicalPair(ax, ay, bx, by) {
  const a = nodeKey(ax, ay);
  const b = nodeKey(bx, by);
  return a < b ? [a, b] : [b, a];
}

function edgeKey(ax, ay, bx, by, kind) {
  const [a, b] = canonicalPair(ax, ay, bx, by);
  return kind + ":" + a + "|" + b;
}

function sign(v) {
  return v < 0 ? -1 : v > 0 ? 1 : 0;
}

export function parentCell(seedText, mx, my) {
  const seed = hashString("v" + GENERATOR_VERSION + ":" + String(seedText));
  return parentFor(seed, mx, my);
}

function parentFor(seed, mx, my) {
  if (mx === 0 && my === 0) return null;
  if (mx === 0) return [0, my - sign(my)];
  if (my === 0) return [mx - sign(mx), 0];

  const chooseX = chance(0.5, seed, "parent-axis", mx, my);
  if (chooseX) return [mx - sign(mx), my];
  return [mx, my - sign(my)];
}

function macroNode(seed, mx, my) {
  const jitter = MACRO_SIZE * 0.31;
  return {
    mx,
    my,
    x: mx * MACRO_SIZE + MACRO_SIZE * 0.5 + signed(jitter, seed, "node-x", mx, my),
    y: my * MACRO_SIZE + MACRO_SIZE * 0.5 + signed(jitter, seed, "node-y", mx, my),
  };
}

function profileFor(seed, key) {
  return PROFILES[randInt(0, PROFILES.length - 1, seed, "profile", key)];
}

function makeEdge(seed, ax, ay, bx, by, kind) {
  const key = edgeKey(ax, ay, bx, by, kind);
  const a = macroNode(seed, ax, ay);
  const b = macroNode(seed, bx, by);
  const profile = profileFor(seed, key);
  const width = randRange(profile.route[0], profile.route[1], seed, key, "route-width");

  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy) || 1;
  const nx = -dy / length;
  const ny = dx / length;
  const bendA = signed(MACRO_SIZE * 0.16, seed, key, "bend-a");
  const bendB = signed(MACRO_SIZE * 0.16, seed, key, "bend-b");
  const tangentA = signed(MACRO_SIZE * 0.045, seed, key, "tangent-a");
  const tangentB = signed(MACRO_SIZE * 0.045, seed, key, "tangent-b");

  const points = [
    { x: a.x, y: a.y },
    {
      x: a.x + dx * 0.34 + (dx / length) * tangentA + nx * bendA,
      y: a.y + dy * 0.34 + (dy / length) * tangentA + ny * bendA,
    },
    {
      x: a.x + dx * 0.67 + (dx / length) * tangentB + nx * bendB,
      y: a.y + dy * 0.67 + (dy / length) * tangentB + ny * bendB,
    },
    { x: b.x, y: b.y },
  ];

  const segments = [];
  for (let i = 0; i < points.length - 1; i += 1) {
    const p = points[i];
    const q = points[i + 1];
    const sx = q.x - p.x;
    const sy = q.y - p.y;
    const len = Math.hypot(sx, sy);
    const angle = Math.atan2(sy, sx);
    segments.push(obb(
      (p.x + q.x) / 2,
      (p.y + q.y) / 2,
      len + width * 0.72,
      width,
      angle,
      {
        id: key + ":segment:" + i,
        edgeKey: key,
        edgeKind: kind,
        segmentIndex: i,
        profileId: profile.id,
        palette: profile.palette,
        routeWidth: width,
        ax: p.x,
        ay: p.y,
        bx: q.x,
        by: q.y,
        length: len,
      },
    ));
  }

  const chambers = [];
  const chamberSizeA = width * randRange(1.45, 2.25, seed, key, "chamber-a");
  const chamberSizeB = width * randRange(1.45, 2.25, seed, key, "chamber-b");
  chambers.push(obb(a.x, a.y, chamberSizeA, chamberSizeA, 0, {
    id: key + ":node:a",
    edgeKey: key,
    edgeKind: kind,
    profileId: profile.id,
    palette: profile.palette,
    routeWidth: width,
  }));
  chambers.push(obb(b.x, b.y, chamberSizeB, chamberSizeB, 0, {
    id: key + ":node:b",
    edgeKey: key,
    edgeKind: kind,
    profileId: profile.id,
    palette: profile.palette,
    routeWidth: width,
  }));

  if (chance(0.34, seed, key, "mid-chamber")) {
    const segment = segments[randInt(0, segments.length - 1, seed, key, "mid-segment")];
    const t = randRange(0.30, 0.70, seed, key, "mid-t");
    const x = segment.ax + (segment.bx - segment.ax) * t;
    const y = segment.ay + (segment.by - segment.ay) * t;
    const along = randRange(width * 1.7, width * 3.3, seed, key, "mid-along");
    const cross = randRange(width * 1.5, width * 2.8, seed, key, "mid-cross");
    chambers.push(obb(x, y, along, cross, segment.angle, {
      id: key + ":chamber:mid",
      edgeKey: key,
      edgeKind: kind,
      profileId: profile.id,
      palette: profile.palette,
      routeWidth: width,
    }));
  }

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const shape of [...segments, ...chambers]) {
    minX = Math.min(minX, shape.aabb.minX);
    minY = Math.min(minY, shape.aabb.minY);
    maxX = Math.max(maxX, shape.aabb.maxX);
    maxY = Math.max(maxY, shape.aabb.maxY);
  }

  return { key, kind, a, b, profile, width, points, segments, chambers, aabb: { minX, minY, maxX, maxY } };
}

function addEdge(map, edge) {
  if (!map.has(edge.key)) map.set(edge.key, edge);
}

function loopAllowed(seed, mx, my, axis) {
  const probability = axis === "x" ? 0.12 : 0.10;
  return chance(probability, seed, "loop", mx, my, axis);
}

function collectEdges(seed, bounds) {
  const search = expandAabb(bounds, QUERY_INFLUENCE);
  const minMX = Math.floor(search.minX / MACRO_SIZE) - 2;
  const maxMX = Math.floor(search.maxX / MACRO_SIZE) + 2;
  const minMY = Math.floor(search.minY / MACRO_SIZE) - 2;
  const maxMY = Math.floor(search.maxY / MACRO_SIZE) + 2;
  const edges = new Map();

  for (let my = minMY; my <= maxMY; my += 1) {
    for (let mx = minMX; mx <= maxMX; mx += 1) {
      const parent = parentFor(seed, mx, my);
      if (parent) addEdge(edges, makeEdge(seed, mx, my, parent[0], parent[1], "tree"));

      if (loopAllowed(seed, mx, my, "x")) addEdge(edges, makeEdge(seed, mx, my, mx + 1, my, "loop"));
      if (loopAllowed(seed, mx, my, "y")) addEdge(edges, makeEdge(seed, mx, my, mx, my + 1, "loop"));
    }
  }

  return [...edges.values()].filter((edge) => aabbIntersects(edge.aabb, search));
}

function candidateFromSample(seed, edge, segment, sampleIndex, sampleCount, side) {
  const profile = edge.profile;
  const baseT = (sampleIndex + 1) / (sampleCount + 1);
  const jitter = signed(0.16 / Math.max(1, sampleCount), seed, edge.key, segment.segmentIndex, sampleIndex, side, "t-jitter");
  const t = Math.max(0.08, Math.min(0.92, baseT + jitter));
  const px = segment.ax + (segment.bx - segment.ax) * t;
  const py = segment.ay + (segment.by - segment.ay) * t;

  const along = randRange(profile.along[0], profile.along[1], seed, edge.key, segment.segmentIndex, sampleIndex, side, "along");
  const depth = randRange(profile.depth[0], profile.depth[1], seed, edge.key, segment.segmentIndex, sampleIndex, side, "depth");

  const nx = -Math.sin(segment.angle);
  const ny = Math.cos(segment.angle);
  const offset = edge.width / 2 + depth / 2 + LOT_CLEARANCE;
  const x = px + nx * side * offset;
  const y = py + ny * side * offset;
  const id = edge.key + ":lot:" + segment.segmentIndex + ":" + sampleIndex + ":" + side;
  const priority = hashParts(seed, "lot-priority", id);

  const envelope = obb(x, y, along, depth, segment.angle, {
    id,
    priority,
    sourceSegmentId: segment.id,
    sourceEdgeKey: edge.key,
    edgeKind: edge.kind,
    profileId: profile.id,
    palette: profile.palette,
    doorSide: side > 0 ? -1 : 1,
  });

  return {
    ...envelope,
    id,
    priority,
    sourceSegmentId: segment.id,
    sourceEdgeKey: edge.key,
    edgeKind: edge.kind,
    profile,
    palette: profile.palette,
    doorSide: side > 0 ? -1 : 1,
  };
}

function candidatesForEdge(seed, edge) {
  const out = [];
  for (const segment of edge.segments) {
    const spacing = randRange(edge.profile.spacing[0], edge.profile.spacing[1], seed, edge.key, segment.segmentIndex, "spacing");
    const sampleCount = Math.max(1, Math.floor(segment.length / spacing));
    for (let i = 0; i < sampleCount; i += 1) {
      for (const side of [-1, 1]) {
        const probability = edge.profile.spawn * (edge.kind === "tree" ? 1 : 0.72);
        if (!chance(probability, seed, edge.key, segment.segmentIndex, i, side, "spawn")) continue;
        out.push(candidateFromSample(seed, edge, segment, i, sampleCount, side));
      }
    }
  }
  return out;
}

function comparePriority(a, b) {
  if (a.priority !== b.priority) return a.priority - b.priority;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function candidateHitsTraversal(candidate, routeShapes) {
  for (const shape of routeShapes) {
    if (shape.id === candidate.sourceSegmentId) continue;
    if (!aabbIntersects(candidate.aabb, shape.aabb)) continue;
    if (obbOverlapStrict(candidate, shape, 1.5)) return true;
  }
  return false;
}

function resolveLots(candidates, routeShapes) {
  const active = candidates.filter((candidate) => !candidateHitsTraversal(candidate, routeShapes));
  const losers = new Set();

  for (let i = 0; i < active.length; i += 1) {
    const a = active[i];
    for (let j = i + 1; j < active.length; j += 1) {
      const b = active[j];
      if (!aabbIntersects(expandAabb(a.aabb, LOT_CLEARANCE), b.aabb)) continue;
      if (!obbOverlapStrict(a, b, LOT_CLEARANCE)) continue;
      if (comparePriority(a, b) < 0) losers.add(b.id);
      else losers.add(a.id);
    }
  }

  return active.filter((candidate) => !losers.has(candidate.id));
}

function localRect(x, y, w, h) {
  return { x, y, w, h };
}

function subdivideLot(seed, lot) {
  const minDim = 36;
  const maxLeaves = lot.profile.maxLeaves;
  const desired = randInt(1, maxLeaves, seed, lot.id, "leaf-count");
  const leaves = [localRect(-lot.w / 2, -lot.h / 2, lot.w, lot.h)];
  const walls = [];

  let guard = 0;
  while (leaves.length < desired && guard++ < 24) {
    let pickIndex = -1;
    let bestScore = -Infinity;

    for (let i = 0; i < leaves.length; i += 1) {
      const r = leaves[i];
      const canVertical = r.w >= minDim * 2.15;
      const canHorizontal = r.h >= minDim * 2.15;
      if (!canVertical && !canHorizontal) continue;
      const score = r.w * r.h + rand01(seed, lot.id, "pick", guard, i) * 0.001;
      if (score > bestScore) {
        bestScore = score;
        pickIndex = i;
      }
    }

    if (pickIndex < 0) break;
    const r = leaves[pickIndex];
    const verticalPossible = r.w >= minDim * 2.15;
    const horizontalPossible = r.h >= minDim * 2.15;
    let vertical;
    if (verticalPossible && horizontalPossible) {
      if (r.w > r.h * 1.18) vertical = true;
      else if (r.h > r.w * 1.18) vertical = false;
      else vertical = chance(0.5, seed, lot.id, "axis", guard);
    } else {
      vertical = verticalPossible;
    }

    const ratio = randRange(0.36, 0.64, seed, lot.id, "ratio", guard);
    if (vertical) {
      const split = r.w * ratio;
      if (split < minDim || r.w - split < minDim) break;
      const a = localRect(r.x, r.y, split, r.h);
      const b = localRect(r.x + split, r.y, r.w - split, r.h);
      leaves.splice(pickIndex, 1, a, b);
      walls.push({
        x1: r.x + split, y1: r.y,
        x2: r.x + split, y2: r.y + r.h,
        gapT: randRange(0.28, 0.72, seed, lot.id, "gap-t", guard),
        gapWidth: randRange(15, Math.min(34, r.h * 0.34), seed, lot.id, "gap-w", guard),
      });
    } else {
      const split = r.h * ratio;
      if (split < minDim || r.h - split < minDim) break;
      const a = localRect(r.x, r.y, r.w, split);
      const b = localRect(r.x, r.y + split, r.w, r.h - split);
      leaves.splice(pickIndex, 1, a, b);
      walls.push({
        x1: r.x, y1: r.y + split,
        x2: r.x + r.w, y2: r.y + split,
        gapT: randRange(0.28, 0.72, seed, lot.id, "gap-t", guard),
        gapWidth: randRange(15, Math.min(34, r.w * 0.34), seed, lot.id, "gap-w", guard),
      });
    }
  }

  const rooms = leaves.map((r, index) => ({
    ...r,
    id: lot.id + ":room:" + index,
    colorShift: rand01(seed, lot.id, "room-color", index),
  }));

  const outerDoorWidth = randRange(18, Math.min(42, lot.w * 0.30), seed, lot.id, "outer-door");
  return { rooms, walls, outerDoorWidth };
}

function stableSignature(data) {
  let h = 2166136261 >>> 0;
  const mix = (value) => {
    const s = String(value);
    for (let i = 0; i < s.length; i += 1) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
  };

  for (const route of data.routes) mix(route.id + ":" + route.x.toFixed(3) + ":" + route.y.toFixed(3));
  for (const lot of data.lots) {
    mix(lot.id + ":" + lot.x.toFixed(3) + ":" + lot.y.toFixed(3) + ":" + lot.w.toFixed(3) + ":" + lot.h.toFixed(3));
    for (const room of lot.rooms) mix(room.id + ":" + room.x.toFixed(3) + ":" + room.y.toFixed(3) + ":" + room.w.toFixed(3) + ":" + room.h.toFixed(3));
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

export class WorldGenerator {
  constructor(seedText = "71-days-after-arrival") {
    this.setSeed(seedText);
  }

  setSeed(seedText) {
    this.seedText = String(seedText || "71-days-after-arrival");
    this.seed = hashString("v" + GENERATOR_VERSION + ":" + this.seedText);
    this.edgeCache = new Map();
  }

  query(bounds) {
    const influenceBounds = expandAabb(bounds, CONFLICT_HALO);
    const rawEdges = collectEdges(this.seed, influenceBounds);
    const edges = rawEdges.map((edge) => {
      const cached = this.edgeCache.get(edge.key);
      if (cached) return cached;
      this.edgeCache.set(edge.key, edge);
      return edge;
    });

    const routeMap = new Map();
    for (const edge of edges) {
      for (const shape of [...edge.segments, ...edge.chambers]) {
        if (!routeMap.has(shape.id)) routeMap.set(shape.id, shape);
      }
    }
    const routeShapes = [...routeMap.values()];

    let candidates = [];
    for (const edge of edges) candidates.push(...candidatesForEdge(this.seed, edge));
    candidates = candidates.filter((candidate) => aabbIntersects(candidate.aabb, influenceBounds));

    const survivors = resolveLots(candidates, routeShapes)
      .filter((lot) => aabbIntersects(lot.aabb, bounds))
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((lot) => ({ ...lot, ...subdivideLot(this.seed, lot) }));

    const routes = routeShapes
      .filter((shape) => aabbIntersects(shape.aabb, bounds))
      .sort((a, b) => a.id.localeCompare(b.id));

    const visibleEdges = edges
      .filter((edge) => aabbIntersects(edge.aabb, bounds))
      .sort((a, b) => a.key.localeCompare(b.key));

    const data = {
      seed: this.seedText,
      bounds,
      edges: visibleEdges,
      routes,
      lots: survivors,
      stats: {
        edges: visibleEdges.length,
        routes: routes.length,
        lots: survivors.length,
        rooms: survivors.reduce((sum, lot) => sum + lot.rooms.length, 0),
        candidatesConsidered: candidates.length,
      },
    };
    data.signature = stableSignature(data);
    return data;
  }
}

export function validateNoLotOverlap(lots) {
  for (let i = 0; i < lots.length; i += 1) {
    for (let j = i + 1; j < lots.length; j += 1) {
      if (obbOverlapStrict(lots[i], lots[j], LOT_CLEARANCE)) {
        return { ok: false, a: lots[i].id, b: lots[j].id };
      }
    }
  }
  return { ok: true };
}

export function validateRoomSubdivisions(lot) {
  for (const room of lot.rooms) {
    if (room.x < -lot.w / 2 - 1e-6 || room.y < -lot.h / 2 - 1e-6 ||
        room.x + room.w > lot.w / 2 + 1e-6 || room.y + room.h > lot.h / 2 + 1e-6) {
      return false;
    }
  }
  for (let i = 0; i < lot.rooms.length; i += 1) {
    for (let j = i + 1; j < lot.rooms.length; j += 1) {
      if (rectsOverlapLocal(lot.rooms[i], lot.rooms[j])) return false;
    }
  }
  return true;
}
