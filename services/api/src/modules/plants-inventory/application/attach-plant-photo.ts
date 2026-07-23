/**
 * Appends a `plant_photo` row. Does not touch `plant` itself — no
 * `expectedRevision`, no `plant_revision` journal entry — see
 * `plant-revision-journal-writer.ts`'s doc comment on `PlantCommandType` for
 * why.
 *
 * Still writes a `platform.sync_change` row for the *plant* (not the photo,
 * which has no sync record type of its own — see
 * `architecture/offline-synchronization.md` section 18, "record sync
 * contains media IDs and state, not binary data"): a client polling the sync
 * feed for this garden needs to learn a new photo exists on this plant, and
 * the plant's own row is what a re-fetch would return it through. Uses
 * `plant.revision` exactly as fetched by `requirePlantAndAuthorize` — never
 * bumped, since this command does not touch `plant` — which is a true
 * statement of the plant's revision at the moment of this write, not a lie:
 * a client is not promised the revision advances on every sync entry, only
 * that the entry names the revision the record actually carries.
 */

import type { IdempotencyStore } from '../../../platform/idempotency/idempotency-store.js';
import { generateUuidV7 } from '../../../shared/identifiers/uuid.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { Clock } from '../../../shared/time/clock.js';
import type { GardenAuthorization } from '../../gardens-mapping/public.js';
import { createPlantPhoto } from '../domain/plant-photo.js';
import { invalidMediaReferenceError } from './plant-errors.js';
import { toPlantPhotoResource, type PlantPhotoResource } from './plant-photo-view.js';
import type { PlantRepository } from './plant-repository.js';
import type { PlantsInventoryUnitOfWork } from './plants-inventory-unit-of-work.js';
import { requirePlantAndAuthorize } from './require-plant-and-authorize.js';
import { runIdempotentCommand } from './run-idempotent-command.js';

const OPERATION = 'plants.attachPlantPhoto';

export interface AttachPlantPhotoInput {
  /**
   * Client-generated id for the new photo row, when supplied. See
   * `AddPlantInput.plantId`'s own doc comment for why this is optional and
   * additive — matches `SyncAttachPlantPhotoCommand.plantPhotoId`.
   */
  readonly plantPhotoId?: Uuid;
  readonly mediaId: Uuid;
  readonly isPrimary?: boolean;
}

export class AttachPlantPhoto {
  constructor(
    private readonly plants: PlantRepository,
    private readonly idempotency: IdempotencyStore,
    private readonly unitOfWork: PlantsInventoryUnitOfWork,
    private readonly authorization: GardenAuthorization,
    private readonly clock: Clock,
  ) {}

  async execute(
    plantId: Uuid,
    profileId: Uuid,
    input: AttachPlantPhotoInput,
    idempotencyKey: string,
  ): Promise<PlantPhotoResource> {
    const plant = await requirePlantAndAuthorize(
      this.plants,
      this.authorization,
      plantId,
      profileId,
    );

    const idempotencyInput = {
      actorProfileId: profileId,
      operation: OPERATION,
      idempotencyKey,
      requestFingerprint: JSON.stringify({ plantId, input }),
    };

    return runIdempotentCommand(
      this.idempotency,
      this.unitOfWork,
      idempotencyInput,
      201,
      async (context) => {
        const media = await context.media.get(input.mediaId);
        if (media === null) {
          throw invalidMediaReferenceError('/mediaId');
        }

        const now = this.clock.now();
        const isPrimary = input.isPrimary ?? false;
        if (isPrimary) {
          // Satisfies the migration's partial unique index
          // (`plant_photo_plant_primary_idx`) here rather than relying on the
          // database to reject a second `true` row.
          await context.plantPhotos.clearPrimaryForPlant(plantId);
        }

        const photo = createPlantPhoto(
          input.plantPhotoId ?? generateUuidV7(),
          plantId,
          input.mediaId,
          isPrimary,
          now,
        );
        await context.plantPhotos.insert(photo);
        await context.syncChanges.record({
          gardenId: plant.gardenId,
          recordId: plant.id,
          recordType: 'plant',
          operation: 'upsert',
          recordRevision: plant.revision,
        });

        return toPlantPhotoResource(photo);
      },
    );
  }
}
