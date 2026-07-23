/**
 * Pure, Konva-independent snapping for single-point placement gestures: the
 * next point of a polygon/line draft (`map-canvas.tsx`'s `handleStageClick`/
 * `handleStageMouseMove`), and a single dragged vertex handle
 * (`shapes/vertex-handles.tsx`'s `handleVertexDragEnd`/`handleVertexDragMove`).
 *
 * Operates entirely on `Position`/`Geometry` from `@verdery/geometry-contracts`
 * and this feature's own `MapObjectRecord` — never a Konva type — per
 * `architecture/map-rendering-and-editing.md` section "10. Snapping and
 * Constraints" ("Constraint metadata must not depend on Konva, Core Graphics,
 * MapLibre, or MapKit types"). Callers convert screen coordinates to local
 * metres (`viewport.ts`'s `toLocal`) before calling in here, and convert the
 * result back to screen coordinates (`toScreen`) to draw it.
 *
 * ## Snap targets and precedence
 *
 * `snapPosition` tries five kinds of snap, in this fixed order, and returns
 * the first one whose tolerance the candidate falls within — never more than
 * one:
 *
 * 1. **Vertex** — an existing vertex of any object in the garden. This
 *    naturally covers the architecture doc's separate "lot and structure
 *    boundaries" bullet too: a lot or a structure is an ordinary
 *    `MapObjectRecord` with vertices like any other category, so it needs no
 *    special-casing here — it is already a snap target through this same
 *    path.
 * 2. **Edge** — the nearest point on any edge (segment) of any object,
 *    clamped to the segment.
 * 3. **Horizontal/vertical alignment** — relative to a reference point (the
 *    previous draft point, or a vertex's ring-neighbor), the classic
 *    "shift-to-draw-straight" CAD behavior, applied automatically instead of
 *    key-gated.
 * 4. **Angle increment** — relative to the same reference point, the nearest
 *    multiple of {@link ANGLE_SNAP_INCREMENT_DEGREES}.
 * 5. **Round distance** — relative to the same reference point, the nearest
 *    multiple of {@link ROUND_DISTANCE_INCREMENT_METRES}.
 *
 * Vertex is checked before edge so that a segment's own endpoint — which is
 * technically also "on" the edge — is always reported as a vertex snap, never
 * an edge snap at the same location. Vertex and edge are both checked before
 * any reference-relative snap because a precise existing point in the garden
 * is a stronger signal than a direction or distance guess. Horizontal/vertical
 * is checked before the general angle increment because 0/90/180/270 degrees
 * are a subset of every 45-degree multiple; without this order the more
 * specific "straight line" snap could never win on its own. Angle increment
 * is checked before round distance simply because direction is fixed by the
 * candidate's own position (nothing else to prefer), while distance rounding
 * only makes sense once the current draft direction is accepted as-is. None
 * of this ordering is mandated by the architecture doc — it does not specify
 * one — so it is recorded here for a future reviewer.
 *
 * Vertex/edge proximity tolerance is supplied by the caller in local metres,
 * derived from `SNAP_TOLERANCE_SCREEN_PIXELS` (`@verdery/geometry-contracts`)
 * at the active camera zoom — the same "constant visual tolerance converted
 * back to local space" the architecture doc describes for screen-space hit
 * testing (section "3.3 Screen Space"). The three reference-relative snaps
 * are about *direction* and *distance from a reference*, not screen
 * proximity, so their tolerances are fixed angle/metre constants below
 * instead of scaling with zoom.
 *
 * ## Advisory and can be disabled
 *
 * Every snap here only adjusts the position a caller was about to use —
 * `snapPosition` never throws, never blocks, and a candidate with no snap
 * within tolerance passes through unchanged. `SnapContext.disabled` lets a
 * caller suppress every snap for one gesture (see the call sites for which
 * modifier key drives it and why).
 *
 * ## Explicitly out of scope this pass
 *
 * - Whole-object move, resize, or rotate never call in here — only draft
 *   placement and single-vertex drag place or move one point at a time, which
 *   is what CAD-style point snapping targets. `shapes/transform-handles.tsx`
 *   (resize/rotate) and `shapes/object-shape.tsx` (whole-object move) are
 *   unchanged.
 * - The angle increment and distance rounding are fixed, named constants this
 *   pass, not a runtime settings UI — "configurable" is satisfied by these
 *   being isolated, named, easily-changed values.
 * - "Snapping disabled" is per-gesture only (hold the modifier for that one
 *   click/drag) — nothing here persists it.
 */

