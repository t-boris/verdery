import type { IdempotencyStore } from '../../../platform/idempotency/idempotency-store.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { Clock } from '../../../shared/time/clock.js';
import type { GardenAuthorization } from '../../gardens-mapping/public.js';
import type { PlantDetailsChanges } from '../domain/plant.js';
import { updatePlantDetails } from '../domain/plant.js';
import { applyPlantRevisionGuardedUpdate } from './apply-plant-revision-guarded-update.js';
import type { PlantRepository } from './plant-repository.js';
import { toPlantResource, type PlantResource } from './plant-view.js';
import type { PlantsInventoryUnitOfWork } from './plants-inventory-unit-of-work.js';
import { requirePlantAndAuthorize } from './require-plant-and-authorize.js';
import { runIdempotentCommand } from './run-idempotent-command.js';

const OPERATION = 'plants.updateDetails';

export class UpdatePlantDetails {
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
    expectedRevision: number,
    changes: PlantDetailsChanges,
    idempotencyKey: string,
  ): Promise<PlantResource> {
    await requirePlantAndAuthorize(this.plants, this.authorization, plantId, profileId);

    const idempotencyInput = {
      actorProfileId: profileId,
      operation: OPERATION,
      idempotencyKey,
      requestFingerprint: JSON.stringify({ plantId, expectedRevision, changes }),
    };

    return runIdempotentCommand(
      this.idempotency,
      this.unitOfWork,
      idempotencyInput,
      200,
      async (context) => {
        const now = this.clock.now();
        const updated = await applyPlantRevisionGuardedUpdate(
          context.plants,
          plantId,
          expectedRevision,
          (plant) => updatePlantDetails(plant, changes, now),
        );

        await context.revisionJournal.record({
          plantId: updated.id,
          revision: updated.revision,
          commandType: 'updateDetails',
          lifecycleStage: null,
          status: null,
          actorProfileId: profileId,
        });

        return toPlantResource(updated);
      },
    );
  }
}
