# 2D Procedural Map 3

An infinite, deterministic 2D architectural generator designed around **spatial ownership first**.

This version deliberately avoids the two failure modes explored in the previous prototypes:

- it does **not** generate overlapping rooms and union them into a cave-like mass;
- it does **not** place rooms sequentially and let earlier runtime generation steal space from later rooms.

## Core model

```text
world seed
  -> addressable macro topology
  -> mandatory traversal reservations
  -> bounded room-lot candidates
  -> canonical candidate conflict resolution
  -> non-overlapping lot ownership
  -> deterministic room subdivision inside each lot
  -> render/query by world bounds
```

Every room lot has a stable identity, finite influence radius, and stable priority. Two conflicting lots are resolved by identity/priority, not by exploration order. Surviving lot envelopes never overlap. Rooms are then subdivided only inside their surviving envelope, so same-plane room overlap is structurally impossible.

Traversal space is generated first from a deterministic infinite parent graph. Rooms cannot consume required route space, so connectivity never has to be repaired after room placement.

## Properties

- Infinite world-space query model
- Deterministic seed and shareable URL
- Exploration-order independent
- Guaranteed connected macro traversal tree
- Optional deterministic loops
- Zero overlap between surviving room lots
- Bounded local influence: no global simulation or backtracking
- Rotated architectural districts and rooms
- Multiple deterministic architecture profiles
- Pan/zoom canvas viewer
- Debug overlays for macro routes, candidate envelopes, and IDs
- PNG export
- GitHub Pages deployment
- Node regression tests

## Development

```bash
npm test
python3 -m http.server 8080
```

Then open `http://localhost:8080`.

## GitHub Pages

The included workflow validates the generator before publishing the repository root. In **Settings -> Pages**, select **GitHub Actions** if Pages has not been enabled yet.

## Important limitation

The system uses a finite maximum room-lot size and a finite route influence radius. Those bounds are intentional: an infinite deterministic generator cannot answer a local query with guaranteed collision freedom if arbitrarily distant, arbitrarily large features are allowed to affect the queried point.
