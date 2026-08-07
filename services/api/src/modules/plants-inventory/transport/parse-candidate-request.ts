/**
 * Hand-written request-body parsers for the `PlantCandidates` tag — the
 * same hand-written-validation convention `parse-plant-request.ts`'s own
 * header comment describes, reusing its exported primitive helpers rather
 * than a second copy of the same logic.
 *
 * Source: packages/api-contracts/openapi.yaml, tag `PlantCandidates`;
 * implementation-plan.md work package P11-API-01.
 */

import { CATALOG_UUID_PATTERN, invalid } from '../../gardens-mapping/transport/garden-routes.js';
import type { AddCandidateFromPhotoInput } from '../application/add-candidate-from-photo.js';
import type { AddCandidateInput } from '../application/add-candidate.js';
import type { ConvertCandidateInput } from '../application/convert-candidate.js';
import type {
  CandidateDetailsChanges,
  CandidatePriority,
  CandidateStatus,
} from '../domain/plant-candidate.js';
import { GROUPING_KINDS } from './parse-plant-request.js';

// Exported for reuse by `candidate-routes.ts`'s own query-filter parsing — the `GROUPING_KINDS` precedent.
export const CANDIDATE_PRIORITIES: readonly CandidatePriority[] = ['low', 'medium', 'high'];
const SETTABLE_CANDIDATE_STATUSES: readonly Exclude<CandidateStatus, 'converted'>[] = [
  'active',
  'archived',
  'rejected',
];
const ACQUISITION_DATE_TYPES: readonly NonNullable<ConvertCandidateInput['acquisitionDateType']>[] =
  ['planted', 'sown', 'acquired'];

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

function optionalNullableString(value: unknown, pointer: string): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return requireString(value, pointer);
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

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

/** See `CATALOG_UUID_PATTERN`: a taxon id is seeded catalog content, whose UUID version is not this application's to require. */
function optionalNullableCatalogUuid(value: unknown, pointer: string): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const candidate = requireString(value, pointer);
  if (!CATALOG_UUID_PATTERN.test(candidate)) {
    throw invalid(`${pointer} must be a UUID.`, 'request.uuid.invalid', pointer);
  }
  return candidate;
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

