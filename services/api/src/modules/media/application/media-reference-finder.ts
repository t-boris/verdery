/**
 * Port answering "which attachment rows still reference this media record?"
 * — the deletion workflow's referenced-media guard (P6-RET-01).
 *
 * Four tables reference `media.media_record` today, all RESTRICT-shaped by
 * deliberate choice (`imported_background_details`' migration comment:
 * "deleting a media record out from under a background must fail loudly ...
 * not silently orphan or destroy a map object"):
 * `plants_inventory.plant_photo`, `observations_history.observation_photo`,
 * `tasks_recommendations.task_attachment`, and
 * `gardens_mapping.imported_background_details`. Because media deletion is
 * a STATE transition, not a row `DELETE`, those foreign keys never fire on
 * their own — this port makes the same rule explicit at the application
 * layer, and `DeleteGardenMedia` turns a non-empty answer into a clean
 * `409 media.referenced` instead of ever leaving an attachment pointing at
 * media whose bytes are gone.
 *
 * The adapter (`persistence/kysely-media-reference-finder.ts`) reads the
 * four tables directly — a narrow, read-only, port-fronted cross-schema
 * read, the exact precedent `observations-history`'s own
 * `KyselyPlantOwnershipRepository` set for reading
 * `plants_inventory.plant`.
 */

import type { Uuid } from '../../../shared/identifiers/uuid.js';

/** One kind of attachment row that can hold a media reference — the vocabulary `media.referenced`'s error details name. */
export type MediaReferenceKind =
  'plant_photo' | 'observation_photo' | 'task_attachment' | 'imported_background';

export interface MediaReferenceFinder {
  /**
   * Every reference KIND with at least one row referencing `mediaId`,
   * de-duplicated (the guard needs "is it referenced, and by what kinds",
   * never a full row list). Must run inside the deletion transaction,
   * AFTER the `deletion_scheduled` row update — see
   * `media-deletion-workflow.ts` for the lock-ordering reasoning.
   */
  findReferenceKinds(mediaId: Uuid): Promise<readonly MediaReferenceKind[]>;
}
