/**
 * Flips the unique `is_primary` flag: clears any existing primary for this
 * plant, then sets the given photo primary, in the same transaction — the
 * migration's partial unique index (`plant_photo_plant_primary_idx`)
 * enforces at most one per plant, but only if the clear happens first.
 *
 * Does not touch `plant` itself, the same as `AttachPlantPhoto` — no
 * `expectedRevision`, no `plant_revision` journal entry. Still writes a
 * `platform.sync_change` row for the plant, at its unbumped revision — see
 * `AttachPlantPhoto`'s own doc comment for why.
 */

import type { IdempotencyStore } from '../../../platform/idempotency/idempotency-store.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { GardenAuthorization } from '../../gardens-mapping/public.js';
import { plantPhotoNotFoundError } from './plant-errors.js';
import { toPlantPhotoResource, type PlantPhotoResource } from './plant-photo-view.js';
import type { PlantRepository } from './plant-repository.js';
import type { PlantsInventoryUnitOfWork } from './plants-inventory-unit-of-work.js';
import { requirePlantAndAuthorize } from './require-plant-and-authorize.js';
import { runIdempotentCommand } from './run-idempotent-command.js';

const OPERATION = 'plants.setPrimaryPlantPhoto';

export class SetPrimaryPlantPhoto {
  constructor(
    private readonly plants: PlantRepository,
    private readonly idempotency: IdempotencyStore,
    private readonly unitOfWork: PlantsInventoryUnitOfWork,
    private readonly authorization: GardenAuthorization,
  ) {}

  async execute(
    plantId: Uuid,
    profileId: Uuid,
    plantPhotoId: Uuid,
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
      requestFingerprint: JSON.stringify({ plantId, plantPhotoId }),
    };

    return runIdempotentCommand(
      this.idempotency,
      this.unitOfWork,
      idempotencyInput,
      200,
      async (context) => {
        const photo = await context.plantPhotos.findById(plantId, plantPhotoId);
        if (photo === null) {
          throw plantPhotoNotFoundError();
        }

        await context.plantPhotos.clearPrimaryForPlant(plantId);
        await context.plantPhotos.setPrimary(plantPhotoId);
        await context.syncChanges.record({
          gardenId: plant.gardenId,
          recordId: plant.id,
          recordType: 'plant',
          operation: 'upsert',
          recordRevision: plant.revision,
        });

        return toPlantPhotoResource({ ...photo, isPrimary: true });
      },
    );
  }
}
