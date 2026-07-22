/**
 * Structural GeoJSON parsing, matching the `Geometry` `oneOf` in
 * `packages/api-contracts/openapi.yaml`.
 *
 * Deliberately shallow: this only confirms the shape is well-formed enough to
 * become a `@verdery/geometry-contracts` `Geometry` value (right `type`
 * literal, coordinates nested to the right depth, every number finite) —
 * domain validity (minimum vertex counts, ring closure, self-intersection,
 * coordinate magnitude) is `application/validate-map-geometry.ts`'s job, and
 * PostGIS's own `ST_IsValid` check is the final authority. See that module's
 * doc comment.
 */

import type { Geometry, Position } from '@verdery/geometry-contracts';
import { invalid } from './garden-routes.js';

function requirePosition(value: unknown, pointer: string): Position {
  if (
    !Array.isArray(value) ||
    value.length !== 2 ||
    typeof value[0] !== 'number' ||
    typeof value[1] !== 'number' ||
    !Number.isFinite(value[0]) ||
    !Number.isFinite(value[1])
  ) {
    throw invalid(
      `${pointer} must be a [x, y] coordinate pair of finite numbers.`,
      'request.geometry.position.invalid',
      pointer,
    );
  }
  return [value[0], value[1]];
}

function requirePositionArray(value: unknown, pointer: string): Position[] {
  if (!Array.isArray(value)) {
    throw invalid(`${pointer} must be an array of positions.`, 'request.geometry.invalid', pointer);
  }
  return value.map((item, index) => requirePosition(item, `${pointer}/${String(index)}`));
}

function requireRingArray(value: unknown, pointer: string): Position[][] {
  if (!Array.isArray(value)) {
    throw invalid(`${pointer} must be an array of rings.`, 'request.geometry.invalid', pointer);
  }
  return value.map((item, index) => requirePositionArray(item, `${pointer}/${String(index)}`));
}

export function requireGeometry(value: unknown, pointer: string): Geometry {
  if (typeof value !== 'object' || value === null) {
    throw invalid(
      `${pointer} must be a GeoJSON geometry object.`,
      'request.geometry.invalid',
      pointer,
    );
  }

  const type = (value as { type?: unknown }).type;
  const coordinates = (value as { coordinates?: unknown }).coordinates;
  const coordinatesPointer = `${pointer}/coordinates`;

  switch (type) {
    case 'Point':
      return { type: 'Point', coordinates: requirePosition(coordinates, coordinatesPointer) };
    case 'LineString':
      return {
        type: 'LineString',
        coordinates: requirePositionArray(coordinates, coordinatesPointer),
      };
    case 'MultiLineString':
      return {
        type: 'MultiLineString',
        coordinates: requireRingArray(coordinates, coordinatesPointer),
      };
    case 'Polygon':
      return { type: 'Polygon', coordinates: requireRingArray(coordinates, coordinatesPointer) };
    case 'MultiPolygon': {
      if (!Array.isArray(coordinates)) {
        throw invalid(
          `${coordinatesPointer} must be an array of polygons.`,
          'request.geometry.invalid',
          coordinatesPointer,
        );
      }
      return {
        type: 'MultiPolygon',
        coordinates: coordinates.map((polygon, index) =>
          requireRingArray(polygon, `${coordinatesPointer}/${String(index)}`),
        ),
      };
    }
    default:
      throw invalid(
        `${pointer}/type must be one of Point, LineString, Polygon, MultiLineString, MultiPolygon.`,
        'request.geometry.type.invalid',
        `${pointer}/type`,
      );
  }
}

export function requireOptionalGeometry(value: unknown, pointer: string): Geometry | undefined {
  return value === undefined ? undefined : requireGeometry(value, pointer);
}
