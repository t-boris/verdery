/**
 * Pure geometry-to-screen conversion shared by every shape component.
 *
 * Kept free of Konva and React imports on purpose: this is where a garden
 * object's canonical local-metres geometry becomes flat pixel arrays, the
 * one place that would need to change if the renderer were ever swapped —
 * see `architecture/map-rendering-and-editing.md`, section
 * "15. Provider Independence" ("Rendering libraries can be replaced without
 * migrating domain data").
 */

import { positionsOf, type Geometry, type Position } from '@verdery/geometry-contracts';

import type { CanvasSize, MapCamera } from '../types';
import { boundingBoxOfPositions, toScreen } from '../viewport';

/** Flat `[x0, y0, x1, y1, ...]` array, Konva `Line`'s `points` format. */
export function ringToPoints(
  ring: readonly Position[],
  camera: MapCamera,
  size: CanvasSize,
): number[] {
  const points: number[] = [];
  for (const position of ring) {
    const screen = toScreen(position, camera, size);
    points.push(screen.x, screen.y);
  }
  return points;
}

/** A representative screen point for a label glyph: the geometry's bounding-box center. */
export function labelAnchor(
  positions: readonly Position[],
  camera: MapCamera,
  size: CanvasSize,
): { readonly x: number; readonly y: number } {
  const box = boundingBoxOfPositions(positions);
  if (box === null) {
    return toScreen([0, 0], camera, size);
  }
  return toScreen([(box.minX + box.maxX) / 2, (box.minY + box.maxY) / 2], camera, size);
}

/**
 * Every polygon ring or line-string that makes up a geometry, as position
 * arrays — a `Polygon` yields one ring per array entry (exterior first, then
 * holes), a `MultiPolygon`/`MultiLineString` flattens every part into the
 * same list, and a `Point` yields its single position as a one-element "ring"
 * for callers (like `labelAnchor`) that only need a representative point.
 */
export function ringsOf(geometry: Geometry): readonly (readonly Position[])[] {
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

export { positionsOf };