import { distanceBetween, type Geometry, type Position } from '@verdery/geometry-contracts';

import type { MapObjectRecord } from './types';

/** The nearest multiple of this many degrees a reference-relative candidate angle snaps to. Configurable by changing this one constant. */
export const ANGLE_SNAP_INCREMENT_DEGREES = 45;

/** How close (in degrees) a candidate's angle from the reference must be to a multiple of {@link ANGLE_SNAP_INCREMENT_DEGREES} (or to exactly horizontal/vertical) to snap. */
export const ANGLE_SNAP_TOLERANCE_DEGREES = 3;

/** The nearest multiple of this many metres a reference-relative candidate distance snaps to. Configurable by changing this one constant. */
export const ROUND_DISTANCE_INCREMENT_METRES = 0.5;

/** How close (in metres) a candidate's distance from the reference must be to a multiple of {@link ROUND_DISTANCE_INCREMENT_METRES} to snap. */
export const ROUND_DISTANCE_TOLERANCE_METRES = 0.05;

/** Two positions closer than this are the same point — guards the reference-relative snaps against an undefined direction when the candidate has not moved from the reference. */
const SAME_POINT_EPSILON_METRES = 0.001;

export type SnapKind = 'vertex' | 'edge' | 'horizontal' | 'vertical' | 'angle' | 'distance';

/** Which snap applied, for the caller's visual indicator. `position` is always the exact point the indicator should be drawn at. */
export interface SnapResult {
  readonly kind: SnapKind;
  readonly position: Position;
  /** The object whose vertex/edge the candidate snapped onto. Present only for `'vertex'`/`'edge'` — the reference-relative kinds have no single target object. */
  readonly targetObjectId?: string;
}

/** Identifies one vertex, to exclude it from being a candidate snap target for itself. */
export interface SnapVertexRef {
  readonly objectId: string;
  readonly ringIndex: number;
  readonly vertexIndex: number;
}

export interface SnapContext {
  /** Every object in the garden — the source of vertex and edge snap targets. */
  readonly objects: readonly MapObjectRecord[];
  /** The vertex currently being dragged, excluded from vertex targets so it cannot snap to its own not-yet-moved position. `null`/omitted during draft placement, where no vertex exists yet. */
  readonly excludeVertex?: SnapVertexRef | null;
  /** The point the three reference-relative snaps measure direction and distance from — the previous draft point, or the dragged vertex's ring-neighbor. `null`/omitted disables all three (e.g. a draft's first point has no reference). */
  readonly referencePoint?: Position | null;
  /** Local-metres proximity tolerance for the vertex and edge snaps. See the module doc comment for how callers derive this from screen pixels. */
  readonly toleranceMetres: number;
  /** True while the user holds the modifier that suppresses every snap for this one gesture. */
  readonly disabled?: boolean;
}

export interface SnapPositionResult {
  readonly position: Position;
  readonly snap: SnapResult | null;
}

interface VertexTarget {
  readonly objectId: string;
  readonly ringIndex: number;
  readonly vertexIndex: number;
  readonly position: Position;
}

interface EdgeTarget {
  readonly objectId: string;
  readonly a: Position;
  readonly b: Position;
}

/**
 * Every ring of a geometry, as position arrays — a `Point` yields its single
 * coordinate as a one-element ring, a `Polygon`/`MultiLineString` yields one
 * array per ring, and a `MultiPolygon` flattens every ring of every part into
 * the same list (mirroring `shapes/shape-geometry.ts`'s identically-named
 * helper). Duplicated here in full rather than imported, so this module has
 * no dependency on anything under `shapes/` — keeping "no Konva-adjacent
 * imports" a property of the whole module, not just its type signatures.
 */
function ringsOfGeometry(geometry: Geometry): readonly (readonly Position[])[] {
  switch (geometry.type) {
    case 'Point':
      return [[geometry.coordinates]];
    case 'LineString':
      return [geometry.coordinates];
    case 'MultiLineString':
      return geometry.coordinates;
    case 'Polygon':
      return geometry.coordinates;
    case 'MultiPolygon':
      return geometry.coordinates.flat();
  }
}

function activeObjects(objects: readonly MapObjectRecord[]): readonly MapObjectRecord[] {
  // Defensive rather than load-bearing: `queries.ts` already removes deleted
  // objects from the cache `MapObjectRecord[]` this module is normally called
  // with, so this rarely filters anything in practice.
  return objects.filter((object) => object.lifecycleState === 'active');
}

