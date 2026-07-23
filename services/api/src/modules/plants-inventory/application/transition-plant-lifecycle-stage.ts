import type { IdempotencyStore } from '../../../platform/idempotency/idempotency-store.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { Clock } from '../../../shared/time/clock.js';
import type { GardenAuthorization } from '../../gardens-mapping/public.js';
import type { LifecycleStage } from '../domain/plant-lifecycle.js';
import { transitionPlantLifecycleStage } from '../domain/plant-lifecycle.js';
import { applyPlantRevisionGuardedUpdate } from './apply-plant-revision-guarded-update.js';
import type { PlantRepository } from './plant-repository.js';
import { toPlantResource, type PlantResource } from './plant-view.js';
import type { PlantsInventoryUnitOfWork } from './plants-inventory-unit-of-work.js';
import { requirePlantAndAuthorize } from './require-plant-and-authorize.js';
import { runIdempotentCommand } from './run-idempotent-command.js';

const OPERATION = 'plants.transitionLifecycleStage';

export class TransitionPlantLifecycleStage {
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
    newStage: LifecycleStage,
    idempotencyKey: string,
  ): Promise<PlantResource> {
    await requirePlantAndAuthorize(this.plants, this.authorization, plantId, profileId);

    const idempotencyInput = {
      actorProfileId: profileId,
      operation: OPERATION,
      idempotencyKey,
      requestFingerprint: JSON.stringify({ plantId, expectedRevision, newStage }),
    };

    return runIdempotentCommand(
      this.idempotency,
      this.unitOfWork,
      idempotencyInput,
      200,
      async (context) => {
        const now = this.clock.now();
        const transitioned = await applyPlantRevisionGuardedUpdate(
          context.plants,
          plantId,
          expectedRevision,
          (plant) => transitionPlantLifecycleStage(plant, newStage, now),
        );

        await context.revisionJournal.record({
          plantId: transitioned.id,
          revision: transitioned.revision,
          commandType: 'transitionLifecycleStage',
          lifecycleStage: transitioned.lifecycleStage,
          status: null,
          actorProfileId: profileId,
        });
        await context.syncChanges.record({
          gardenId: transitioned.gardenId,
          recordId: transitioned.id,
          recordType: 'plant',
          operation: 'upsert',
          recordRevision: transitioned.revision,
        });

        return toPlantResource(transitioned);
      },
    );
  }
}
