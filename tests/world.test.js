import test from "node:test";
import assert from "node:assert/strict";
import {
  DISTRICT_SIZE,
  GENERATOR_VERSION,
  WorldGenerator,
  districtSnapshot,
  parentCell,
  validateAdjacentDistrictsNoOverlap,
  validateDistrictNoOverlap,
  validatePortalSymmetry,
} from "../src/world.js";

const sample = { minX: -2200, minY: -1800, maxX: 3200, maxY: 2600 };

test("v2 uses an addressable infinite district partition", () => {
  assert.equal(GENERATOR_VERSION, 2);
  assert.ok(DISTRICT_SIZE > 500);
});

test("required parent topology strictly approaches the origin", () => {
  for (const seed of ["reference", "alpha", "71-days-after-arrival"]) {
    for (let y = -18; y <= 18; y += 3) {
      for (let x = -18; x <= 18; x += 3) {
        let cx = x, cy = y, guard = 0;
        while (cx !== 0 || cy !== 0) {
          const before = Math.abs(cx) + Math.abs(cy);
          const p = parentCell(seed, cx, cy);
          assert.ok(p);
          const after = Math.abs(p[0]) + Math.abs(p[1]);
          assert.ok(after < before, `${seed} ${cx},${cy}`);
          [cx, cy] = p;
          assert.ok(++guard < 1000);
        }
      }
    }
  }
});

test("same seed and district address are byte stable", () => {
  const a = new WorldGenerator("determinism");
  const b = new WorldGenerator("determinism");
  for (const [x, y] of [[0,0], [2,-3], [-6,4]]) {
    assert.deepEqual(districtSnapshot(a, x, y), districtSnapshot(b, x, y));
  }
});

test("remote exploration cannot alter a district", () => {
  const g = new WorldGenerator("order-independent");
  const before = districtSnapshot(g, 1, -2);
  g.query({ minX: 50000, minY: -70000, maxX: 55000, maxY: -65000 });
  const after = districtSnapshot(g, 1, -2);
  assert.deepEqual(after, before);
});

test("query size does not alter architecture at shared district addresses", () => {
  const g = new WorldGenerator("query-size");
  const before = districtSnapshot(g, 0, 0);
  g.query(sample);
  g.query({ minX: -12000, minY: -9000, maxX: 14000, maxY: 11000 });
  const after = districtSnapshot(g, 0, 0);
  assert.deepEqual(after, before);
});

test("active cells never overlap inside a district", () => {
  for (const seed of ["reference", "alpha", "overlap-a", "71-days-after-arrival"]) {
    const g = new WorldGenerator(seed);
    for (const [x, y] of [[0,0],[1,0],[0,1],[-2,3],[5,-4]]) {
      const d = g.getDistrict(x, y);
      const result = validateDistrictNoOverlap(d);
      assert.equal(result.ok, true, result.ok ? "" : JSON.stringify(result));
      assert.ok(d.cells.filter((c) => c.active).length >= 8);
      assert.ok(d.rooms.length >= 2);
      assert.equal(d.connected, true, `${seed} ${x},${y} room graph disconnected`);
    }
  }
});

test("neighbor districts share zero positive-area architecture overlap", () => {
  const g = new WorldGenerator("neighbor-overlap");
  for (const [ax, ay, bx, by] of [[0,0,1,0],[0,0,0,1],[-3,2,-2,2],[5,-4,5,-3]]) {
    const result = validateAdjacentDistrictsNoOverlap(g.getDistrict(ax, ay), g.getDistrict(bx, by));
    assert.equal(result.ok, true, result.ok ? "" : JSON.stringify(result));
  }
});

test("every required shared portal is exactly symmetric", () => {
  const g = new WorldGenerator("portal-contracts");
  for (let y = -4; y <= 4; y += 1) {
    for (let x = -4; x <= 4; x += 1) {
      const p = parentCell("portal-contracts", x, y);
      if (!p) continue;
      assert.equal(validatePortalSymmetry(g, x, y, p[0], p[1]), true, `${x},${y}`);
    }
  }
});

test("output contains architecture and no route/corridor layer", () => {
  const data = new WorldGenerator("reference").query(sample);
  assert.ok(data.stats.districts >= 15, `districts=${data.stats.districts}`);
  assert.ok(data.stats.cells >= 180, `cells=${data.stats.cells}`);
  assert.ok(data.stats.rooms >= 70, `rooms=${data.stats.rooms}`);
  assert.ok(data.stats.doors >= 60, `doors=${data.stats.doors}`);
  assert.ok(data.stats.averageDensity > 0.35 && data.stats.averageDensity < 0.8);
  assert.equal("routes" in data, false);
  assert.equal("corridors" in data, false);
  assert.ok(new Set(data.districts.map((d) => d.profile.id)).size >= 3);
  assert.ok(new Set(data.districts.map((d) => d.palette)).size >= 2);
});
