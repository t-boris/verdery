/**
 * A photo attached to an observation.
 *
 * Immutable, insert-only, the same way `plants_inventory.plant_photo` and
 * `tasks_recommendations.task_attachment` are — nothing in this module ever
 * issues an UPDATE against `observation_photo`.
 *
 * `purpose` (P11-MEDIA-01): the design doc's own named vocabulary
 * (architecture/plant-intelligence-and-visual-journal.md, section 8.2) —
 * required for every newly attached photo, even though the column itself
 * stays nullable at the schema level for rows recorded before this
 * capability existed (see the migration's own header).
 *
 * Source: migrations/1784900000000_plants-observations-tasks-baseline.sql,
 * `observations_history.observation_photo`;
 * migrations/1787900000000_visual-journal-observation-extensions.sql.
 */

import { SharedErrorCode } from '@verdery/api-contracts';
import { ValidationError } from '../../../platform/errors/application-error.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';

export type ObservationPhotoPurpose =
  | 'whole_plant'
  | 'leaf_front'
  | 'leaf_back'
  | 'stem_or_bark'
  | 'flower'
  | 'fruit'
  | 'symptom_close_up'
  | 'context_or_free_form';

export const OBSERVATION_PHOTO_PURPOSES: readonly ObservationPhotoPurpose[] = [
  'whole_plant',
  'leaf_front',
  'leaf_back',
  'stem_or_bark',
  'flower',
  'fruit',
  'symptom_close_up',
  'context_or_free_form',
];

export interface ObservationPhoto {
  readonly id: Uuid;
  readonly observationId: Uuid;
  readonly mediaId: Uuid;
  /** Null only for a photo attached before this capability existed — `createObservationPhoto` always sets a validated, non-null value for every new attachment. */
  readonly purpose: ObservationPhotoPurpose | null;
  readonly createdAt: Date;
}

function invalidPurpose(): ValidationError {
  return new ValidationError(
    SharedErrorCode.RequestInvalid,
    `purpose must be one of: ${OBSERVATION_PHOTO_PURPOSES.join(', ')}.`,
    { details: [{ code: 'observation_photo.purpose.invalid', pointer: '/purpose' }] },
  );
}

/** `mediaId` existence is checked by the command handler against `MediaRepository` before this is ever called — no validation of it here, the same posture this constructor already took before `purpose` existed. */
export function createObservationPhoto(
  id: Uuid,
  observationId: Uuid,
  mediaId: Uuid,
  rawPurpose: string,
  now: Date,
): ObservationPhoto {
  if (!OBSERVATION_PHOTO_PURPOSES.includes(rawPurpose as ObservationPhotoPurpose)) {
    throw invalidPurpose();
  }

  return {
    id,
    observationId,
    mediaId,
    purpose: rawPurpose as ObservationPhotoPurpose,
    createdAt: now,
  };
}
