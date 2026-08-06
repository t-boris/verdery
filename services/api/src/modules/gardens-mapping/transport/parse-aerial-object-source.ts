import type { AerialObjectSourceMetadata } from '@verdery/geometry-contracts';
import { invalid } from './garden-routes.js';
import {
  requireEnum,
  requireInteger,
  requireNumber,
  requireRecord,
  requireString,
  requireUuid,
} from './parse-primitives.js';

function positiveNumber(value: unknown, pointer: string): number {
  const parsed = requireNumber(value, pointer);
  if (parsed <= 0) {
    throw invalid(`${pointer} must be greater than zero.`, 'request.invalid', pointer);
  }
  return parsed;
}

function nonNegativeNumberOrNull(value: unknown, pointer: string): number | null {
  if (value === null) return null;
  const parsed = requireNumber(value, pointer);
  if (parsed < 0) {
    throw invalid(`${pointer} must not be negative.`, 'request.invalid', pointer);
  }
  return parsed;
}

function stringArray(value: unknown, pointer: string): readonly string[] {
  if (!Array.isArray(value)) {
    throw invalid(`${pointer} must be an array.`, 'request.invalid', pointer);
  }
  return value.map((item, index) => requireString(item, `${pointer}/${String(index)}`));
}

/** Shape-checks durable aerial lineage before it can reach the jsonb column. */
export function parseAerialObjectSourceMetadata(
  value: unknown,
  pointer: string,
): AerialObjectSourceMetadata {
  const record = requireRecord(value, pointer);
  const imagery = requireRecord(record['imagery'], `${pointer}/imagery`);
  const bounds = requireRecord(record['imageryBounds'], `${pointer}/imageryBounds`);
  const capturedOn = imagery['capturedOn'];

  return {
    kind: requireEnum(record['kind'], ['aerialImageExtraction'], `${pointer}/kind`),
    proposalId: requireUuid(record['proposalId'], `${pointer}/proposalId`),
    processor: requireString(record['processor'], `${pointer}/processor`),
    model: requireString(record['model'], `${pointer}/model`),
    promptTemplateVersion: requireInteger(
      record['promptTemplateVersion'],
      `${pointer}/promptTemplateVersion`,
      1,
    ),
    boundaryEvidence: requireEnum(
      record['boundaryEvidence'],
      ['notApplicable', 'visualEvidence'],
      `${pointer}/boundaryEvidence`,
    ),
    limitations: stringArray(record['limitations'], `${pointer}/limitations`),
    imagery: {
      providerKey: requireString(imagery['providerKey'], `${pointer}/imagery/providerKey`),
      providerName: requireString(imagery['providerName'], `${pointer}/imagery/providerName`),
      sourceId: requireString(imagery['sourceId'], `${pointer}/imagery/sourceId`),
      capturedOn:
        capturedOn === null ? null : requireString(capturedOn, `${pointer}/imagery/capturedOn`),
      attributionText: requireString(
        imagery['attributionText'],
        `${pointer}/imagery/attributionText`,
      ),
      attributionUrl: requireString(imagery['attributionUrl'], `${pointer}/imagery/attributionUrl`),
      licenseName: requireString(imagery['licenseName'], `${pointer}/imagery/licenseName`),
      licenseUrl: requireString(imagery['licenseUrl'], `${pointer}/imagery/licenseUrl`),
    },
    imageryBounds: {
      west: requireNumber(bounds['west'], `${pointer}/imageryBounds/west`),
      south: requireNumber(bounds['south'], `${pointer}/imageryBounds/south`),
      east: requireNumber(bounds['east'], `${pointer}/imageryBounds/east`),
      north: requireNumber(bounds['north'], `${pointer}/imageryBounds/north`),
    },
    imageryWidthPixels: requireInteger(
      record['imageryWidthPixels'],
      `${pointer}/imageryWidthPixels`,
      1,
    ),
    imageryHeightPixels: requireInteger(
      record['imageryHeightPixels'],
      `${pointer}/imageryHeightPixels`,
      1,
    ),
    imageryResolutionMetres: positiveNumber(
      record['imageryResolutionMetres'],
      `${pointer}/imageryResolutionMetres`,
    ),
    imageryHorizontalAccuracyMetres: nonNegativeNumberOrNull(
      record['imageryHorizontalAccuracyMetres'],
      `${pointer}/imageryHorizontalAccuracyMetres`,
    ),
    georeferenceRevision: requireInteger(
      record['georeferenceRevision'],
      `${pointer}/georeferenceRevision`,
      1,
    ),
  };
}
