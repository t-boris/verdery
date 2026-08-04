/**
 * Request parsing for `PUT /gardens/{gardenId}/georeference`.
 *
 * Separate from the route so it runs under an ordinary unit test, with no
 * container and no Fastify instance — the same split
 * `parse-map-command-payload.ts` already uses, and for the same reason:
 * validation is where the interesting cases are.
 *
 * Source: packages/api-contracts/openapi.yaml, schema
 * `SetGardenGeoreferenceRequest`.
 */

import type { GeoreferenceMethod } from '@verdery/api-contracts';
import type { Position } from '@verdery/geometry-contracts';
import type { SetGardenGeoreferenceInput } from '../application/set-garden-georeference.js';
import { invalid } from './garden-routes.js';
import {
  requireEnum,
  requireNumber,
  requireOptionalNumber,
  requireRecord,
} from './parse-primitives.js';

const GEOREFERENCE_METHODS: readonly GeoreferenceMethod[] = [
  'deviceLocation',
  'mapPin',
  'manualCoordinates',
  'controlPoints',
  'imageryAlignment',
];

/** A two-number `Position`. Neither coordinate means anything without the space it belongs to. */
function requirePosition(value: unknown, pointer: string): Position {
  if (!Array.isArray(value) || value.length !== 2) {
    throw invalid(`${pointer} must be a two-number position.`, 'request.invalid', pointer);
  }

  return [requireNumber(value[0], `${pointer}/0`), requireNumber(value[1], `${pointer}/1`)];
}

/**
 * The one check the contract cannot express: `Position` is a bare number
 * pair, so no schema knows that THIS pair is longitude and latitude. PostGIS
 * stores a point at longitude 900 without complaint, and the
 * `geometry(Point, 4326)` column's SRID constraint never looks at the
 * values — a typo would become a garden off the Earth, with weather to
 * match.
 */
function requireGeographicAnchor(value: unknown, pointer: string): Position {
  const [longitude, latitude] = requirePosition(value, pointer);

  if (longitude < -180 || longitude > 180) {
    throw invalid(
      `${pointer}/0 must be a longitude between -180 and 180.`,
      'request.invalid',
      `${pointer}/0`,
    );
  }

  if (latitude < -90 || latitude > 90) {
    throw invalid(
      `${pointer}/1 must be a latitude between -90 and 90.`,
      'request.invalid',
      `${pointer}/1`,
    );
  }

  return [longitude, latitude];
}

function requireRotationDegrees(value: unknown): number {
  const rotation = requireNumber(value, '/rotationDegrees');

  // Refused rather than folded into range. A client that produced 370 or -5
  // read a heading wrongly, and normalizing here would leave a garden
  // pointing the wrong way with nothing to show for it.
  if (rotation < 0 || rotation >= 360) {
    throw invalid(
      '/rotationDegrees must be at least 0 and less than 360.',
      'request.invalid',
      '/rotationDegrees',
    );
  }

  return rotation;
}

export function parseGeoreferenceRequest(body: unknown): SetGardenGeoreferenceInput {
  const record = requireRecord(body, '');

  const scaleCorrection = requireOptionalNumber(record['scaleCorrection'], '/scaleCorrection');
  if (scaleCorrection !== undefined && scaleCorrection <= 0) {
    throw invalid(
      '/scaleCorrection must be greater than 0.',
      'request.invalid',
      '/scaleCorrection',
    );
  }

  const accuracyMetres = requireOptionalNumber(record['accuracyMetres'], '/accuracyMetres');
  if (accuracyMetres !== undefined && accuracyMetres < 0) {
    throw invalid('/accuracyMetres must not be negative.', 'request.invalid', '/accuracyMetres');
  }

  return {
    localAnchor: requirePosition(record['localAnchor'], '/localAnchor'),
    geographicAnchor: requireGeographicAnchor(record['geographicAnchor'], '/geographicAnchor'),
    rotationDegrees: requireRotationDegrees(record['rotationDegrees']),
    ...(scaleCorrection === undefined ? {} : { scaleCorrection }),
    ...(accuracyMetres === undefined ? {} : { accuracyMetres }),
    method: requireEnum(record['method'], GEOREFERENCE_METHODS, '/method'),
  };
}
