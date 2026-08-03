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
import type { ObservationPhotoAttachmentInput } from '../application/attach-observation-photos.js';
import type { CorrectObservationInput } from '../application/correct-observation.js';
import { ListPlantJournalFrames } from '../application/list-plant-journal-frames.js';
import type {
  ObservationMeasurementInput,
  RecordObservationInput,
} from '../application/record-observation.js';
import { OBSERVATION_PHOTO_PURPOSES } from '../domain/observation-photo.js';
import type { ObservationPhotoPurpose } from '../domain/observation-photo.js';
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

function requireNumber(value: unknown, pointer: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw invalid(`${pointer} must be a finite number.`, 'request.invalid', pointer);
  }
  return value;
}

function photoAttachments(
  value: unknown,
  pointer: string,
): readonly ObservationPhotoAttachmentInput[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw invalid(`${pointer} must be an array.`, 'request.invalid', pointer);
  }
  return value.map((entry, index) => {
    const entryPointer = `${pointer}/${String(index)}`;
    const entryRecord = requireRecord(entry, entryPointer);
    return {
      mediaId: requireUuid(entryRecord['mediaId'], `${entryPointer}/mediaId`),
      rawPurpose: requireString(entryRecord['purpose'], `${entryPointer}/purpose`),
    };
  });
}

function measurementInputs(
  value: unknown,
  pointer: string,
): readonly ObservationMeasurementInput[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw invalid(`${pointer} must be an array.`, 'request.invalid', pointer);
  }

  const seenKinds = new Set<string>();
  return value.map((entry, index) => {
    const entryPointer = `${pointer}/${String(index)}`;
    const entryRecord = requireRecord(entry, entryPointer);
    const kind = requireString(entryRecord['kind'], `${entryPointer}/kind`);

    // `observation_measurement_unique_kind` allows one height, one width, and
    // one count per observation — a second of the same kind is a correction,
    // which is a new observation rather than a second row. Refused here
    // because the alternative is reaching that constraint mid-transaction,
    // where a client mistake surfaces as a 500 with nothing naming the cause.
    if (seenKinds.has(kind)) {
      throw invalid(
        `${pointer} may carry at most one measurement of each kind; ${kind} appears more than once.`,
        'request.invalid',
        `${entryPointer}/kind`,
      );
    }
    seenKinds.add(kind);

    return {
      kind,
      value: requireNumber(entryRecord['value'], `${entryPointer}/value`),
      unit: requireString(entryRecord['unit'], `${entryPointer}/unit`),
    };
  });
}

export function parseRecordObservationRequest(body: unknown): RecordObservationInput {
  const record = requireRecord(body, '');

  return {
    plantId: nullableUuid(record['plantId'], '/plantId'),
    gardenObjectId: nullableUuid(record['gardenObjectId'], '/gardenObjectId'),
    noteText: nullableString(record['noteText'], '/noteText'),
    conditionSummary: nullableString(record['conditionSummary'], '/conditionSummary'),
    observedAt: nullableTimestamp(record['observedAt'], '/observedAt'),
    photos: photoAttachments(record['photos'], '/photos'),
    measurements: measurementInputs(record['measurements'], '/measurements'),
    observedPhenologicalStage: nullableString(
      record['observedPhenologicalStage'],
      '/observedPhenologicalStage',
    ),
  };
}

export function parseCorrectObservationRequest(body: unknown): CorrectObservationInput {
  const record = requireRecord(body, '');
  const correctionKind = requireEnum(record['correctionKind'], CORRECTION_KINDS, '/correctionKind');

  return {
    correctionKind,
    noteText: nullableString(record['noteText'], '/noteText'),
    conditionSummary: nullableString(record['conditionSummary'], '/conditionSummary'),
    photos: photoAttachments(record['photos'], '/photos'),
    measurements: measurementInputs(record['measurements'], '/measurements'),
    observedPhenologicalStage: nullableString(
      record['observedPhenologicalStage'],
      '/observedPhenologicalStage',
    ),
  };
}

/** A journal-frame sequence's narrowing and its bound, both optional. */
export interface JournalFramesQuery {
  readonly purpose: ObservationPhotoPurpose | null;
  readonly limit: number;
}

/**
 * `purpose` narrows the sequence to comparable frames; `limit` bounds it.
 *
 * Unlike this module's body parsers, the purpose IS validated here rather than
 * passed through raw: no domain constructor sees this value — it goes straight
 * to a repository query — so the transport layer is the only place that can
 * refuse it. And refuse it must: silently returning every frame for a
 * misspelled purpose would hand back an incomparable mixture as if it were the
 * sequence the caller asked for.
 */
export function parseJournalFramesQuery(query: unknown): JournalFramesQuery {
  const raw = (query ?? {}) as { purpose?: unknown; limit?: unknown };

  let purpose: ObservationPhotoPurpose | null = null;
  if (raw.purpose !== undefined) {
    if (
      typeof raw.purpose !== 'string' ||
      !OBSERVATION_PHOTO_PURPOSES.includes(raw.purpose as ObservationPhotoPurpose)
    ) {
      throw invalid(
        `purpose must be one of: ${OBSERVATION_PHOTO_PURPOSES.join(', ')}.`,
        'request.purpose.invalid',
        '/purpose',
      );
    }
    purpose = raw.purpose as ObservationPhotoPurpose;
  }

  let limit = ListPlantJournalFrames.MAX_FRAMES;
  if (raw.limit !== undefined) {
    // `Number('')` is 0 and `Number(' 5 ')` is 5, so the integer-and-range
    // check below is what actually rejects a malformed limit, not the cast.
    const parsed = Number(raw.limit);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > ListPlantJournalFrames.MAX_FRAMES) {
      throw invalid(
        `limit must be between 1 and ${String(ListPlantJournalFrames.MAX_FRAMES)}.`,
        'request.limit.invalid',
        '/limit',
      );
    }
    limit = parsed;
  }

  return { purpose, limit };
}

/** The raw disposition string is validated by `applyHealthSuggestionDisposition` (domain layer) against `HEALTH_SUGGESTION_DISPOSITIONS` — not re-validated here, the same "pass the raw string through" posture `photoAttachments`' own `rawPurpose` already takes. */
export interface SetHealthSuggestionDispositionRequest {
  readonly disposition: string;
}

export function parseSetHealthSuggestionDispositionRequest(
  body: unknown,
): SetHealthSuggestionDispositionRequest {
  const record = requireRecord(body, '');
  return { disposition: requireString(record['disposition'], '/disposition') };
}
