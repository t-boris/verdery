/**
 * Hand-written request-body parsers for the `Plants` tag, in the same
 * hand-written-validation convention `garden-routes.ts`'s own header comment
 * describes — see that file for the full rationale. Small, local primitive
 * checks mirror the style of `gardens-mapping/transport/parse-primitives.ts`
 * but are not imported from it: this module's transport layer stays
 * decoupled from another module's transport internals, the same
 * modular-monolith boundary `public.ts` enforces for application code,
 * except for the specific helpers `garden-routes.ts` exports for exactly
 * this reuse (`UUID_PATTERN`/`invalid`).
 *
 * Source: packages/api-contracts/openapi.yaml, tag `Plants`;
 * implementation-plan.md work package P4-CONTRACT-01.
 */

import { UUID_PATTERN, invalid } from '../../gardens-mapping/transport/garden-routes.js';
import type { AddPlantFromPhotoInput } from '../application/add-plant-from-photo.js';
import type { AddPlantInput } from '../application/add-plant.js';
import type { AttachPlantPhotoInput } from '../application/attach-plant-photo.js';
import type { MovePlantInput } from '../application/move-plant.js';
import type { AcquisitionDateType, GroupingKind, PlantDetailsChanges } from '../domain/plant.js';
import type { LifecycleStage, PlantStatus } from '../domain/plant-lifecycle.js';

const GROUPING_KINDS: readonly GroupingKind[] = ['individual', 'row', 'group'];
const ACQUISITION_DATE_TYPES: readonly AcquisitionDateType[] = ['planted', 'sown', 'acquired'];
const LIFECYCLE_STAGES: readonly LifecycleStage[] = [
  'planned',
  'seed',
  'seedling',
  'transplanted',
  'growing',
  'flowering',
  'fruiting',
  'ready_to_harvest',
];
const PLANT_STATUSES: readonly PlantStatus[] = ['active', 'dormant', 'archived', 'removed', 'dead'];

function requireRecord(value: unknown, pointer: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw invalid(
      `${pointer || 'the request body'} must be an object.`,
      'request.invalid',
      pointer,
    );
  }
  return value as Record<string, unknown>;
}

function requireString(value: unknown, pointer: string): string {
  if (typeof value !== 'string') {
    throw invalid(`${pointer} must be a string.`, 'request.invalid', pointer);
  }
  return value;
}

function requireOptionalString(value: unknown, pointer: string): string | undefined {
  return value === undefined ? undefined : requireString(value, pointer);
}

function optionalNullableString(value: unknown, pointer: string): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return requireString(value, pointer);
}

function requireUuid(value: unknown, pointer: string): string {
  const candidate = requireString(value, pointer);
  if (!UUID_PATTERN.test(candidate)) {
    throw invalid(`${pointer} must be a UUID.`, 'request.uuid.invalid', pointer);
  }
  return candidate;
}

function requireOptionalUuid(value: unknown, pointer: string): string | undefined {
  return value === undefined ? undefined : requireUuid(value, pointer);
}

function optionalNullableUuid(value: unknown, pointer: string): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return requireUuid(value, pointer);
}

function optionalNullableInteger(
  value: unknown,
  pointer: string,
  minimum: number,
): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < minimum) {
    throw invalid(
      `${pointer} must be an integer >= ${String(minimum)}.`,
      'request.invalid',
      pointer,
    );
  }
  return value;
}

function requireEnum<T extends string>(value: unknown, allowed: readonly T[], pointer: string): T {
  const candidate = requireString(value, pointer);
  if (!(allowed as readonly string[]).includes(candidate)) {
    throw invalid(
      `${pointer} must be one of: ${allowed.join(', ')}.`,
      'request.enum.invalid',
      pointer,
    );
  }
  return candidate as T;
}

function optionalNullableEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  pointer: string,
): T | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return requireEnum(value, allowed, pointer);
}

function requireOptionalBoolean(value: unknown, pointer: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') {
    throw invalid(`${pointer} must be a boolean.`, 'request.invalid', pointer);
  }
  return value;
}

