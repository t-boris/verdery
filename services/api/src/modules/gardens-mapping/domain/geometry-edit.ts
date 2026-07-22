/**
 * Geometry mutation primitives shared by the move, vertex-editing, split,
 * join, and duplicate map commands.
 *
 * Deliberately narrow: PostGIS's `ST_IsValid` check (already enforced by the
 * `garden_object_geometry_valid_check` constraint, and pre-checked client-side
 * by `application/validate-map-geometry.ts` via
 * `@verdery/geometry-contracts`'s own `validateGeometry`) is the authority on
 * whether a *resulting* geometry is acceptable. These functions only handle
 * index bookkeeping and reject inputs that cannot even be interpreted — an
 * out-of-range vertex index, a ring that does not exist — not topological
 * invariants such as polygon ring closure, which the validity check catches
 * downstream.
 *
 * MultiPolygon vertex editing is out of scope for the foundation release,
 * matching the identical note in
 * packages/geometry-contracts/src/inverse-command.ts.
 *
 * Source: architecture/map-rendering-and-editing.md, section
 * "7. Editor Command Model".
 */

import { SharedErrorCode } from '@verdery/api-contracts';
import type { Geometry, Position, VertexOperation } from '@verdery/geometry-contracts';
import { ValidationError } from '../../../platform/errors/application-error.js';

function invalid(code: string, message: string): ValidationError {
  return new ValidationError(SharedErrorCode.RequestInvalid, message, {
    details: [{ code, pointer: '/payload' }],
  });
}

/** Translates every position in a geometry by a fixed offset, in local metres. */
export function translateGeometry(geometry: Geometry, dx: number, dy: number): Geometry {
  const move = (position: Position): Position => [position[0] + dx, position[1] + dy];

  switch (geometry.type) {
    case 'Point':
      return { type: 'Point', coordinates: move(geometry.coordinates) };
    case 'LineString':
      return { type: 'LineString', coordinates: geometry.coordinates.map(move) };
    case 'MultiLineString':
      return {
        type: 'MultiLineString',
        coordinates: geometry.coordinates.map((line) => line.map(move)),
      };
    case 'Polygon':
      return { type: 'Polygon', coordinates: geometry.coordinates.map((ring) => ring.map(move)) };
    case 'MultiPolygon':
      return {
        type: 'MultiPolygon',
        coordinates: geometry.coordinates.map((polygon) => polygon.map((ring) => ring.map(move))),
      };
  }
}

interface RingAccess {
  readonly ring: readonly Position[];
  readonly rebuild: (ring: readonly Position[]) => Geometry;
}

/** Resolves which position array `ringIndex` addresses for a given geometry, and how to rebuild the geometry once that array changes. */
function resolveRing(geometry: Geometry, ringIndex: number): RingAccess {
  switch (geometry.type) {
    case 'Point':
      if (ringIndex !== 0) {
        throw invalid('map.edit_vertex.ring_out_of_range', 'A Point geometry has only ring 0.');
      }
      return {
        ring: [geometry.coordinates],
        rebuild: (ring) => {
          // Strictly one vertex, not merely "the first one": this is what
          // makes `insert` (which would grow the ring to two) and `remove`
          // (which would shrink it to zero) fail loudly instead of silently
          // discarding the extra or missing vertex.
          const only = ring[0];
          if (ring.length !== 1 || only === undefined) {
            throw invalid(
              'map.edit_vertex.point_requires_one_vertex',
              'A Point geometry only supports the move operation — it must keep exactly one vertex.',
            );
          }
          return { type: 'Point', coordinates: only };
        },
      };

    case 'LineString':
      if (ringIndex !== 0) {
        throw invalid(
          'map.edit_vertex.ring_out_of_range',
          'A LineString geometry has only ring 0.',
        );
      }
      return {
        ring: geometry.coordinates,
        rebuild: (ring) => ({ type: 'LineString', coordinates: ring }),
      };

    case 'MultiLineString': {
      const line = geometry.coordinates[ringIndex];
      if (line === undefined) {
        throw invalid('map.edit_vertex.ring_out_of_range', 'No line exists at this ring index.');
      }
      return {
        ring: line,
        rebuild: (ring) => ({
          type: 'MultiLineString',
          coordinates: geometry.coordinates.map((existing, index) =>
            index === ringIndex ? ring : existing,
          ),
        }),
      };
    }

    case 'Polygon': {
      const ring = geometry.coordinates[ringIndex];
      if (ring === undefined) {
        throw invalid('map.edit_vertex.ring_out_of_range', 'No ring exists at this ring index.');
      }
      return {
        ring,
        rebuild: (updated) => ({
          type: 'Polygon',
          coordinates: geometry.coordinates.map((existing, index) =>
            index === ringIndex ? updated : existing,
          ),
        }),
      };
    }

    case 'MultiPolygon':
      throw invalid(
        'map.edit_vertex.multi_polygon_unsupported',
        'Vertex-level editing of a MultiPolygon geometry is not supported yet.',
      );
  }
}

