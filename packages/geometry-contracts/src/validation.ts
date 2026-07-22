/**
 * Shared geometry validation.
 *
 * Clients run these checks for immediate feedback; the server runs the same
 * checks and is authoritative. Both use this module so a warning never appears
 * on one surface and not the other.
 *
 * Issue codes are stable and are what clients localize against. Warnings do not
 * block a save unless the rule protects data integrity.
 *
 * Source: architecture/map-rendering-and-editing.md, section "11. Validation".
 */

import type { Geometry, Position } from './geometry.js';
import { positionsOf } from './geometry.js';
import { roundCoordinate } from './rounding.js';
import {
  MAXIMUM_COORDINATE_MAGNITUDE_METRES,
  MINIMUM_LINE_LENGTH_METRES,
  MINIMUM_LINE_VERTEX_COUNT,
  MINIMUM_POLYGON_AREA_SQUARE_METRES,
  MINIMUM_RING_VERTEX_COUNT,
  VERTEX_EPSILON_METRES,
} from './tolerances.js';

export type ValidationSeverity = 'error' | 'warning';

/** A stable, localizable validation outcome. */
export interface ValidationIssue {
  readonly code: string;
  readonly severity: ValidationSeverity;
  /** Values interpolated into the localized message. Never free-form prose. */
  readonly parameters?: Readonly<Record<string, number | string>>;
}

function error(code: string, parameters?: Record<string, number | string>): ValidationIssue {
  return parameters === undefined ? { code, severity: 'error' } : { code, severity: 'error', parameters };
}

/** Distance between two positions in metres. */
export function distanceBetween(from: Position, to: Position): number {
  return Math.hypot(to[0] - from[0], to[1] - from[1]);
}

/** Signed area of a ring by the shoelace formula. Positive means counter-clockwise. */
export function signedRingArea(ring: readonly Position[]): number {
  let total = 0;

  for (let index = 0; index < ring.length - 1; index += 1) {
    const current = ring[index] as Position;
    const next = ring[index + 1] as Position;
    total += current[0] * next[1] - next[0] * current[1];
  }

  return total / 2;
}

/** Absolute area of a ring in square metres. */
export function ringArea(ring: readonly Position[]): number {
  return Math.abs(signedRingArea(ring));
}

/** Total length of a polyline in metres. */
export function lineLength(line: readonly Position[]): number {
  let total = 0;

  for (let index = 0; index < line.length - 1; index += 1) {
    total += distanceBetween(line[index] as Position, line[index + 1] as Position);
  }

  return total;
}

function positionsCoincide(left: Position, right: Position): boolean {
  return distanceBetween(left, right) <= VERTEX_EPSILON_METRES;
}

function segmentsIntersect(a1: Position, a2: Position, b1: Position, b2: Position): boolean {
  const orientation = (p: Position, q: Position, r: Position): number => {
    const value = (q[1] - p[1]) * (r[0] - q[0]) - (q[0] - p[0]) * (r[1] - q[1]);
    if (Math.abs(value) < Number.EPSILON) {
      return 0;
    }
    return value > 0 ? 1 : 2;
  };

  const onSegment = (p: Position, q: Position, r: Position): boolean =>
    q[0] <= Math.max(p[0], r[0]) &&
    q[0] >= Math.min(p[0], r[0]) &&
    q[1] <= Math.max(p[1], r[1]) &&
    q[1] >= Math.min(p[1], r[1]);

  const o1 = orientation(a1, a2, b1);
  const o2 = orientation(a1, a2, b2);
  const o3 = orientation(b1, b2, a1);
  const o4 = orientation(b1, b2, a2);

  if (o1 !== o2 && o3 !== o4) {
    return true;
  }

  if (o1 === 0 && onSegment(a1, b1, a2)) return true;
  if (o2 === 0 && onSegment(a1, b2, a2)) return true;
  if (o3 === 0 && onSegment(b1, a1, b2)) return true;
  if (o4 === 0 && onSegment(b1, a2, b2)) return true;

  return false;
}

/**
 * True when a ring crosses itself.
 *
 * Adjacent segments share a vertex by construction and are skipped, as are the
 * first and last segments of a closed ring.
 */
