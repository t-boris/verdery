/**
 * Routes one `recordType: 'plant'` sync operation to plants-inventory's nine
 * plant command classes.
 *
 * Two commands (`attachPlantPhoto`, `setPrimaryPlantPhoto`) return a
 * `PlantPhotoResource`, not a `PlantResource` — they do not touch `plant`
 * itself (see each command's own doc comment) — so `recordRevisions` for
 * those two is built from a follow-up `PlantRepository.findById` read of the
 * plant's own (unbumped) revision, not from the command's return value.
 *
 * `operationId` reused as each command's own `idempotencyKey` argument for
 * the same reason `route-garden-operation.ts`'s own header comment gives.
 */

import type {
  Plant as PlantResourceContract,
  SyncPlantOperationPayload,
  SyncRecordReference,
} from '@verdery/api-contracts';
import type {
  AddPlant,
  AddPlantFromPhoto,
  AttachPlantPhoto,
  ConfirmPlantIdentification,
  GetPlant,
  MovePlant,
  PlantRepository,
  SetPlantStatus,
  SetPrimaryPlantPhoto,
  TransitionPlantLifecycleStage,
  UpdatePlantDetails,
} from '../../plants-inventory/public.js';
import type { PlantResource } from '../../plants-inventory/public.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import { InternalError } from '../../../platform/errors/application-error.js';
import { executeAndMapOutcome } from './execute-and-map-outcome.js';
import type { SyncOperationOutcome } from './sync-operation-outcome.js';

export interface PlantOperationRouterDependencies {
  readonly addPlant: AddPlant;
  readonly addPlantFromPhoto: AddPlantFromPhoto;
  readonly updatePlantDetails: UpdatePlantDetails;
  readonly attachPlantPhoto: AttachPlantPhoto;
  readonly setPrimaryPlantPhoto: SetPrimaryPlantPhoto;
  readonly confirmPlantIdentification: ConfirmPlantIdentification;
  readonly transitionPlantLifecycleStage: TransitionPlantLifecycleStage;
  readonly setPlantStatus: SetPlantStatus;
  readonly movePlant: MovePlant;
  readonly getPlant: GetPlant;
  readonly plants: PlantRepository;
}

function toRecordRevisions(plant: PlantResource | PlantResourceContract): SyncRecordReference[] {
  return [{ recordId: plant.id, recordType: 'plant', revision: plant.revision }];
}

/**
 * Re-reads the plant's own (unbumped) current revision for a command whose
 * own return value is a child resource, not `Plant` itself — see this file's
 * own header comment.
 */
async function currentPlantRecordRevisions(
  deps: PlantOperationRouterDependencies,
  plantId: Uuid,
): Promise<SyncRecordReference[]> {
  const plant = await deps.plants.findById(plantId);
  if (plant === null) {
    // Unreachable in practice: the command that just ran required this same
    // plant to exist and be authorized. An internal error is more honest
    // than silently omitting the plant from `recordRevisions`.
    throw new InternalError(
      'synchronization.plant.missing_after_write',
      'Plant not found after a successful write.',
    );
  }
  return [{ recordId: plant.id, recordType: 'plant', revision: plant.revision }];
}

export async function routePlantOperation(
  deps: PlantOperationRouterDependencies,
  profileId: Uuid,
  operationId: Uuid,
  payload: SyncPlantOperationPayload,
): Promise<SyncOperationOutcome> {
  const { gardenId, command } = payload;

  // `PlantResource` (this module's own view shape — see `plant-view.ts`'s own
  // doc comment) and the api-contracts-generated `Plant` differ only in how
  // strictly TypeScript types a handful of enum-like fields (`string` versus
  // a literal union); both already serialize to byte-identical JSON. A
  // double cast through `unknown` is correct here, not a structural mismatch
  // to paper over silently — see `route-garden-object-operation.ts`'s own
  // identical comment on `GardenObjectResource`/`GardenObject`.
  const fetchCurrentRecordFor = (plantId: Uuid) => async () => ({
    recordType: 'plant' as const,
    data: (await deps.getPlant.execute(
      gardenId,
      plantId,
      profileId,
    )) as unknown as PlantResourceContract,
  });

  switch (command.commandType) {
    case 'plants.addPlant':
      return executeAndMapOutcome(async () => {
        const plant = await deps.addPlant.execute(
          gardenId,
          profileId,
          { ...command.request, plantId: command.plantId },
          operationId,
        );
        return toRecordRevisions(plant);
      }, null);

    case 'plants.addPlantFromPhoto':
      return executeAndMapOutcome(async () => {
        const plant = await deps.addPlantFromPhoto.execute(
          gardenId,
          profileId,
          { ...command.request, plantId: command.plantId },
          operationId,
        );
        return toRecordRevisions(plant);
      }, null);

    case 'plants.updateDetails':
      return executeAndMapOutcome(async () => {
        const plant = await deps.updatePlantDetails.execute(
          command.plantId,
          profileId,
          command.expectedRevision,
          command.request,
          operationId,
        );
        return toRecordRevisions(plant);
      }, fetchCurrentRecordFor(command.plantId));

    case 'plants.attachPlantPhoto':
      return executeAndMapOutcome(async () => {
        await deps.attachPlantPhoto.execute(
          command.plantId,
          profileId,
          { ...command.request, plantPhotoId: command.plantPhotoId },
          operationId,
        );
        return currentPlantRecordRevisions(deps, command.plantId);
      }, null);

    case 'plants.setPrimaryPlantPhoto':
      return executeAndMapOutcome(async () => {
        await deps.setPrimaryPlantPhoto.execute(
          command.plantId,
          profileId,
          command.plantPhotoId,
          operationId,
        );
        return currentPlantRecordRevisions(deps, command.plantId);
      }, null);

    case 'plants.confirmIdentification':
      return executeAndMapOutcome(async () => {
        const plant = await deps.confirmPlantIdentification.execute(
          command.plantId,
          profileId,
          command.identificationId,
          command.expectedRevision,
          operationId,
        );
        return toRecordRevisions(plant);
      }, fetchCurrentRecordFor(command.plantId));

    case 'plants.transitionLifecycleStage':
      return executeAndMapOutcome(async () => {
        const plant = await deps.transitionPlantLifecycleStage.execute(
          command.plantId,
          profileId,
          command.expectedRevision,
          command.request.stage,
          operationId,
        );
        return toRecordRevisions(plant);
      }, fetchCurrentRecordFor(command.plantId));

    case 'plants.setStatus':
      return executeAndMapOutcome(async () => {
        const plant = await deps.setPlantStatus.execute(
          command.plantId,
          profileId,
          command.expectedRevision,
          command.request.status,
          operationId,
        );
        return toRecordRevisions(plant);
      }, fetchCurrentRecordFor(command.plantId));

    case 'plants.movePlant':
      return executeAndMapOutcome(async () => {
        const plant = await deps.movePlant.execute(
          command.plantId,
          profileId,
          command.expectedRevision,
          command.request,
          operationId,
        );
        return toRecordRevisions(plant);
      }, fetchCurrentRecordFor(command.plantId));
  }
}
