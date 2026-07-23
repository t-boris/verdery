/**
 * Hand-written request-body parsers for the `Observations` tag, in the same
 * hand-written-validation convention `garden-routes.ts`'s own header comment
 * describes. Small, local primitive checks mirror
 * `gardens-mapping/transport/parse-primitives.ts`'s style without importing
 * it — see `plants-inventory/transport/parse-plant-request.ts`'s identical
 * header comment for why.
 *
 * `RecordObservationInput`/`CorrectObservationInput` declare every property
 * without `?:` (always present, some nullable) — unlike this tag's PATCH-
 * shaped siblings elsewhere in this phase, there is no undefined-vs-null
 * distinction to preserve here, so every field below has a wire-level
 * default (`null` or `[]`) rather than being conditionally spread.
 *
 * Source: packages/api-contracts/openapi.yaml, tag `Observations`;
 * implementation-plan.md work package P4-CONTRACT-01.
 */

import { UUID_PATTERN, invalid } from '../../gardens-mapping/transport/garden-routes.js';
import type { CorrectObservationInput } from '../application/correct-observation.js';
import type { RecordObservationInput } from '../application/record-observation.js';
import type { ObservationCorrectionKind } from '../domain/observation.js';

const CORRECTION_KINDS: readonly ObservationCorrectionKind[] = ['amendment', 'supersede'];

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

function nullableString(value: unknown, pointer: string): string | null {
  if (value === undefined || value === null) return null;
  return requireString(value, pointer);
}

function requireUuid(value: unknown, pointer: string): string {
  const candidate = requireString(value, pointer);
  if (!UUID_PATTERN.test(candidate)) {
    throw invalid(`${pointer} must be a UUID.`, 'request.uuid.invalid', pointer);
  }
  return candidate;
}

function nullableUuid(value: unknown, pointer: string): string | null {
  if (value === undefined || value === null) return null;
  return requireUuid(value, pointer);
}

function nullableTimestamp(value: unknown, pointer: string): Date | null {
  if (value === undefined || value === null) return null;
  const candidate = requireString(value, pointer);
  const parsed = new Date(candidate);
  if (Number.isNaN(parsed.getTime())) {
    throw invalid(`${pointer} must be an RFC 3339 timestamp.`, 'request.invalid', pointer);
  }
  return parsed;
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

function photoMediaIds(value: unknown, pointer: string): readonly string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw invalid(`${pointer} must be an array.`, 'request.invalid', pointer);
  }
  return value.map((entry, index) => requireUuid(entry, `${pointer}/${String(index)}`));
}

export function parseRecordObservationRequest(body: unknown): RecordObservationInput {
  const record = requireRecord(body, '');

  return {
    plantId: nullableUuid(record['plantId'], '/plantId'),
    gardenObjectId: nullableUuid(record['gardenObjectId'], '/gardenObjectId'),
    noteText: nullableString(record['noteText'], '/noteText'),
    conditionSummary: nullableString(record['conditionSummary'], '/conditionSummary'),
    observedAt: nullableTimestamp(record['observedAt'], '/observedAt'),
    photoMediaIds: photoMediaIds(record['photoMediaIds'], '/photoMediaIds'),
  };
}

export function parseCorrectObservationRequest(body: unknown): CorrectObservationInput {
  const record = requireRecord(body, '');
  const correctionKind = requireEnum(record['correctionKind'], CORRECTION_KINDS, '/correctionKind');

  return {
    correctionKind,
    noteText: nullableString(record['noteText'], '/noteText'),
    conditionSummary: nullableString(record['conditionSummary'], '/conditionSummary'),
    photoMediaIds: photoMediaIds(record['photoMediaIds'], '/photoMediaIds'),
  };
}
