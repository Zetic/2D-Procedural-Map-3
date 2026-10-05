import test from "node:test";
import assert from "node:assert/strict";
import {
  CONFLICT_HALO,
  GENERATOR_VERSION,
  LOT_CLEARANCE,
  MACRO_SIZE,
  WorldGenerator,
  parentCell,
  validateNoLotOverlap,
  validateRoomSubdivisions,
} from "../src/world.js";
import { aabbIntersects, obbOverlapStrict } from "../src/geometry.js";

const sampleBounds = { minX: -2200, minY: -1800, maxX: 3200, maxY: 2600 };

function lotSnapshot(data) {
  return data.lots.map((lot) => [
    lot.id,
    Number(lot.x.toFixed(5)),
    Number(lot.y.toFixed(5)),
    Number(lot.w.toFixed(5)),
    Number(lot.h.toFixed(5)),
    Number(lot.angle.toFixed(8)),
    lot.rooms.map((room) => [
      room.id,
      Number(room.x.toFixed(5)),
      Number(room.y.toFixed(5)),
      Number(room.w.toFixed(5)),
      Number(room.h.toFixed(5)),
    ]),
  ]);
}

test("generator constants describe a bounded local infinite model", () => {
  assert.equal(GENERATOR_VERSION, 1);
  assert.ok(MACRO_SIZE > 0);
  assert.ok(CONFLICT_HALO > LOT_CLEARANCE * 20);
});

test("macro parent graph strictly approaches the origin", () => {
  for (const seed of ["reference", "alpha", "71-days-after-arrival"]) {
    for (let my = -14; my <= 14; my += 2) {
      for (let mx = -14; mx <= 14; mx += 2) {
        let x = mx;
        let y = my;
        let guard = 0;
        while (x !== 0 || y !== 0) {
          const before = Math.abs(x) + Math.abs(y);
          const parent = parentCell(seed, x, y);
          assert.ok(parent, `missing parent at ${x},${y}`);
          const after = Math.abs(parent[0]) + Math.abs(parent[1]);
          assert.ok(after < before, `rank did not decrease at ${x},${y}`);
          [x, y] = parent;
          assert.ok(++guard < 1000);
        }
      }
    }
  }
});

test("same bounds and seed are byte-stable", () => {
  const a = new WorldGenerator("determinism-check").query(sampleBounds);
  const b = new WorldGenerator("determinism-check").query(sampleBounds);
  assert.equal(a.signature, b.signature);
  assert.deepEqual(lotSnapshot(a), lotSnapshot(b));
  assert.deepEqual(a.routes.map((route) => route.id), b.routes.map((route) => route.id));
});

test("exploration order cannot alter local architecture", () => {
  const generator = new WorldGenerator("order-independence");
  const before = generator.query(sampleBounds);
  generator.query({ minX: 40000, minY: -34000, maxX: 45500, maxY: -29000 });
  const after = generator.query(sampleBounds);
  assert.equal(before.signature, after.signature);
  assert.deepEqual(lotSnapshot(before), lotSnapshot(after));
});

test("query size does not change ownership inside the smaller query", () => {
  const seed = "query-invariance";
  const inner = { minX: -1200, minY: -900, maxX: 1500, maxY: 1300 };
  const outer = { minX: -4400, minY: -3800, maxX: 4700, maxY: 4200 };
  const small = new WorldGenerator(seed).query(inner);
  const large = new WorldGenerator(seed).query(outer);

  const largeInnerLots = large.lots
    .filter((lot) => aabbIntersects(lot.aabb, inner))
    .map((lot) => lot.id)
    .sort();
  const smallIds = small.lots.map((lot) => lot.id).sort();

  assert.deepEqual(smallIds, largeInnerLots);
});

test("surviving room lots never overlap", () => {
  for (const seed of ["reference", "alpha", "overlap-a", "overlap-b", "71-days-after-arrival"]) {
    const data = new WorldGenerator(seed).query({
      minX: -4200, minY: -3600, maxX: 4800, maxY: 4300,
    });
    const validation = validateNoLotOverlap(data.lots);
    assert.equal(validation.ok, true, validation.ok ? "" : `${validation.a} overlaps ${validation.b}`);
    assert.ok(data.lots.length > 20, `too few lots for meaningful overlap test: ${data.lots.length}`);
  }
});

test("room subdivisions remain inside their exclusive lot and do not overlap", () => {
  const data = new WorldGenerator("subdivision-check").query(sampleBounds);
  assert.ok(data.lots.length > 10);
  for (const lot of data.lots) {
    assert.equal(validateRoomSubdivisions(lot), true, lot.id);
  }
});

test("room lots do not cut through reserved traversal geometry", () => {
  const data = new WorldGenerator("route-reservation-check").query({
    minX: -3000, minY: -2600, maxX: 3500, maxY: 3200,
  });

  for (const lot of data.lots) {
    for (const route of data.routes) {
      if (!aabbIntersects(lot.aabb, route.aabb)) continue;
      assert.equal(
        obbOverlapStrict(lot, route, 1),
        false,
        `${lot.id} intrudes reserved route ${route.id}`,
      );
    }
  }
});

test("generated architecture is substantial and varied", () => {
  const data = new WorldGenerator("reference").query(sampleBounds);
  assert.ok(data.stats.edges >= 8, `edges=${data.stats.edges}`);
  assert.ok(data.stats.lots >= 25, `lots=${data.stats.lots}`);
  assert.ok(data.stats.rooms > data.stats.lots, `rooms=${data.stats.rooms}, lots=${data.stats.lots}`);
  assert.ok(new Set(data.lots.map((lot) => lot.profile.id)).size >= 3);
  assert.ok(new Set(data.lots.map((lot) => lot.palette)).size >= 2);
});