function collectVertexTargets(
  objects: readonly MapObjectRecord[],
  exclude: SnapVertexRef | null,
): readonly VertexTarget[] {
  const targets: VertexTarget[] = [];
  for (const object of activeObjects(objects)) {
    ringsOfGeometry(object.geometry).forEach((ring, ringIndex) => {
      ring.forEach((position, vertexIndex) => {
        if (
          exclude !== null &&
          exclude.objectId === object.id &&
          exclude.ringIndex === ringIndex &&
          exclude.vertexIndex === vertexIndex
        ) {
          return;
        }
        targets.push({ objectId: object.id, ringIndex, vertexIndex, position });
      });
    });
  }
  return targets;
}

function collectEdgeTargets(objects: readonly MapObjectRecord[]): readonly EdgeTarget[] {
  const targets: EdgeTarget[] = [];
  for (const object of activeObjects(objects)) {
    for (const ring of ringsOfGeometry(object.geometry)) {
      for (let index = 0; index < ring.length - 1; index += 1) {
        const a = ring[index];
        const b = ring[index + 1];
        if (a === undefined || b === undefined) {
          continue;
        }
        targets.push({ objectId: object.id, a, b });
      }
    }
  }
  return targets;
}

/** The nearest point on segment `[a, b]` to `point`, clamped to the segment. */
function projectOntoSegment(point: Position, a: Position, b: Position): Position {
  const abx = b[0] - a[0];
  const aby = b[1] - a[1];
  const lengthSquared = abx * abx + aby * aby;
  if (lengthSquared < SAME_POINT_EPSILON_METRES * SAME_POINT_EPSILON_METRES) {
    return a;
  }
  const t = ((point[0] - a[0]) * abx + (point[1] - a[1]) * aby) / lengthSquared;
  const clamped = Math.min(1, Math.max(0, t));
  return [a[0] + abx * clamped, a[1] + aby * clamped];
}

function angleDegreesBetween(from: Position, to: Position): number {
  return (Math.atan2(to[1] - from[1], to[0] - from[0]) * 180) / Math.PI;
}

function normalizeDegrees(value: number): number {
  const wrapped = value % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
}

/** The smaller of the two angular distances between two directions, always in `[0, 180]`. */
function angularDifference(a: number, b: number): number {
  const diff = Math.abs(normalizeDegrees(a) - normalizeDegrees(b));
  return Math.min(diff, 360 - diff);
}

/**
 * Snaps `candidate` onto the nearest vertex of any object in `objects`, when
 * one falls within `toleranceMetres`. Ties (equally-near vertices) resolve to
 * whichever the input order visits first.
 */
export function snapToVertex(
  candidate: Position,
  objects: readonly MapObjectRecord[],
  toleranceMetres: number,
  exclude: SnapVertexRef | null = null,
): SnapResult | null {
  let best: { readonly target: VertexTarget; readonly distance: number } | null = null;

  for (const target of collectVertexTargets(objects, exclude)) {
    const distance = distanceBetween(candidate, target.position);
    if (distance <= toleranceMetres && (best === null || distance < best.distance)) {
      best = { target, distance };
    }
  }

  return best === null
    ? null
    : { kind: 'vertex', position: best.target.position, targetObjectId: best.target.objectId };
}

/**
 * Snaps `candidate` onto the nearest point on any edge of any object in
 * `objects`, when that projected point falls within `toleranceMetres`. Does
 * not itself check for a closer vertex first — `snapPosition` is responsible
 * for trying {@link snapToVertex} first so a vertex always wins over an edge
 * at the same location; called on its own, this always prefers an edge.
 */
export function snapToEdge(
  candidate: Position,
  objects: readonly MapObjectRecord[],
  toleranceMetres: number,
): SnapResult | null {
  let best: {
    readonly objectId: string;
    readonly point: Position;
    readonly distance: number;
  } | null = null;

  for (const target of collectEdgeTargets(objects)) {
    const point = projectOntoSegment(candidate, target.a, target.b);
    const distance = distanceBetween(candidate, point);
    if (distance <= toleranceMetres && (best === null || distance < best.distance)) {
      best = { objectId: target.objectId, point, distance };
    }
  }

  return best === null
    ? null
    : { kind: 'edge', position: best.point, targetObjectId: best.objectId };
}

/**
 * The classic "hold shift to draw straight lines" snap: when the direction
 * from `reference` to `candidate` is within `toleranceDegrees` of exactly
 * horizontal or vertical, locks the matching axis to `reference`'s value and
 * leaves the other axis at `candidate`'s own value.
 */
