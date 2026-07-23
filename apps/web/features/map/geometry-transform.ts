/**
 * Pure geometry math for whole-shape resize and rotate transforms.
 *
 * `resize` and `rotate` gestures both commit as a single `ReplaceGeometryPayload`
 * — see `@verdery/geometry-contracts`'s `command.ts` module doc comment: "the
 * domain does not care how a client derived a new shape, only what it is."
 * These functions compute that new shape once, on gesture end, never per
 * animation frame — kept free of Konva and React so the math is trivially
 * unit-testable, matching `shapes/shape-geometry.ts`'s own separation of pure
 * geometry conversion from rendering.
 *
 * The anchor for both operations is the shape's axis-aligned bounding-box
 * center, not its area centroid — a deliberate simplification that keeps the
 * anchor identical to where the corner/rotate handles themselves are laid
 * out, so what the user sees the handles orbit around is exactly what the
 * math uses.
 */

import type { Geometry, Position } from '@verdery/geometry-contracts';

import { boundingBoxOfPositions, type BoundingBox } from './viewport';

/** The bounding-box center of a set of positions, or `null` when there are none. */
export function boundingBoxCentroid(positions: readonly Position[]): Position | null {
  const box = boundingBoxOfPositions(positions);
  return box === null ? null : centerOf(box);
}

function centerOf(box: BoundingBox): Position {
  return [(box.minX + box.maxX) / 2, (box.minY + box.maxY) / 2];
}

/** Scales one position around `centroid` by independent x/y factors. */
export function scalePosition(
  position: Position,
  centroid: Position,
  scaleX: number,
  scaleY: number,
): Position {
  return [
    centroid[0] + (position[0] - centroid[0]) * scaleX,
    centroid[1] + (position[1] - centroid[1]) * scaleY,
  ];
}

/** Rotates one position around `centroid` by `angleRadians`, counterclockwise in local space. */
export function rotatePosition(
  position: Position,
  centroid: Position,
  angleRadians: number,
): Position {
  const dx = position[0] - centroid[0];
  const dy = position[1] - centroid[1];
  const cos = Math.cos(angleRadians);
  const sin = Math.sin(angleRadians);
  return [centroid[0] + dx * cos - dy * sin, centroid[1] + dx * sin + dy * cos];
}

function mapGeometryPositions(
  geometry: Geometry,
  transform: (position: Position) => Position,
): Geometry {
  switch (geometry.type) {
    case 'Point':
      return { type: 'Point', coordinates: transform(geometry.coordinates) };
    case 'LineString':
      return { type: 'LineString', coordinates: geometry.coordinates.map(transform) };
    case 'MultiLineString':
      return {
        type: 'MultiLineString',
        coordinates: geometry.coordinates.map((line) => line.map(transform)),
      };
    case 'Polygon':
      return {
        type: 'Polygon',
        coordinates: geometry.coordinates.map((ring) => ring.map(transform)),
      };
    case 'MultiPolygon':
      return {
        type: 'MultiPolygon',
        coordinates: geometry.coordinates.map((polygon) =>
          polygon.map((ring) => ring.map(transform)),
        ),
      };
  }
}

/** Scales every position in `geometry` around `centroid` by independent x/y factors. */
export function scaleGeometry(
  geometry: Geometry,
  centroid: Position,
  scaleX: number,
  scaleY: number,
): Geometry {
  return mapGeometryPositions(geometry, (position) =>
    scalePosition(position, centroid, scaleX, scaleY),
  );
}

/** Rotates every position in `geometry` around `centroid` by `angleRadians`. */
export function rotateGeometry(
  geometry: Geometry,
  centroid: Position,
  angleRadians: number,
): Geometry {
  return mapGeometryPositions(geometry, (position) =>
    rotatePosition(position, centroid, angleRadians),
  );
}

/**
 * A scale factor computed from how far a dragged corner handle moved,
 * relative to its distance from the anchor before the drag started. Clamped
 * away from zero so a handle dragged onto the anchor cannot collapse or
 * invert the shape.
 */
export function cornerScaleFactor(
  anchor: number,
  originalCorner: number,
  draggedCorner: number,
): number {
  const originalOffset = originalCorner - anchor;
  const MIN_OFFSET = 1e-6;
  if (Math.abs(originalOffset) < MIN_OFFSET) {
    return 1;
  }
  const factor = (draggedCorner - anchor) / originalOffset;
  const MIN_ABS_FACTOR = 0.05;
  if (Math.abs(factor) < MIN_ABS_FACTOR) {
    return factor < 0 ? -MIN_ABS_FACTOR : MIN_ABS_FACTOR;
  }
  return factor;
}

/** The angle in radians between two vectors from a shared origin, positive counterclockwise. */
export function angleBetween(origin: Position, from: Position, to: Position): number {
  const fromAngle = Math.atan2(from[1] - origin[1], from[0] - origin[0]);
  const toAngle = Math.atan2(to[1] - origin[1], to[0] - origin[0]);
  return toAngle - fromAngle;
}
