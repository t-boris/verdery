/**
 * A photo attached to an observation.
 *
 * Immutable, insert-only, the same way `plants_inventory.plant_photo` and
 * `tasks_recommendations.task_attachment` are — nothing in this module ever
 * issues an UPDATE against `observation_photo`.
 *
 * Source: migrations/1784900000000_plants-observations-tasks-baseline.sql,
 * `observations_history.observation_photo`.
 */

import type { Uuid } from '../../../shared/identifiers/uuid.js';

export interface ObservationPhoto {
  readonly id: Uuid;
  readonly observationId: Uuid;
  readonly mediaId: Uuid;
  readonly createdAt: Date;
}

/** No validation beyond identity: `mediaId` existence is checked by the command handler against `MediaRepository` before this is ever called. */
export function createObservationPhoto(
  id: Uuid,
  observationId: Uuid,
  mediaId: Uuid,
  now: Date,
): ObservationPhoto {
  return { id, observationId, mediaId, createdAt: now };
}
