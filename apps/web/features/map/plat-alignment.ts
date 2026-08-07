import type { PlatReading, ProposedPlatObject } from '@verdery/api-contracts';
import type { Geometry, Position } from '@verdery/geometry-contracts';

import { boundingBoxCentroid, rotatePosition, scalePosition } from './geometry-transform';

export interface PlatAlignmentTransform {
  readonly translation: Position;
  readonly rotationDegrees: number;
  readonly scale: number;
}

export interface PlatAlignmentDraft {
  readonly reading: PlatReading;
  readonly transform: PlatAlignmentTransform;
}

export const IDENTITY_PLAT_ALIGNMENT: PlatAlignmentTransform = {
  translation: [0, 0],
  rotationDegrees: 0,
  scale: 1,
};

export function alignedPlatReading(draft: PlatAlignmentDraft): PlatReading {
  const anchor = platAnchor(draft.reading);
  if (anchor === null) return draft.reading;
  const transform = (point: Position): Position => {
    const scaled = scalePosition(point, anchor, draft.transform.scale, draft.transform.scale);
    const rotated = rotatePosition(
      scaled,
      anchor,
      (draft.transform.rotationDegrees * Math.PI) / 180,
    );
    return [
      rotated[0] + draft.transform.translation[0],
      rotated[1] + draft.transform.translation[1],
    ];
  };
  const areaScale = draft.transform.scale * draft.transform.scale;
  return {
    ...draft.reading,
    boundary:
      draft.reading.boundary === null
        ? null
        : {
            ...draft.reading.boundary,
            geometry: mapWireGeometry(draft.reading.boundary.geometry, transform),
            areaSquareMetres: draft.reading.boundary.areaSquareMetres * areaScale,
            closureErrorMetres: draft.reading.boundary.closureErrorMetres * draft.transform.scale,
          },
    objects: draft.reading.objects.map((object) => ({
      ...object,
      geometry: mapWireGeometry(object.geometry, transform),
      areaSquareMetres: object.areaSquareMetres * areaScale,
    })),
  };
}

export function editorGeometryOf(wire: ProposedPlatObject['geometry']): Geometry | null {
  if (wire.type === 'Point') {
    const point = toPosition(wire.coordinates);
    return point === null ? null : { type: 'Point', coordinates: point };
  }
  if (wire.type === 'LineString') {
    const line = toPositions(wire.coordinates);
    return line === null || line.length < 2 ? null : { type: 'LineString', coordinates: line };
  }
  if (wire.type !== 'Polygon') return null;
  const rings = wire.coordinates.map(toPositions);
  return rings.some((ring) => ring === null)
    ? null
    : { type: 'Polygon', coordinates: rings as readonly (readonly Position[])[] };
}

function platAnchor(reading: PlatReading): Position | null {
  const geometry = reading.boundary === null ? null : editorGeometryOf(reading.boundary.geometry);
  if (geometry?.type !== 'Polygon') return null;
  return boundingBoxCentroid(geometry.coordinates[0] ?? []);
}

function mapWireGeometry(
  geometry: ProposedPlatObject['geometry'],
  transform: (point: Position) => Position,
): ProposedPlatObject['geometry'] {
  const point = (coordinates: readonly number[]): number[] => {
    const position = toPosition(coordinates);
    if (position === null) return [...coordinates];
    const transformed = transform(position);
    return [transformed[0], transformed[1]];
  };
  switch (geometry.type) {
    case 'Point':
      return { ...geometry, coordinates: point(geometry.coordinates) };
    case 'LineString':
      return { ...geometry, coordinates: geometry.coordinates.map(point) };
    case 'MultiLineString':
      return {
        ...geometry,
        coordinates: geometry.coordinates.map((line) => line.map(point)),
      };
    case 'Polygon':
      return {
        ...geometry,
        coordinates: geometry.coordinates.map((ring) => ring.map(point)),
      };
    case 'MultiPolygon':
      return {
        ...geometry,
        coordinates: geometry.coordinates.map((polygon) => polygon.map((ring) => ring.map(point))),
      };
  }
}

function toPosition(coordinates: readonly number[]): Position | null {
  const [x, y] = coordinates;
  return x === undefined || y === undefined ? null : [x, y];
}

function toPositions(coordinates: readonly (readonly number[])[]): readonly Position[] | null {
  const positions = coordinates.map(toPosition);
  return positions.some((position) => position === null)
    ? null
    : (positions as readonly Position[]);
}
