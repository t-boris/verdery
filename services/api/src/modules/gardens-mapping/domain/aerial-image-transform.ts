import {
  isGeometryTypeAllowedForCategory,
  geographicToLocalMetres,
  roundGeometry,
  validateGeometry,
  type GardenObjectCategory,
  type Geometry,
  type Position,
} from '@verdery/geometry-contracts';

import type { Georeference } from '../application/georeference-repository.js';
import type {
  AerialProposalCategory,
  ExtractedAerialObject,
  GeographicBounds,
  NormalizedImagePoint,
} from '../../integrations/public.js';

const MAXIMUM_SOURCE_RESOLUTION_METRES = 1;
const MAXIMUM_GEOREFERENCE_ACCURACY_METRES = 25;

export interface AerialTransformInput {
  readonly bounds: GeographicBounds;
  readonly groundResolutionMetres: number;
  readonly widthPixels: number;
  readonly heightPixels: number;
}

export interface AerialProposalGeometry {
  readonly category: AerialProposalCategory;
  readonly geometry: Geometry;
  readonly label: string;
  readonly confidence: number;
  readonly limitations: readonly string[];
}

/** Refuses an entire extraction before any model geometry can be trusted. */
export function aerialTransformUsable(
  source: AerialTransformInput,
  georeference: Georeference,
): boolean {
  const { west, south, east, north } = source.bounds;
  const [anchorLongitude, anchorLatitude] = georeference.geographicAnchor;
  return (
    source.widthPixels >= 512 &&
    source.heightPixels >= 512 &&
    Number.isFinite(source.groundResolutionMetres) &&
    source.groundResolutionMetres > 0 &&
    source.groundResolutionMetres <= MAXIMUM_SOURCE_RESOLUTION_METRES &&
    west < east &&
    south < north &&
    anchorLongitude >= west &&
    anchorLongitude <= east &&
    anchorLatitude >= south &&
    anchorLatitude <= north &&
    georeference.scaleCorrection >= 0.5 &&
    georeference.scaleCorrection <= 2 &&
    (georeference.accuracyMetres === null ||
      georeference.accuracyMetres <= MAXIMUM_GEOREFERENCE_ACCURACY_METRES)
  );
}

/**
 * Converts a normalized image coordinate through WGS84 into garden-local
 * metres. Image Y grows down; latitude and local north grow up.
 */
export function normalizedImagePointToLocal(
  point: NormalizedImagePoint,
  bounds: GeographicBounds,
  georeference: Georeference,
): Position | null {
  const [x, y] = point;
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) {
    return null;
  }
  const longitude = bounds.west + x * (bounds.east - bounds.west);
  const latitude = bounds.north - y * (bounds.north - bounds.south);
  return geographicToLocalMetres([longitude, latitude], georeference);
}

export function buildAerialProposalGeometry(
  extracted: ExtractedAerialObject,
  bounds: GeographicBounds,
  georeference: Georeference,
): AerialProposalGeometry | null {
  if (
    extracted.category === 'lot' &&
    (extracted.boundaryEvidence === 'notApplicable' || extracted.limitations.length === 0)
  ) {
    return null;
  }
  const points = extracted.points.map((point) =>
    normalizedImagePointToLocal(point, bounds, georeference),
  );
  if (points.some((point) => point === null)) {
    return null;
  }
  const localPoints = points as Position[];
  const geometry = geometryForCategory(extracted.category, localPoints);
  if (geometry === null || !isGeometryTypeAllowedForCategory(extracted.category, geometry.type)) {
    return null;
  }
  const rounded = roundGeometry(geometry);
  if (validateGeometry(rounded).some((issue) => issue.severity === 'error')) {
    return null;
  }
  return {
    category: extracted.category,
    geometry: rounded,
    label: extracted.label.trim(),
    confidence: extracted.confidence,
    limitations: extracted.limitations,
  };
}

function geometryForCategory(category: GardenObjectCategory, points: Position[]): Geometry | null {
  if (category === 'tree') {
    return points.length === 1 ? { type: 'Point', coordinates: points[0] as Position } : null;
  }
  if (category === 'path' || category === 'fence') {
    return points.length >= 2 ? { type: 'LineString', coordinates: points } : null;
  }
  if (points.length < 3) {
    return null;
  }
  const first = points[0] as Position;
  const last = points.at(-1) as Position;
  const ring = first[0] === last[0] && first[1] === last[1] ? points : [...points, first];
  return { type: 'Polygon', coordinates: [ring] };
}
