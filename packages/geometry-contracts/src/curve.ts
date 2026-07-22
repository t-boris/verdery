/**
 * Curve metadata and densification.
 *
 * A curved bed edge or path persists in two parts: an ordinary densified
 * LineString or Polygon that every spatial function and GeoJSON consumer
 * understands, plus this metadata so the curve stays editable as a curve.
 *
 * Consumers that ignore `CurveMetadata` still receive correct geometry.
 *
 * Source: ADR-0010, "Curve persistence".
 */

import type { Position } from './geometry.js';
import { roundPosition } from './rounding.js';
import { MAXIMUM_CHORD_DEVIATION_METRES } from './tolerances.js';

/** The only curve family the foundation release persists. */
export type CurveKind = 'cubicBezier';

/**
 * Control points for a curve that was densified into stored geometry.
 *
 * A cubic Bézier chain of n segments has 3n + 1 control points: each segment
 * contributes two handles and an end point, sharing its start point with the
 * previous segment.
 */
export interface CurveMetadata {
  readonly kind: CurveKind;
  readonly controlPoints: readonly Position[];
  /** Chord deviation used when the stored polyline was produced, in metres. */
  readonly chordDeviationMetres: number;
}

/** True when a control-point count can form a closed cubic Bézier chain. */
export function isValidControlPointCount(count: number): boolean {
  return count >= 4 && (count - 1) % 3 === 0;
}

/** Number of cubic segments implied by a control-point list. */
export function segmentCount(controlPoints: readonly Position[]): number {
  return (controlPoints.length - 1) / 3;
}

/**
 * Recursion limit for adaptive subdivision.
 *
 * Depth 16 permits 65 536 segments per cubic, far beyond anything a garden
 * needs. It exists so that a pathological or degenerate curve terminates rather
 * than exhausting the stack.
 */
const MAXIMUM_SUBDIVISION_DEPTH = 16;

function midpoint(from: Position, to: Position): Position {
  return [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2];
}

/**
 * Greatest distance from the two interior control points to the chord.
 *
 * A Bézier curve lies inside the convex hull of its control points, so this is
 * a true upper bound on how far the curve departs from its chord. That makes it
 * safe as a flatness test: if this bound is within tolerance, the real curve is
 * too.
 */
function chordDeviationBound(p0: Position, p1: Position, p2: Position, p3: Position): number {
  const chordX = p3[0] - p0[0];
  const chordY = p3[1] - p0[1];
  const chordLength = Math.hypot(chordX, chordY);

  if (chordLength === 0) {
    return Math.max(
      Math.hypot(p1[0] - p0[0], p1[1] - p0[1]),
      Math.hypot(p2[0] - p0[0], p2[1] - p0[1]),
    );
  }

  const distanceToChord = (point: Position): number =>
    Math.abs(chordX * (p0[1] - point[1]) - (p0[0] - point[0]) * chordY) / chordLength;

  return Math.max(distanceToChord(p1), distanceToChord(p2));
}

/**
 * Splits a cubic segment until every piece is flat within tolerance, appending
 * each piece's end point.
 *
 * Uses de Casteljau subdivision at the midpoint. Subdivision is driven by the
 * convex-hull bound rather than by a fixed step count, because a fixed count
 * distributes error unevenly on S-shaped segments and can exceed the tolerance
 * even when the average error looks acceptable.
 *
 * All arithmetic is halving and averaging in IEEE 754 double precision, so the
 * split points are bit-identical in every runtime.
 */
function subdivideCubic(
  p0: Position,
  p1: Position,
  p2: Position,
  p3: Position,
  toleranceMetres: number,
  depth: number,
  output: Position[],
): void {
  if (
    depth >= MAXIMUM_SUBDIVISION_DEPTH ||
    chordDeviationBound(p0, p1, p2, p3) <= toleranceMetres
  ) {
    output.push(p3);
    return;
  }

  const p01 = midpoint(p0, p1);
  const p12 = midpoint(p1, p2);
  const p23 = midpoint(p2, p3);
  const p012 = midpoint(p01, p12);
  const p123 = midpoint(p12, p23);
  const middle = midpoint(p012, p123);

  subdivideCubic(p0, p01, p012, middle, toleranceMetres, depth + 1, output);
  subdivideCubic(middle, p123, p23, p3, toleranceMetres, depth + 1, output);
}

/**
 * Densifies a cubic Bézier chain into the polyline that is persisted.
 *
 * Subdivision runs in exact arithmetic and rounding is applied once, at output,
 * so the returned polyline is exactly what the database will hold. Rounding can
 * move a vertex by at most half the storage grid diagonal (about 0.71 mm), so
 * the effective deviation from the true curve is the tolerance plus that
 * rounding — well inside the 10 mm contract for any garden-scale curve.
 *
 * Consecutive vertices that collapse onto the same grid point are dropped, so
 * the result never contains a zero-length segment.
 *
 * @throws {RangeError} when the control-point count cannot form a cubic chain,
 *   or when the tolerance is not positive.
 */
export function densifyCubicChain(
  controlPoints: readonly Position[],
  toleranceMetres: number = MAXIMUM_CHORD_DEVIATION_METRES,
): Position[] {
  if (!isValidControlPointCount(controlPoints.length)) {
    throw new RangeError(
      `A cubic Bézier chain needs 3n + 1 control points, received ${String(controlPoints.length)}.`,
    );
  }

  if (!(toleranceMetres > 0)) {
    throw new RangeError(
      `Chord deviation tolerance must be positive, received ${String(toleranceMetres)}.`,
    );
  }

  const exact: Position[] = [controlPoints[0] as Position];

  for (let segment = 0; segment < segmentCount(controlPoints); segment += 1) {
    const base = segment * 3;
    subdivideCubic(
      controlPoints[base] as Position,
      controlPoints[base + 1] as Position,
      controlPoints[base + 2] as Position,
      controlPoints[base + 3] as Position,
      toleranceMetres,
      0,
      exact,
    );
  }

  const polyline: Position[] = [];

  for (const position of exact) {
    const rounded = roundPosition(position);
    const previous = polyline[polyline.length - 1];

    if (previous === undefined || previous[0] !== rounded[0] || previous[1] !== rounded[1]) {
      polyline.push(rounded);
    }
  }

  return polyline;
}