/** Applies one `editVertex` command operation, returning the resulting geometry. */
export function applyVertexOperation(
  geometry: Geometry,
  ringIndex: number,
  vertexIndex: number,
  operation: VertexOperation,
  position: Position | undefined,
): Geometry {
  const { ring, rebuild } = resolveRing(geometry, ringIndex);

  switch (operation) {
    case 'insert': {
      if (position === undefined) {
        throw invalid('map.edit_vertex.position_required', 'position is required for insert.');
      }
      if (vertexIndex < 0 || vertexIndex > ring.length) {
        throw invalid('map.edit_vertex.vertex_out_of_range', 'vertexIndex is out of range.');
      }
      const next = [...ring];
      next.splice(vertexIndex, 0, position);
      return rebuild(next);
    }

    case 'move': {
      if (position === undefined) {
        throw invalid('map.edit_vertex.position_required', 'position is required for move.');
      }
      if (vertexIndex < 0 || vertexIndex >= ring.length) {
        throw invalid('map.edit_vertex.vertex_out_of_range', 'vertexIndex is out of range.');
      }
      const next = [...ring];
      next[vertexIndex] = position;
      return rebuild(next);
    }

    case 'remove': {
      if (vertexIndex < 0 || vertexIndex >= ring.length) {
        throw invalid('map.edit_vertex.vertex_out_of_range', 'vertexIndex is out of range.');
      }
      const next = [...ring];
      next.splice(vertexIndex, 1);
      return rebuild(next);
    }
  }
}

/**
 * Splits a LineString into two LineStrings at `atVertexIndex`, which becomes
 * the last vertex of the first piece and the first vertex of the second.
 * Only LineString is supported this pass — see the module doc comment for
 * why MultiLineString/Polygon splitting is not attempted here.
 */
export function splitLineString(geometry: Geometry, atVertexIndex: number): [Geometry, Geometry] {
  if (geometry.type !== 'LineString') {
    throw invalid(
      'map.split_linework.requires_line_string',
      'splitLinework requires a LineString geometry.',
    );
  }

  const positions = geometry.coordinates;
  if (atVertexIndex <= 0 || atVertexIndex >= positions.length - 1) {
    throw invalid(
      'map.split_linework.vertex_out_of_range',
      'atVertexIndex must be an interior vertex of the line.',
    );
  }

  return [
    { type: 'LineString', coordinates: positions.slice(0, atVertexIndex + 1) },
    { type: 'LineString', coordinates: positions.slice(atVertexIndex) },
  ];
}

/**
 * Joins two LineStrings into one, in the order given. When the first line's
 * last position coincides exactly with the second line's first position, the
 * duplicate join vertex is dropped; otherwise the two are concatenated as-is
 * and the resulting geometry's own validity check is what catches a
 * meaningfully disjoint join.
 */
export function joinLineStrings(first: Geometry, second: Geometry): Geometry {
  if (first.type !== 'LineString' || second.type !== 'LineString') {
    throw invalid(
      'map.join_linework.requires_line_string',
      'joinLinework requires two LineString geometries.',
    );
  }

  const firstPositions = first.coordinates;
  const secondPositions = second.coordinates;
  const lastOfFirst = firstPositions[firstPositions.length - 1];
  const firstOfSecond = secondPositions[0];

  const overlaps =
    lastOfFirst !== undefined &&
    firstOfSecond !== undefined &&
    lastOfFirst[0] === firstOfSecond[0] &&
    lastOfFirst[1] === firstOfSecond[1];

  return {
    type: 'LineString',
    coordinates: overlaps
      ? [...firstPositions, ...secondPositions.slice(1)]
      : [...firstPositions, ...secondPositions],
  };
}