export function snapToAxisAlignment(
  candidate: Position,
  reference: Position,
  toleranceDegrees: number = ANGLE_SNAP_TOLERANCE_DEGREES,
): SnapResult | null {
  if (distanceBetween(candidate, reference) < SAME_POINT_EPSILON_METRES) {
    return null;
  }

  const angle = angleDegreesBetween(reference, candidate);

  if (
    angularDifference(angle, 0) <= toleranceDegrees ||
    angularDifference(angle, 180) <= toleranceDegrees
  ) {
    return { kind: 'horizontal', position: [candidate[0], reference[1]] };
  }

  if (
    angularDifference(angle, 90) <= toleranceDegrees ||
    angularDifference(angle, 270) <= toleranceDegrees
  ) {
    return { kind: 'vertical', position: [reference[0], candidate[1]] };
  }

  return null;
}

/**
 * Snaps the direction from `reference` to `candidate` onto the nearest
 * multiple of `incrementDegrees`, when within `toleranceDegrees` of it,
 * preserving `candidate`'s distance from `reference`.
 */
export function snapToAngleIncrement(
  candidate: Position,
  reference: Position,
  incrementDegrees: number = ANGLE_SNAP_INCREMENT_DEGREES,
  toleranceDegrees: number = ANGLE_SNAP_TOLERANCE_DEGREES,
): SnapResult | null {
  const distance = distanceBetween(candidate, reference);
  if (distance < SAME_POINT_EPSILON_METRES) {
    return null;
  }

  const angle = angleDegreesBetween(reference, candidate);
  const nearestMultiple = Math.round(angle / incrementDegrees) * incrementDegrees;
  if (angularDifference(angle, nearestMultiple) > toleranceDegrees) {
    return null;
  }

  const rad = (nearestMultiple * Math.PI) / 180;
  return {
    kind: 'angle',
    position: [reference[0] + distance * Math.cos(rad), reference[1] + distance * Math.sin(rad)],
  };
}

/**
 * Snaps the distance from `reference` to `candidate` onto the nearest
 * multiple of `incrementMetres`, when within `toleranceMetres` of it,
 * preserving `candidate`'s angle from `reference`. Never snaps onto zero
 * distance — that would collapse the candidate onto the reference itself,
 * not express a "known measurement".
 */
export function snapToRoundDistance(
  candidate: Position,
  reference: Position,
  incrementMetres: number = ROUND_DISTANCE_INCREMENT_METRES,
  toleranceMetres: number = ROUND_DISTANCE_TOLERANCE_METRES,
): SnapResult | null {
  const distance = distanceBetween(candidate, reference);
  const nearestRounded = Math.round(distance / incrementMetres) * incrementMetres;
  if (nearestRounded <= 0 || Math.abs(distance - nearestRounded) > toleranceMetres) {
    return null;
  }

  const rad = (angleDegreesBetween(reference, candidate) * Math.PI) / 180;
  return {
    kind: 'distance',
    position: [
      reference[0] + nearestRounded * Math.cos(rad),
      reference[1] + nearestRounded * Math.sin(rad),
    ],
  };
}

/**
 * Tries every snap kind against `candidate` in the priority order documented
 * in this module's doc comment, and returns the first match. Returns
 * `candidate` unchanged, with `snap: null`, when nothing is within tolerance
 * or `context.disabled` is true.
 */
export function snapPosition(candidate: Position, context: SnapContext): SnapPositionResult {
  if (context.disabled === true) {
    return { position: candidate, snap: null };
  }

  const vertexSnap = snapToVertex(
    candidate,
    context.objects,
    context.toleranceMetres,
    context.excludeVertex ?? null,
  );
  if (vertexSnap !== null) {
    return { position: vertexSnap.position, snap: vertexSnap };
  }

  const edgeSnap = snapToEdge(candidate, context.objects, context.toleranceMetres);
  if (edgeSnap !== null) {
    return { position: edgeSnap.position, snap: edgeSnap };
  }

  const reference = context.referencePoint ?? null;
  if (reference !== null) {
    const axisSnap = snapToAxisAlignment(candidate, reference);
    if (axisSnap !== null) {
      return { position: axisSnap.position, snap: axisSnap };
    }

    const angleSnap = snapToAngleIncrement(candidate, reference);
    if (angleSnap !== null) {
      return { position: angleSnap.position, snap: angleSnap };
    }

    const distanceSnap = snapToRoundDistance(candidate, reference);
    if (distanceSnap !== null) {
      return { position: distanceSnap.position, snap: distanceSnap };
    }
  }

  return { position: candidate, snap: null };
}