export function ringSelfIntersects(ring: readonly Position[]): boolean {
  const segments = ring.length - 1;

  for (let i = 0; i < segments; i += 1) {
    for (let j = i + 2; j < segments; j += 1) {
      if (i === 0 && j === segments - 1) {
        continue;
      }

      if (
        segmentsIntersect(
          ring[i] as Position,
          ring[i + 1] as Position,
          ring[j] as Position,
          ring[j + 1] as Position,
        )
      ) {
        return true;
      }
    }
  }

  return false;
}

function validatePositions(geometry: Geometry): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  for (const position of positionsOf(geometry)) {
    for (const value of position) {
      if (!Number.isFinite(value)) {
        issues.push(error('geometry.coordinate.not_finite'));
        return issues;
      }

      if (Math.abs(value) > MAXIMUM_COORDINATE_MAGNITUDE_METRES) {
        issues.push(
          error('geometry.coordinate.out_of_range', {
            value: roundCoordinate(
              Math.sign(value) * Math.min(Math.abs(value), MAXIMUM_COORDINATE_MAGNITUDE_METRES),
            ),
            limitMetres: MAXIMUM_COORDINATE_MAGNITUDE_METRES,
          }),
        );
        return issues;
      }
    }
  }

  return issues;
}

function validateRing(ring: readonly Position[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (ring.length < MINIMUM_RING_VERTEX_COUNT) {
    issues.push(
      error('geometry.polygon.too_few_vertices', { minimum: MINIMUM_RING_VERTEX_COUNT, actual: ring.length }),
    );
    return issues;
  }

  const first = ring[0] as Position;
  const last = ring[ring.length - 1] as Position;

  if (!positionsCoincide(first, last)) {
    issues.push(error('geometry.polygon.not_closed'));
    return issues;
  }

  if (ringSelfIntersects(ring)) {
    issues.push(error('geometry.polygon.self_intersects'));
  }

  const area = ringArea(ring);
  if (area < MINIMUM_POLYGON_AREA_SQUARE_METRES) {
    issues.push(
      error('geometry.polygon.below_minimum_area', {
        minimumSquareMetres: MINIMUM_POLYGON_AREA_SQUARE_METRES,
      }),
    );
  }

  return issues;
}

function validateLine(line: readonly Position[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (line.length < MINIMUM_LINE_VERTEX_COUNT) {
    issues.push(
      error('geometry.line.too_few_vertices', { minimum: MINIMUM_LINE_VERTEX_COUNT, actual: line.length }),
    );
    return issues;
  }

  if (lineLength(line) < MINIMUM_LINE_LENGTH_METRES) {
    issues.push(error('geometry.line.below_minimum_length', { minimumMetres: MINIMUM_LINE_LENGTH_METRES }));
  }

  return issues;
}

/**
 * Validates a geometry against the shared tolerances.
 *
 * Returns every issue found rather than stopping at the first, so a client can
 * present a complete list. An empty array means the geometry is acceptable.
 */
export function validateGeometry(geometry: Geometry): ValidationIssue[] {
  const positionIssues = validatePositions(geometry);
  if (positionIssues.length > 0) {
    return positionIssues;
  }

  switch (geometry.type) {
    case 'Point':
      return [];

    case 'LineString':
      return validateLine(geometry.coordinates);

    case 'MultiLineString':
      if (geometry.coordinates.length === 0) {
        return [error('geometry.empty')];
      }
      return geometry.coordinates.flatMap(validateLine);

    case 'Polygon':
      if (geometry.coordinates.length === 0) {
        return [error('geometry.empty')];
      }
      return geometry.coordinates.flatMap(validateRing);

    case 'MultiPolygon':
      if (geometry.coordinates.length === 0) {
        return [error('geometry.empty')];
      }
      return geometry.coordinates.flatMap((polygon) => polygon.flatMap(validateRing));
  }
}

/** True when a geometry has no blocking issues. */
export function isGeometryValid(geometry: Geometry): boolean {
  return validateGeometry(geometry).every((issue) => issue.severity !== 'error');
}
