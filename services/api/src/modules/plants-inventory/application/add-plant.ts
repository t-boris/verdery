import type { IdempotencyStore } from '../../../platform/idempotency/idempotency-store.js';
import { generateUuidV7 } from '../../../shared/identifiers/uuid.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { Clock } from '../../../shared/time/clock.js';
import type { GardenAuthorization } from '../../gardens-mapping/public.js';
import type { AcquisitionDateType, GroupingKind, PlantPlacement } from '../domain/plant.js';
import { createPlant } from '../domain/plant.js';
import { toPlantResource, type PlantResource } from './plant-view.js';
import type { PlantsInventoryUnitOfWork } from './plants-inventory-unit-of-work.js';
import { requirePlacementReferencesGardenObjects } from './require-plant-placement-in-garden.js';
import { runIdempotentCommand } from './run-idempotent-command.js';

const OPERATION = 'plants.addPlant';

export interface AddPlantInput {
  /**
   * Client-generated id for the new plant, when supplied — optional and
   * defaulted to a fresh `generateUuidV7()` so every existing caller (the
   * ordinary REST route, which has no id to supply) is unaffected. Added for
   * the synchronization module's `plants.addPlant` sync command, whose own
   * payload names `plantId` explicitly for the same "offline optimistic
   * creation needs a stable id up front" reason `CreateGarden`'s own doc
   * comment gives.
   */
  readonly plantId?: Uuid;
  readonly gardenAreaMapObjectId?: Uuid;
  readonly placementMapObjectId?: Uuid;
  readonly displayName: string;
  readonly taxonomyReferenceId?: Uuid | null;
  readonly varietyLabel?: string | null;
  readonly acquisitionDate?: string | null;
  readonly acquisitionDateType?: AcquisitionDateType | null;
  readonly groupingKind: GroupingKind;
  readonly quantity?: number | null;
}

function normalizedPlacement(input: AddPlantInput): PlantPlacement {
  return {
    gardenAreaMapObjectId: input.gardenAreaMapObjectId ?? null,
    placementMapObjectId: input.placementMapObjectId ?? null,
  };
}

export class AddPlant {
  constructor(
    private readonly idempotency: IdempotencyStore,
    private readonly unitOfWork: PlantsInventoryUnitOfWork,
    private readonly authorization: GardenAuthorization,
    private readonly clock: Clock,
  ) {}

  async execute(
    gardenId: Uuid,
    profileId: Uuid,
    input: AddPlantInput,
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
        const now = this.clock.now();
        const placement = normalizedPlacement(input);
        await requirePlacementReferencesGardenObjects(context.mapObjects, gardenId, placement);

        const plant = createPlant(
          input.plantId ?? generateUuidV7(),
          gardenId,
          placement,
          input.displayName,
          input.taxonomyReferenceId ?? null,
          input.varietyLabel ?? null,
          input.acquisitionDate ?? null,
          input.acquisitionDateType ?? null,
          input.groupingKind,
          input.quantity,
          profileId,
          now,
        );

        await context.plants.insert(plant);
        await context.revisionJournal.record({
          plantId: plant.id,
          revision: plant.revision,
          commandType: 'addPlant',
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
