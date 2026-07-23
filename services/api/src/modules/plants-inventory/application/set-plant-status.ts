/**
 * Sets `plant.status` — the orthogonal axis from `lifecycleStage`. This is
 * also how "delete a plant" is modeled: there is no hard-delete command,
 * only a status transition (typically to `'removed'` or `'dead'`).
 */

import type { IdempotencyStore } from '../../../platform/idempotency/idempotency-store.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { Clock } from '../../../shared/time/clock.js';
import type { GardenAuthorization } from '../../gardens-mapping/public.js';
import type { PlantStatus } from '../domain/plant-lifecycle.js';
import { setPlantStatus } from '../domain/plant-lifecycle.js';
import { applyPlantRevisionGuardedUpdate } from './apply-plant-revision-guarded-update.js';
import type { PlantRepository } from './plant-repository.js';
import { toPlantResource, type PlantResource } from './plant-view.js';
import type { PlantsInventoryUnitOfWork } from './plants-inventory-unit-of-work.js';
import { requirePlantAndAuthorize } from './require-plant-and-authorize.js';
import { runIdempotentCommand } from './run-idempotent-command.js';

const OPERATION = 'plants.setStatus';

export class SetPlantStatus {
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
    newStatus: PlantStatus,
    idempotencyKey: string,
  ): Promise<PlantResource> {
    await requirePlantAndAuthorize(this.plants, this.authorization, plantId, profileId);

    const idempotencyInput = {
      actorProfileId: profileId,
      operation: OPERATION,
      idempotencyKey,
      requestFingerprint: JSON.stringify({ plantId, expectedRevision, newStatus }),
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
          (plant) => setPlantStatus(plant, newStatus, now),
        );

        await context.revisionJournal.record({
          plantId: transitioned.id,
          revision: transitioned.revision,
          commandType: 'setStatus',
          lifecycleStage: null,
          status: transitioned.status,
          actorProfileId: profileId,
        });
        // 'upsert', even for a transition to 'removed'/'dead': there is no
        // hard-delete for a plant (see this file's own header comment and
        // `domain/plant-lifecycle.ts`'s), so the row remains fully readable
        // and this stays a status upsert, never a sync tombstone.
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
