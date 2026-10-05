# 2D Procedural Map 3

An infinite deterministic 2D architectural generator built around **partition ownership and room-graph connectivity**.

Generator v2 replaces the original route-and-lot prototype completely. There is no route, road, corridor, or post-hoc collision layer in the world model.

## Generation model

```text
world seed
  -> infinite warped district tiling
  -> canonical shared-boundary portal contracts
  -> recursive non-overlapping spatial partition
  -> required portal cells
  -> connected architectural cell selection
  -> deterministic cell merging into compound rooms
  -> room-adjacency graph
  -> spanning doors + optional loop doors
  -> walls derived from ownership boundaries
```

### Why this differs from the earlier prototypes

The generator does not place independent rooms and reject collisns. It does not overlap growth primitives and union them into a floor mass. It also does not turn the hidden connectivity topology into visible corridors.

Each district is an exclusive polygon from an infinite warped lattice. The district is subdivided into disjoint convex cells before any room exists. Rooms are unions of those cells. Two rooms therefore cannot occupy the same positive-area space by construction.

Connectivity is expressed only as shared boundary portal obligations. Inside a district, portal cells are connected through the ordinary cell adjacency graph. A deterministic spanning set of doors makes every generated room reachable; extra doors add loops. A corridor only appears visually if the partition happens to produce a long narrow room.

## Deterministic infinity

All decisions are addressed by:

```text
generator version + world seed + stable district/cell/boundary identity
```

Streaming/query order cannot change a coordinate. Adjacent districts derive the exact same portal segment from the same canonical boundary key.

Every district except the origin has a required parent edge that strictly reduces Manhattan rank toward `(0,0)`. Since every district internally connects all of its portal rooms, the infinite architecture is globally connected through room-to-room boundary openings without a road layer.

## Architectural variation

District profiles currently include office, service, institutional, liminal, archive, flooded, and overgrown families. Profiles alter partition density, occupied-space density, compound-room merging, room-door widths, loops, and the number of large architectural lobes.

Color is assigned in multi-district zones so connectivity does not reveal itself as long colored strips.

## Validation

The test suite checks:

- strict parent-rank decrease toward the origin
- seed/address determinism
- exploration-order invariance
- query-size invariance
- zero positive-area overlap inside districts
- zero positive-area overlap across adjacent districts
- exact shared portal symmetry
- connected room graphs inside sampled districts
- no exposed route/corridor generation layer
- architectural density and profile variation

A stress pass across 1,620 generated districts also completed with zero overlap or connectivity failures during development.

## Development

```bash
npm test
python3 -m http.server 8080
```

Then open `http://localhost:8080`.

## GitHub Pages

The included workflow runs the tests before deploying the repository root. If Pages has never been enabled for the repository, select **Settings -> Pages -> Build and deployment -> GitHub Actions** once, then rerun the workflow.
