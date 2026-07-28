/**
 * Derived dimensions and exact-size transforms for editable garden geometry.
 *
 * Dimensions are computed from the canonical local-metre geometry. Polygon
 * width/depth follow the map axes and line length follows every segment.
 * Applying a new size scales around the current bounding-box centre, matching
 * the visual transform handles.
 */
import {
  lineLength,
  positionsOf,
  ringArea,
  type Geometry,
  type Position,
} from '@verdery/geometry-contracts';

import { boundingBoxCentroid, scaleGeometry } from './geometry-transform';
import { boundingBoxOfPositions } from './viewport';

export type GeometryDimensions =
  | { readonly kind: 'point' }
  | { readonly kind: 'line'; readonly lengthMetres: number }
  | {
      readonly kind: 'area';
      readonly widthMetres: number;
      readonly depthMetres: number;
      readonly areaSquareMetres: number;
      readonly perimeterMetres: number;
    };

function totalLineLength(lines: readonly (readonly Position[])[]): number {
  return lines.reduce((total, line) => total + lineLength(line), 0);
}

function polygonArea(rings: readonly (readonly Position[])[]): number {
  const [exterior, ...holes] = rings;
  if (exterior === undefined) {
    return 0;
  }
  return Math.max(0, ringArea(exterior) - holes.reduce((total, ring) => total + ringArea(ring), 0));
}

function polygonPerimeter(rings: readonly (readonly Position[])[]): number {
  return totalLineLength(rings);
}

export function dimensionsOfGeometry(geometry: Geometry): GeometryDimensions {
  if (geometry.type === 'Point') {
    return { kind: 'point' };
  }

  if (geometry.type === 'LineString') {
    return { kind: 'line', lengthMetres: lineLength(geometry.coordinates) };
  }

  if (geometry.type === 'MultiLineString') {
    return { kind: 'line', lengthMetres: totalLineLength(geometry.coordinates) };
  }

  const positions = positionsOf(geometry);
  const box = boundingBoxOfPositions(positions);
  if (box === null) {
    return {
      kind: 'area',
      widthMetres: 0,
      depthMetres: 0,
      areaSquareMetres: 0,
      perimeterMetres: 0,
    };
  }

  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  return {
    kind: 'area',
    widthMetres: box.maxX - box.minX,
    depthMetres: box.maxY - box.minY,
    areaSquareMetres: polygons.reduce((total, polygon) => total + polygonArea(polygon), 0),
    perimeterMetres: polygons.reduce((total, polygon) => total + polygonPerimeter(polygon), 0),
  };
}

export function resizeAreaGeometry(
  geometry: Geometry,
  widthMetres: number,
  depthMetres: number,
): Geometry | null {
  const dimensions = dimensionsOfGeometry(geometry);
  const centroid = boundingBoxCentroid(positionsOf(geometry));
  if (
    dimensions.kind !== 'area' ||
    centroid === null ||
    !Number.isFinite(widthMetres) ||
    !Number.isFinite(depthMetres) ||
    widthMetres <= 0 ||
    depthMetres <= 0 ||
    dimensions.widthMetres <= 0 ||
    dimensions.depthMetres <= 0
  ) {
    return null;
  }
  return scaleGeometry(
    geometry,
    centroid,
    widthMetres / dimensions.widthMetres,
    depthMetres / dimensions.depthMetres,
  );
}

export function resizeLineGeometry(geometry: Geometry, lengthMetres: number): Geometry | null {
  const dimensions = dimensionsOfGeometry(geometry);
  const centroid = boundingBoxCentroid(positionsOf(geometry));
  if (
    dimensions.kind !== 'line' ||
    centroid === null ||
    !Number.isFinite(lengthMetres) ||
    lengthMetres <= 0 ||
    dimensions.lengthMetres <= 0
  ) {
    return null;
  }
  const scale = lengthMetres / dimensions.lengthMetres;
  return scaleGeometry(geometry, centroid, scale, scale);
}