function optionalNullableNumber(
  value: unknown,
  pointer: string,
  minimum: number,
): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'number' || value < minimum) {
    throw invalid(`${pointer} must be a number >= ${String(minimum)}.`, 'request.invalid', pointer);
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

export function parseAddCandidateRequest(body: unknown): AddCandidateInput {
  const record = requireRecord(body, '');
  const proposedGardenAreaMapObjectId = requireOptionalUuid(
    record['proposedGardenAreaMapObjectId'],
    '/proposedGardenAreaMapObjectId',
  );
  const proposedPlacementMapObjectId = requireOptionalUuid(
    record['proposedPlacementMapObjectId'],
    '/proposedPlacementMapObjectId',
  );
  const displayName = requireString(record['displayName'], '/displayName');
  const taxonomyReferenceId = optionalNullableCatalogUuid(
    record['taxonomyReferenceId'],
    '/taxonomyReferenceId',
  );
  const varietyLabel = optionalNullableString(record['varietyLabel'], '/varietyLabel');
  const groupingKind = requireEnum(record['groupingKind'], GROUPING_KINDS, '/groupingKind');
  const quantity = optionalNullableInteger(record['quantity'], '/quantity', 1);
  const rationaleNote = optionalNullableString(record['rationaleNote'], '/rationaleNote');
  const priority = optionalNullableEnum(record['priority'], CANDIDATE_PRIORITIES, '/priority');
  const priceAmount = optionalNullableNumber(record['priceAmount'], '/priceAmount', 0);
  const priceCurrency = optionalNullableString(record['priceCurrency'], '/priceCurrency');
  const purchaseSource = optionalNullableString(record['purchaseSource'], '/purchaseSource');
  const alternativeToCandidateId = optionalNullableUuid(
    record['alternativeToCandidateId'],
    '/alternativeToCandidateId',
  );

  return {
    ...(proposedGardenAreaMapObjectId === undefined ? {} : { proposedGardenAreaMapObjectId }),
    ...(proposedPlacementMapObjectId === undefined ? {} : { proposedPlacementMapObjectId }),
    displayName,
    ...(taxonomyReferenceId === undefined ? {} : { taxonomyReferenceId }),
    ...(varietyLabel === undefined ? {} : { varietyLabel }),
    groupingKind,
    ...(quantity === undefined ? {} : { quantity }),
    ...(rationaleNote === undefined ? {} : { rationaleNote }),
    ...(priority === undefined ? {} : { priority }),
    ...(priceAmount === undefined ? {} : { priceAmount }),
    ...(priceCurrency === undefined ? {} : { priceCurrency }),
    ...(purchaseSource === undefined ? {} : { purchaseSource }),
    ...(alternativeToCandidateId === undefined ? {} : { alternativeToCandidateId }),
  };
}

export function parseAddCandidateFromPhotoRequest(body: unknown): AddCandidateFromPhotoInput {
  const record = requireRecord(body, '');
  const proposedGardenAreaMapObjectId = requireOptionalUuid(
    record['proposedGardenAreaMapObjectId'],
    '/proposedGardenAreaMapObjectId',
  );
  const proposedPlacementMapObjectId = requireOptionalUuid(
    record['proposedPlacementMapObjectId'],
    '/proposedPlacementMapObjectId',
  );
  const photoMediaId = requireUuid(record['photoMediaId'], '/photoMediaId');

  return {
    ...(proposedGardenAreaMapObjectId === undefined ? {} : { proposedGardenAreaMapObjectId }),
    ...(proposedPlacementMapObjectId === undefined ? {} : { proposedPlacementMapObjectId }),
    photoMediaId,
  };
}

export function parseUpdateCandidateDetailsRequest(body: unknown): CandidateDetailsChanges {
  const record = requireRecord(body, '');
  const displayName =
    record['displayName'] === undefined
      ? undefined
      : requireString(record['displayName'], '/displayName');
  const taxonomyReferenceId = optionalNullableCatalogUuid(
    record['taxonomyReferenceId'],
    '/taxonomyReferenceId',
  );
  const varietyLabel = optionalNullableString(record['varietyLabel'], '/varietyLabel');
  const quantity = optionalNullableInteger(record['quantity'], '/quantity', 1);
  const rationaleNote = optionalNullableString(record['rationaleNote'], '/rationaleNote');
  const priority = optionalNullableEnum(record['priority'], CANDIDATE_PRIORITIES, '/priority');
  const priceAmount = optionalNullableNumber(record['priceAmount'], '/priceAmount', 0);
  const priceCurrency = optionalNullableString(record['priceCurrency'], '/priceCurrency');
  const purchaseSource = optionalNullableString(record['purchaseSource'], '/purchaseSource');

  return {
    ...(displayName === undefined ? {} : { displayName }),
    ...(taxonomyReferenceId === undefined ? {} : { taxonomyReferenceId }),
    ...(varietyLabel === undefined ? {} : { varietyLabel }),
    ...(quantity === undefined ? {} : { quantity }),
    ...(rationaleNote === undefined ? {} : { rationaleNote }),
    ...(priority === undefined ? {} : { priority }),
    ...(priceAmount === undefined ? {} : { priceAmount }),
    ...(priceCurrency === undefined ? {} : { priceCurrency }),
    ...(purchaseSource === undefined ? {} : { purchaseSource }),
  };
}

export function parseSetCandidateStatusRequest(
  body: unknown,
): Exclude<CandidateStatus, 'converted'> {
  const record = requireRecord(body, '');
  return requireEnum(record['status'], SETTABLE_CANDIDATE_STATUSES, '/status');
}

export function parseConvertCandidateRequest(body: unknown): ConvertCandidateInput {
  const record = requireRecord(body, '');
  const gardenAreaMapObjectId = optionalNullableUuid(
    record['gardenAreaMapObjectId'],
    '/gardenAreaMapObjectId',
  );
  const placementMapObjectId = optionalNullableUuid(
    record['placementMapObjectId'],
    '/placementMapObjectId',
  );
  const acquisitionDate = optionalNullableString(record['acquisitionDate'], '/acquisitionDate');
  const acquisitionDateType = optionalNullableEnum(
    record['acquisitionDateType'],
    ACQUISITION_DATE_TYPES,
    '/acquisitionDateType',
  );

  return {
    ...(gardenAreaMapObjectId === undefined ? {} : { gardenAreaMapObjectId }),
    ...(placementMapObjectId === undefined ? {} : { placementMapObjectId }),
    ...(acquisitionDate === undefined ? {} : { acquisitionDate }),
    ...(acquisitionDateType === undefined ? {} : { acquisitionDateType }),
  };
}
