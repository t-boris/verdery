/**
 * Pure ring/vertex addressing for the vertex-edit sub-mode
 * (`shapes/vertex-handles.tsx`).
 *
 * `editVertex` commands address a position by `ringIndex`/`vertexIndex`
 * alone — no geometry travels with the command (see `command.ts`'s
 * `EditVertexPayload`) — so this module only needs to answer "which ring,
 * and what are its current positions", not recompute a whole new geometry
 * the way `geometry-transform.ts` does for `replaceGeometry`.
 *
 * Vertex-level editing reaches `Polygon` (ring 0, the exterior ring only —
 * holes are out of scope, matching `polygon-shape.tsx`'s own comment) and
 * `LineString` (ring 0). `MultiPolygon`/`MultiLineString`/`Point` return
 * `null` — "Foundation-release geometry editing does not yet reach
 * MultiPolygon vertex-level commands" per
 * `@verdery/geometry-contracts`'s `inverse-command.ts`.
 */

import type { Geometry, Position } from '@verdery/geometry-contracts';

export interface EditableRing {
  readonly ringIndex: number;
  readonly positions: readonly Position[];
  /** True for a Polygon ring, whose last position duplicates its first. */
  readonly closed: boolean;
}

const MINIMUM_LINE_VERTICES = 2;
/** A Polygon's exterior ring stores the closing duplicate, so 4 stored points is the minimum: 3 unique vertices plus the repeat of the first. */
const MINIMUM_CLOSED_RING_LENGTH = 4;

/** The single editable ring of a geometry, or `null` when this geometry type is out of scope for vertex editing. */
export function editableRingOf(geometry: Geometry): EditableRing | null {
  switch (geometry.type) {
    case 'LineString':
      return { ringIndex: 0, positions: geometry.coordinates, closed: false };
    case 'Polygon': {
      const exterior = geometry.coordinates[0];
      return exterior === undefined ? null : { ringIndex: 0, positions: exterior, closed: true };
    }
    case 'Point':
    case 'MultiLineString':
    case 'MultiPolygon':
      return null;
  }
}

/** The midpoint between two positions, in local metres. */
export function midpointOf(a: Position, b: Position): Position {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}

export interface RingEdge {
  /** The vertex index of the edge's starting point. */
  readonly fromIndex: number;
  /** The index a new vertex inserted on this edge would take — see `editVertex`'s `insert` semantics. */
  readonly insertAtIndex: number;
  readonly midpoint: Position;
}

/**
 * Every edge of a ring, as consecutive stored-position pairs. A Polygon's
 * stored closing duplicate means this single pass already covers its
 * closing edge too — no separate wraparound case is needed. The last
 * "vertex" of a closed ring (the duplicate of the first) is deliberately
 * excluded from `edgesOf`'s `fromIndex` values in the caller's own vertex
 * rendering, but is still a valid `toIndex`/`insertAtIndex` target here,
 * since inserting a point just before it keeps the ring closed.
 */
export function edgesOf(ring: EditableRing): readonly RingEdge[] {
  const edges: RingEdge[] = [];
  for (let index = 0; index < ring.positions.length - 1; index += 1) {
    const from = ring.positions[index];
    const to = ring.positions[index + 1];
    if (from === undefined || to === undefined) {
      continue;
    }
    edges.push({ fromIndex: index, insertAtIndex: index + 1, midpoint: midpointOf(from, to) });
  }
  return edges;
}

/**
 * The vertex indices a handle should render for, excluding a Polygon ring's
 * trailing duplicate of its first position — that stored point is a closing
 * marker, not an independent vertex a user drew.
 */
export function editableVertexIndices(ring: EditableRing): readonly number[] {
  const count = ring.closed ? ring.positions.length - 1 : ring.positions.length;
  return Array.from({ length: Math.max(count, 0) }, (_unused, index) => index);
}

/** True when removing a vertex from this ring would still leave a valid shape. */
export function canRemoveVertex(ring: EditableRing): boolean {
  return ring.closed
    ? ring.positions.length > MINIMUM_CLOSED_RING_LENGTH
    : ring.positions.length > MINIMUM_LINE_VERTICES;
}

/**
 * True for a closed ring's first vertex (index 0) — the one whose value the
 * ring's stored trailing duplicate mirrors.
 * `services/api/.../domain/geometry-edit.ts`'s `editVertex` `move`/`remove`
 * operations touch exactly one stored position and never mirror the other
 * copy, so acting on this vertex through `editVertex` alone would silently
 * open the ring (a move leaves the duplicate stale; a remove drops one copy
 * but leaves the other, breaking first-equals-last closure). Both call sites
 * in `map-canvas.tsx` special-case this vertex instead of calling
 * `editVertex` directly — move rebuilds the whole ring and commits
 * `replaceGeometry`; remove is disabled for this vertex entirely, matching
 * the iOS editor's identical finding and fix.
 */
export function isRingClosureVertex(ring: EditableRing, vertexIndex: number): boolean {
  return ring.closed && vertexIndex === 0;
}

/** True when removing this specific vertex is safe — the ring-level check, minus the closure vertex (see `isRingClosureVertex`). */
export function canRemoveVertexAt(ring: EditableRing, vertexIndex: number): boolean {
  return canRemoveVertex(ring) && !isRingClosureVertex(ring, vertexIndex);
}

/**
 * A sensible single reference vertex for the reference-relative snaps
 * (`snapping.ts`'s horizontal/vertical, angle-increment, and round-distance
 * checks) while dragging `vertexIndex`: the immediately preceding vertex in
 * the ring, matching how a person draws — the segment being shaped is the one
 * ending at the vertex just moved.
 *
 * Index 0 has no preceding vertex to fall back on in an open `LineString`, so
 * it uses the *following* vertex instead. A closed ring's index 0 does have a
 * true previous vertex — the one just before the stored closing duplicate,
 * at `positions.length - 2` — since the ring wraps around to it.
 */
export function referenceVertexFor(ring: EditableRing, vertexIndex: number): Position | null {
  if (vertexIndex > 0) {
    return ring.positions[vertexIndex - 1] ?? null;
  }
  if (ring.closed) {
    return ring.positions[ring.positions.length - 2] ?? null;
  }
  return ring.positions[1] ?? null;
}

/**
 * Rebuilds a Polygon's exterior ring with both the first and last stored
 * position set to `position` — the `replaceGeometry` counterpart to moving
 * the ring-closure vertex (see `isRingClosureVertex`). Returns `geometry`
 * unchanged if it is not a Polygon with a non-empty exterior ring.
 */
export function movedRingClosureGeometry(geometry: Geometry, position: Position): Geometry {
  if (geometry.type !== 'Polygon') {
    return geometry;
  }
  const exterior = geometry.coordinates[0];
  if (exterior === undefined || exterior.length === 0) {
    return geometry;
  }
  const nextExterior = [...exterior];
  nextExterior[0] = position;
  nextExterior[nextExterior.length - 1] = position;
  return { type: 'Polygon', coordinates: [nextExterior, ...geometry.coordinates.slice(1)] };
}
