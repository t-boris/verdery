/**
 * Appends a `plant_photo` row. Does not touch `plant` itself — no
 * `expectedRevision`, no `plant_revision` journal entry — see
 * `plant-revision-journal-writer.ts`'s doc comment on `PlantCommandType` for
 * why.
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
    await requirePlantAndAuthorize(this.plants, this.authorization, plantId, profileId);

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

        const photo = createPlantPhoto(generateUuidV7(), plantId, input.mediaId, isPrimary, now);
        await context.plantPhotos.insert(photo);

        return toPlantPhotoResource(photo);
      },
    );
  }
}
