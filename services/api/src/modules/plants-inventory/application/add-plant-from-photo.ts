/**
 * Creates a plant whose `displayName` is prefilled from a photo-identification
 * result, and inserts one `plant_photo` and one `plant_identification` row in
 * the same transaction.
 *
 * Always creates an `'individual'` plant: unlike `AddPlant`, this command
 * takes no `groupingKind`/`quantity` — identifying a row or group from a
 * single photo is not a meaningful operation this pass.
 *
 * `plant.taxonomyReferenceId` stays `null` on the created plant no matter
 * what the identification stub returns — identification never
 * auto-confirms; a caller must separately call `ConfirmPlantIdentification`.
 */

import type { IdempotencyStore } from '../../../platform/idempotency/idempotency-store.js';
import { generateUuidV7 } from '../../../shared/identifiers/uuid.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { Clock } from '../../../shared/time/clock.js';
import type { GardenAuthorization } from '../../gardens-mapping/public.js';
import { createPlant, type PlantPlacement } from '../domain/plant.js';
import { createPlantIdentification } from '../domain/plant-identification.js';
import { createPlantPhoto } from '../domain/plant-photo.js';
import { identifyPlantFromPhoto } from './identify-plant-from-photo.js';
import { invalidMediaReferenceError } from './plant-errors.js';
import { toPlantResource, type PlantResource } from './plant-view.js';
import type { PlantsInventoryUnitOfWork } from './plants-inventory-unit-of-work.js';
import { requirePlacementReferencesGardenObjects } from './require-plant-placement-in-garden.js';
import { runIdempotentCommand } from './run-idempotent-command.js';

const OPERATION = 'plants.addPlantFromPhoto';

/** The stub in `identify-plant-from-photo.ts` never returns a taxonomy suggestion, so this is always what a photo-created plant's `displayName` resolves to today. Kept as a named constant, not inlined, so a future real identification service only has to start returning a non-null `suggestedTaxonomyId` — resolving a real name from it becomes this command's one line to change, not a new code path to build. */
const UNIDENTIFIED_PLANT_DISPLAY_NAME = 'Unidentified plant';

export interface AddPlantFromPhotoInput {
  readonly gardenAreaMapObjectId?: Uuid;
  readonly placementMapObjectId?: Uuid;
  readonly photoMediaId: Uuid;
}

function normalizedPlacement(input: AddPlantFromPhotoInput): PlantPlacement {
  return {
    gardenAreaMapObjectId: input.gardenAreaMapObjectId ?? null,
    placementMapObjectId: input.placementMapObjectId ?? null,
  };
}

export class AddPlantFromPhoto {
  constructor(
    private readonly idempotency: IdempotencyStore,
    private readonly unitOfWork: PlantsInventoryUnitOfWork,
    private readonly authorization: GardenAuthorization,
    private readonly clock: Clock,
  ) {}

  async execute(
    gardenId: Uuid,
    profileId: Uuid,
    input: AddPlantFromPhotoInput,
    idempotencyKey: string,
  ): Promise<PlantResource> {
    await this.authorization.requireCapability(gardenId, profileId, 'editGardenContent');

    const idempotencyInput = {
      actorProfileId: profileId,
      operation: OPERATION,
      idempotencyKey,
      requestFingerprint: JSON.stringify({ gardenId, input }),
    };

    return runIdempotentCommand(
      this.idempotency,
      this.unitOfWork,
      idempotencyInput,
      201,
      async (context) => {
        const media = await context.media.get(input.photoMediaId);
        if (media === null) {
          throw invalidMediaReferenceError('/photoMediaId');
        }

        const now = this.clock.now();
        const placement = normalizedPlacement(input);
        await requirePlacementReferencesGardenObjects(context.mapObjects, gardenId, placement);

        const plant = createPlant(
          generateUuidV7(),
          gardenId,
          placement,
          UNIDENTIFIED_PLANT_DISPLAY_NAME,
          // `taxonomyReferenceId` stays null: identification never auto-confirms.
          null,
          null,
          null,
          null,
          'individual',
          undefined,
          profileId,
          now,
        );
        await context.plants.insert(plant);

        const photo = createPlantPhoto(generateUuidV7(), plant.id, input.photoMediaId, true, now);
        await context.plantPhotos.insert(photo);

        const suggestion = identifyPlantFromPhoto(input.photoMediaId);
        const identification = createPlantIdentification(
          generateUuidV7(),
          plant.id,
          photo.id,
          suggestion.suggestedTaxonomyId,
          suggestion.confidenceScore,
          now,
        );
        await context.plantIdentifications.insert(identification);

        await context.revisionJournal.record({
          plantId: plant.id,
          revision: plant.revision,
          commandType: 'addPlantFromPhoto',
          lifecycleStage: plant.lifecycleStage,
          status: plant.status,
          actorProfileId: profileId,
        });
        await context.syncChanges.record({
          gardenId: plant.gardenId,
          recordId: plant.id,
          recordType: 'plant',
          operation: 'upsert',
          recordRevision: plant.revision,
        });

        return toPlantResource(plant);
      },
    );
  }
}