export function parseAddPlantRequest(body: unknown): AddPlantInput {
  const record = requireRecord(body, '');
  const gardenAreaMapObjectId = requireOptionalUuid(
    record['gardenAreaMapObjectId'],
    '/gardenAreaMapObjectId',
  );
  const placementMapObjectId = requireOptionalUuid(
    record['placementMapObjectId'],
    '/placementMapObjectId',
  );
  const displayName = requireString(record['displayName'], '/displayName');
  const taxonomyReferenceId = optionalNullableUuid(
    record['taxonomyReferenceId'],
    '/taxonomyReferenceId',
  );
  const varietyLabel = optionalNullableString(record['varietyLabel'], '/varietyLabel');
  const acquisitionDate = optionalNullableString(record['acquisitionDate'], '/acquisitionDate');
  const acquisitionDateType = optionalNullableEnum(
    record['acquisitionDateType'],
    ACQUISITION_DATE_TYPES,
    '/acquisitionDateType',
  );
  const groupingKind = requireEnum(record['groupingKind'], GROUPING_KINDS, '/groupingKind');
  const quantity = optionalNullableInteger(record['quantity'], '/quantity', 1);

  return {
    ...(gardenAreaMapObjectId === undefined ? {} : { gardenAreaMapObjectId }),
    ...(placementMapObjectId === undefined ? {} : { placementMapObjectId }),
    displayName,
    ...(taxonomyReferenceId === undefined ? {} : { taxonomyReferenceId }),
    ...(varietyLabel === undefined ? {} : { varietyLabel }),
    ...(acquisitionDate === undefined ? {} : { acquisitionDate }),
    ...(acquisitionDateType === undefined ? {} : { acquisitionDateType }),
    groupingKind,
    ...(quantity === undefined ? {} : { quantity }),
  };
}

export function parseAddPlantFromPhotoRequest(body: unknown): AddPlantFromPhotoInput {
  const record = requireRecord(body, '');
  const gardenAreaMapObjectId = requireOptionalUuid(
    record['gardenAreaMapObjectId'],
    '/gardenAreaMapObjectId',
  );
  const placementMapObjectId = requireOptionalUuid(
    record['placementMapObjectId'],
    '/placementMapObjectId',
  );
  const photoMediaId = requireUuid(record['photoMediaId'], '/photoMediaId');

  return {
    ...(gardenAreaMapObjectId === undefined ? {} : { gardenAreaMapObjectId }),
    ...(placementMapObjectId === undefined ? {} : { placementMapObjectId }),
    photoMediaId,
  };
}

export function parseUpdatePlantDetailsRequest(body: unknown): PlantDetailsChanges {
  const record = requireRecord(body, '');
  const displayName = requireOptionalString(record['displayName'], '/displayName');
  const taxonomyReferenceId = optionalNullableUuid(
    record['taxonomyReferenceId'],
    '/taxonomyReferenceId',
  );
  const varietyLabel = optionalNullableString(record['varietyLabel'], '/varietyLabel');
  const acquisitionDate = optionalNullableString(record['acquisitionDate'], '/acquisitionDate');
  const acquisitionDateType = optionalNullableEnum(
    record['acquisitionDateType'],
    ACQUISITION_DATE_TYPES,
    '/acquisitionDateType',
  );
  const conditionNote = optionalNullableString(record['conditionNote'], '/conditionNote');
  const careGuidanceNote = optionalNullableString(record['careGuidanceNote'], '/careGuidanceNote');
  const quantity = optionalNullableInteger(record['quantity'], '/quantity', 1);

  return {
    ...(displayName === undefined ? {} : { displayName }),
    ...(taxonomyReferenceId === undefined ? {} : { taxonomyReferenceId }),
    ...(varietyLabel === undefined ? {} : { varietyLabel }),
    ...(acquisitionDate === undefined ? {} : { acquisitionDate }),
    ...(acquisitionDateType === undefined ? {} : { acquisitionDateType }),
    ...(conditionNote === undefined ? {} : { conditionNote }),
    ...(careGuidanceNote === undefined ? {} : { careGuidanceNote }),
    ...(quantity === undefined ? {} : { quantity }),
  };
}

export function parseAttachPlantPhotoRequest(body: unknown): AttachPlantPhotoInput {
  const record = requireRecord(body, '');
  const mediaId = requireUuid(record['mediaId'], '/mediaId');
  const isPrimary = requireOptionalBoolean(record['isPrimary'], '/isPrimary');

  return {
    mediaId,
    ...(isPrimary === undefined ? {} : { isPrimary }),
  };
}

export function parseMovePlantRequest(body: unknown): MovePlantInput {
  const record = requireRecord(body, '');
  const gardenAreaMapObjectId = requireOptionalUuid(
    record['gardenAreaMapObjectId'],
    '/gardenAreaMapObjectId',
  );
  const placementMapObjectId = requireOptionalUuid(
    record['placementMapObjectId'],
    '/placementMapObjectId',
  );

  return {
    ...(gardenAreaMapObjectId === undefined ? {} : { gardenAreaMapObjectId }),
    ...(placementMapObjectId === undefined ? {} : { placementMapObjectId }),
  };
}

export function parseLifecycleStageRequest(body: unknown): LifecycleStage {
  const record = requireRecord(body, '');
  return requireEnum(record['stage'], LIFECYCLE_STAGES, '/stage');
}

export function parsePlantStatusRequest(body: unknown): PlantStatus {
  const record = requireRecord(body, '');
  return requireEnum(record['status'], PLANT_STATUSES, '/status');
}
