/**
 * `MediaReferenceFinder` over the five referencing tables — see the port's
 * own header comment for the reference-kind inventory and the
 * cross-schema-read precedent (`KyselyPlantOwnershipRepository`) this
 * follows. Five `EXISTS`-shaped probes rather than one `UNION` query: each
 * is a cheap primary-index/`media_id`-index lookup, and keeping them
 * separate keeps each kind's mapping to its table obvious.
 */

import type { Kysely } from 'kysely';
import type { DatabaseSchema } from '../../../platform/database/database-gateway.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type {
  MediaReferenceFinder,
  MediaReferenceKind,
} from '../application/media-reference-finder.js';

export class KyselyMediaReferenceFinder implements MediaReferenceFinder {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  async findReferenceKinds(mediaId: Uuid): Promise<readonly MediaReferenceKind[]> {
    const kinds: MediaReferenceKind[] = [];

    const plantPhoto = await this.db
      .selectFrom('plants_inventory.plant_photo')
      .select('id')
      .where('media_id', '=', mediaId)
      .limit(1)
      .executeTakeFirst();
    if (plantPhoto !== undefined) {
      kinds.push('plant_photo');
    }

    const candidatePhoto = await this.db
      .selectFrom('plants_inventory.plant_candidate_photo')
      .select('id')
      .where('media_id', '=', mediaId)
      .limit(1)
      .executeTakeFirst();
    if (candidatePhoto !== undefined) {
      kinds.push('candidate_photo');
    }

    const observationPhoto = await this.db
      .selectFrom('observations_history.observation_photo')
      .select('id')
      .where('media_id', '=', mediaId)
      .limit(1)
      .executeTakeFirst();
    if (observationPhoto !== undefined) {
      kinds.push('observation_photo');
    }

    const taskAttachment = await this.db
      .selectFrom('tasks_recommendations.task_attachment')
      .select('id')
      .where('media_id', '=', mediaId)
      .limit(1)
      .executeTakeFirst();
    if (taskAttachment !== undefined) {
      kinds.push('task_attachment');
    }

    /*
     * Only a background that is still ON THE MAP counts.
     *
     * A map object is deleted by STATE, not by row removal — the revision
     * journal and undo both depend on the row surviving — so its details row
     * outlives the object. Counting those rows made an uploaded plan
     * undeletable for ever once it had been placed and removed even once,
     * with the interface truthfully reporting "no plan backgrounds on the
     * map" while the server refused (reported 2026-08-06).
     */
    const importedBackground = await this.db
      .selectFrom('gardens_mapping.imported_background_details')
      .innerJoin(
        'gardens_mapping.garden_object',
        'gardens_mapping.garden_object.id',
        'gardens_mapping.imported_background_details.garden_object_id',
      )
      .select('gardens_mapping.imported_background_details.garden_object_id')
      .where('gardens_mapping.imported_background_details.plan_media_id', '=', mediaId)
      .where('gardens_mapping.garden_object.lifecycle_state', '=', 'active')
      .limit(1)
      .executeTakeFirst();
    if (importedBackground !== undefined) {
      kinds.push('imported_background');
    }

    return kinds;
  }
}
