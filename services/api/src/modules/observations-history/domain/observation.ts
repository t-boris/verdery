/**
 * The observation aggregate: an immutable, append-only record of what was
 * seen in a garden, at a plant within it, or in an area (`gardenObjectId`),
 * at a point in time.
 *
 * No `revision` column and no UPDATE path — this is the key structural
 * divergence from every other aggregate in this codebase (`garden`,
 * `garden_object`, and the sibling `plant`/`task`, all of which pair a
 * mutable current row with a revision journal). A correction never edits or
 * supersedes a row in place: it inserts a new row with `correctionKind` set
 * and `correctsObservationId` pointing backward to the record it corrects,
 * leaving the original completely untouched. Consequently there is no
 * "transition function" here, only the two pure constructors below —
 * `createObservation` and `createCorrectionObservation` — never an `update`.
 *
 * Source: migrations/1784900000000_plants-observations-tasks-baseline.sql,
 * `observations_history.observation`.
 */

import { SharedErrorCode } from '@verdery/api-contracts';
import { ValidationError } from '../../../platform/errors/application-error.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';

export type ObservationActorType = 'user' | 'system';
export type ObservationCorrectionKind = 'amendment' | 'supersede';

export interface Observation {
  readonly id: Uuid;
  readonly gardenId: Uuid;
  readonly plantId: Uuid | null;
  /** For bed/area-level observations not tied to one plant. */
  readonly gardenObjectId: Uuid | null;
  readonly actorType: ObservationActorType;
  /** Null when `actorType` is `'system'`; every constructor here always sets `'user'`, so this is always populated today. */
  readonly createdByProfileId: Uuid | null;
  readonly noteText: string | null;
  readonly conditionSummary: string | null;
  /** Null for an ordinary observation. */
  readonly correctionKind: ObservationCorrectionKind | null;
  /** Self-reference, set only when `correctionKind` is set; points backward to the corrected record. */
  readonly correctsObservationId: Uuid | null;
  readonly observedAt: Date;
  readonly recordedAt: Date;
}

/** Trims optional free text, treating a blank-after-trim value the same as "not supplied" — the same gap `media/domain/media-record.ts`'s `validateStorageReference` closes for a required field, applied here to two optional ones. */
function normalizeOptionalText(raw: string | null): string | null {
  if (raw === null) {
    return null;
  }
  const trimmed = raw.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/**
 * "An observation needs at least a note, a condition summary, or one
 * attached photo" — the migration's own doc comment on `observation`,
 * enforced here at the application layer because it spans a child table
 * (`observation_photo`) that no database `CHECK` on `observation` alone can
 * see. Applies to every row this module ever inserts into `observation`,
 * correction rows included — the migration's comment does not carve out an
 * exception for corrections, so neither does this function.
 */
export function requireObservationContent(
  noteText: string | null,
  conditionSummary: string | null,
  photoCount: number,
): void {
  if (noteText === null && conditionSummary === null && photoCount === 0) {
    throw new ValidationError(
      SharedErrorCode.RequestInvalid,
      'An observation needs a note, a condition summary, or at least one photo.',
      { details: [{ code: 'observation.content.empty', pointer: '/noteText' }] },
    );
  }
}

export interface CreateObservationInput {
  readonly id: Uuid;
  readonly gardenId: Uuid;
  readonly plantId: Uuid | null;
  readonly gardenObjectId: Uuid | null;
  readonly actorProfileId: Uuid;
  readonly rawNoteText: string | null;
  readonly rawConditionSummary: string | null;
  readonly observedAt: Date;
  /** `photoMediaIds.length` from the command — the entity itself carries no photo rows, but the content invariant needs the count. */
  readonly photoCount: number;
  readonly now: Date;
}

export function createObservation(input: CreateObservationInput): Observation {
  const noteText = normalizeOptionalText(input.rawNoteText);
  const conditionSummary = normalizeOptionalText(input.rawConditionSummary);
  requireObservationContent(noteText, conditionSummary, input.photoCount);

  return {
    id: input.id,
    gardenId: input.gardenId,
    plantId: input.plantId,
    gardenObjectId: input.gardenObjectId,
    actorType: 'user',
    createdByProfileId: input.actorProfileId,
    noteText,
    conditionSummary,
    correctionKind: null,
    correctsObservationId: null,
    observedAt: input.observedAt,
    recordedAt: input.now,
  };
}

export interface CreateCorrectionObservationInput {
  readonly id: Uuid;
  /** The observation being corrected. Read only — never mutated by this function or by any caller of it. */
  readonly original: Observation;
  readonly correctionKind: ObservationCorrectionKind;
  readonly actorProfileId: Uuid;
  readonly rawNoteText: string | null;
  readonly rawConditionSummary: string | null;
  readonly observedAt: Date;
  readonly photoCount: number;
  readonly now: Date;
}

/**
 * Builds the new, backward-pointing correction row. `gardenId`, `plantId`,
 * and `gardenObjectId` are copied from `input.original`; `input.original`
 * itself is read-only data here, never written back — the caller must not
 * (and in this module, never does) issue an UPDATE against the row it came
 * from.
 */
export function createCorrectionObservation(input: CreateCorrectionObservationInput): Observation {
  const noteText = normalizeOptionalText(input.rawNoteText);
  const conditionSummary = normalizeOptionalText(input.rawConditionSummary);
  requireObservationContent(noteText, conditionSummary, input.photoCount);

  return {
    id: input.id,
    gardenId: input.original.gardenId,
    plantId: input.original.plantId,
    gardenObjectId: input.original.gardenObjectId,
    actorType: 'user',
    createdByProfileId: input.actorProfileId,
    noteText,
    conditionSummary,
    correctionKind: input.correctionKind,
    correctsObservationId: input.original.id,
    observedAt: input.observedAt,
    recordedAt: input.now,
  };
}
