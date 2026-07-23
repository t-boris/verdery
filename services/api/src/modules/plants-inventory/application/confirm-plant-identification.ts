import type { IdempotencyStore } from '../../../platform/idempotency/idempotency-store.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { Clock } from '../../../shared/time/clock.js';
import type { GardenAuthorization } from '../../gardens-mapping/public.js';
import { confirmPlantIdentification } from '../domain/plant.js';
import { applyPlantRevisionGuardedUpdate } from './apply-plant-revision-guarded-update.js';
import {
  plantIdentificationMismatchError,
  plantIdentificationNotFoundError,
} from './plant-errors.js';
import type { PlantRepository } from './plant-repository.js';
import { toPlantResource, type PlantResource } from './plant-view.js';
import type { PlantsInventoryUnitOfWork } from './plants-inventory-unit-of-work.js';
import { requirePlantAndAuthorize } from './require-plant-and-authorize.js';
import { runIdempotentCommand } from './run-idempotent-command.js';

const OPERATION = 'plants.confirmIdentification';

export class ConfirmPlantIdentification {
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
    identificationId: Uuid,
    expectedRevision: number,
    idempotencyKey: string,
  ): Promise<PlantResource> {
    await requirePlantAndAuthorize(this.plants, this.authorization, plantId, profileId);

    const idempotencyInput = {
      actorProfileId: profileId,
      operation: OPERATION,
      idempotencyKey,
      requestFingerprint: JSON.stringify({ plantId, identificationId, expectedRevision }),
    };

    return runIdempotentCommand(
      this.idempotency,
      this.unitOfWork,
      idempotencyInput,
      200,
      async (context) => {
        const identification = await context.plantIdentifications.findById(identificationId);
        if (identification === null) {
          throw plantIdentificationNotFoundError();
        }
        if (identification.plantId !== plantId) {
          throw plantIdentificationMismatchError();
        }

        const now = this.clock.now();
        const confirmed = await applyPlantRevisionGuardedUpdate(
          context.plants,
          plantId,
          expectedRevision,
          (plant) =>
            confirmPlantIdentification(
              plant,
              identification.suggestedTaxonomyId,
              identification.id,
              now,
            ),
        );

        await context.revisionJournal.record({
          plantId: confirmed.id,
          revision: confirmed.revision,
          commandType: 'confirmIdentification',
          lifecycleStage: null,
          status: null,
          actorProfileId: profileId,
        });

        return toPlantResource(confirmed);
      },
    );
  }
}
