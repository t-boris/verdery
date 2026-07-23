/**
 * Updates placement fields only. `gardenId` itself never changes — both
 * placement fields, when given, must reference a `garden_object` in the
 * *same* garden the plant already belongs to, taken from the plant's own
 * row (fetched by `requirePlantAndAuthorize`), never from caller input.
 */

import type { IdempotencyStore } from '../../../platform/idempotency/idempotency-store.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { Clock } from '../../../shared/time/clock.js';
import type { GardenAuthorization } from '../../gardens-mapping/public.js';
import { movePlant } from '../domain/plant.js';
import type { PlantPlacement } from '../domain/plant.js';
import { applyPlantRevisionGuardedUpdate } from './apply-plant-revision-guarded-update.js';
import type { PlantRepository } from './plant-repository.js';
import { toPlantResource, type PlantResource } from './plant-view.js';
import type { PlantsInventoryUnitOfWork } from './plants-inventory-unit-of-work.js';
import { requirePlantAndAuthorize } from './require-plant-and-authorize.js';
import { requirePlacementReferencesGardenObjects } from './require-plant-placement-in-garden.js';
import { runIdempotentCommand } from './run-idempotent-command.js';

const OPERATION = 'plants.movePlant';

export interface MovePlantInput {
  readonly gardenAreaMapObjectId?: Uuid;
  readonly placementMapObjectId?: Uuid;
}

function normalizedPlacement(input: MovePlantInput): PlantPlacement {
  return {
    gardenAreaMapObjectId: input.gardenAreaMapObjectId ?? null,
    placementMapObjectId: input.placementMapObjectId ?? null,
  };
}

export class MovePlant {
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
    input: MovePlantInput,
    idempotencyKey: string,
  ): Promise<PlantResource> {
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
      requestFingerprint: JSON.stringify({ plantId, expectedRevision, input }),
    };

    return runIdempotentCommand(
      this.idempotency,
      this.unitOfWork,
      idempotencyInput,
      200,
      async (context) => {
        const now = this.clock.now();
        const placement = normalizedPlacement(input);
        await requirePlacementReferencesGardenObjects(
          context.mapObjects,
          plant.gardenId,
          placement,
        );

        const moved = await applyPlantRevisionGuardedUpdate(
          context.plants,
          plantId,
          expectedRevision,
          (p) => movePlant(p, placement, now),
        );

        await context.revisionJournal.record({
          plantId: moved.id,
          revision: moved.revision,
          commandType: 'movePlant',
          lifecycleStage: null,
          status: null,
          actorProfileId: profileId,
        });
        await context.syncChanges.record({
          gardenId: moved.gardenId,
          recordId: moved.id,
          recordType: 'plant',
          operation: 'upsert',
          recordRevision: moved.revision,
        });

        return toPlantResource(moved);
      },
    );
  }
}
