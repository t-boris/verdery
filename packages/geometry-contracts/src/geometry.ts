/**
 * Canonical geometry types.
 *
 * These mirror the GeoJSON geometry object but are always transported inside an
 * envelope that names the coordinate space, because GeoJSON alone cannot say
 * whether coordinates are local metres or longitude/latitude.
 *
 * Source: architecture/api-design.md, section "18. Geometry Contracts";
 * architecture/map-rendering-and-editing.md, section "5. Geometry Types".
 */

import type { CoordinateSpaceKind } from './coordinate-space.js';
import type { CurveMetadata } from './curve.js';
import { roundPosition } from './rounding.js';

/** A coordinate pair. In local space this is [eastMetres, northMetres]. */
export type Position = readonly [number, number];

export interface PointGeometry {
  readonly type: 'Point';
  readonly coordinates: Position;
}

export interface LineStringGeometry {
  readonly type: 'LineString';
  readonly coordinates: readonly Position[];
}

export interface PolygonGeometry {
  readonly type: 'Polygon';
  /** First ring is the exterior ring; any further rings are holes. */
  readonly coordinates: readonly (readonly Position[])[];
}

export interface MultiLineStringGeometry {
  readonly type: 'MultiLineString';
  readonly coordinates: readonly (readonly Position[])[];
}

export interface MultiPolygonGeometry {
  readonly type: 'MultiPolygon';
  readonly coordinates: readonly (readonly (readonly Position[])[])[];
}

/** Every geometry type the foundation release supports. */
export type Geometry =
  | PointGeometry
  | LineStringGeometry
  | PolygonGeometry
  | MultiLineStringGeometry
  | MultiPolygonGeometry;

export type GeometryType = Geometry['type'];

/**
 * How a piece of geometry came to exist.
 *
 * Source: architecture/data-and-geospatial-design.md, section "12. Provenance".
 */
export type ProvenanceKind =
  | 'manualDrawing'
  | 'userMeasurement'
  | 'importedPlan'
  | 'importedMapImagery'
  | 'arMeasurement'
  | 'imageExtraction'
  | 'depthCapture'
  | 'externalProvider'
  | 'processor';

/**
 * A geometry together with everything a consumer needs to interpret it.
 *
 * The envelope is the only form in which geometry crosses the API or the sync
 * protocol. A bare GeoJSON object is never sufficient.
 */
export interface GeometryEnvelope {
  readonly geometry: Geometry;
  readonly coordinateSpaceId: string;
  readonly coordinateSpaceKind: CoordinateSpaceKind;
  readonly provenance: ProvenanceKind;
  /** Present when the geometry was drawn as a curve and remains editable as one. */
  readonly curve?: CurveMetadata;
  /** 0…1 where the source supplies one. Absent means "not expressed", not "certain". */
  readonly confidence?: number;
}

/** Applies storage rounding to every coordinate in a geometry. */
export function roundGeometry(geometry: Geometry): Geometry {
  switch (geometry.type) {
    case 'Point':
      return { type: 'Point', coordinates: roundPosition(geometry.coordinates) };
    case 'LineString':
      return { type: 'LineString', coordinates: geometry.coordinates.map(roundPosition) };
    case 'MultiLineString':
      return {
        type: 'MultiLineString',
        coordinates: geometry.coordinates.map((line) => line.map(roundPosition)),
      };
    case 'Polygon':
      return {
        type: 'Polygon',
        coordinates: geometry.coordinates.map((ring) => ring.map(roundPosition)),
      };
    case 'MultiPolygon':
      return {
        type: 'MultiPolygon',
        coordinates: geometry.coordinates.map((polygon) =>
          polygon.map((ring) => ring.map(roundPosition)),
        ),
      };
  }
}

/** Returns every position in a geometry, in document order. */
export function positionsOf(geometry: Geometry): Position[] {
  switch (geometry.type) {
    case 'Point':
      return [geometry.coordinates];
    case 'LineString':
      return [...geometry.coordinates];
    case 'MultiLineString':
      return geometry.coordinates.flat();
    case 'Polygon':
      return geometry.coordinates.flat();
    case 'MultiPolygon':
      return geometry.coordinates.flat(2);
  }
}
