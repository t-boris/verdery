/**
 * Routes one `recordType: 'gardenObject'` sync operation to gardens-mapping's
 * thirteen map command classes.
 *
 * `SyncGardenObjectOperationPayload.command` reuses `MapCommandPayload`
 * verbatim (the same union `SubmitMapCommand` accepts), so this is
 * structurally the same 13-way switch `gardens-mapping/transport/
 * map-routes.ts` already writes for the REST endpoint — mirrored here
 * deliberately rather than shared, since `map-routes.ts`'s switch lives in
 * that module's own (non-public) transport layer and is not something this
 * module may import across the module boundary (only `public.ts` is).
 *
 * `operationId` reused as each command's own `idempotencyKey` argument for
 * the same reason `route-garden-operation.ts`'s own header comment gives.
 */

import type {
  GardenObject as GardenObjectContract,
  SyncGardenObjectOperationPayload,
  SyncRecordReference,
} from '@verdery/api-contracts';
import type { MapCommandPayload } from '@verdery/geometry-contracts';
import type {
  AssignPlantToTarget,
  ChangeMapObjectProperties,
  CreateMapObject,
  DecideMapProposal,
  DeleteMapObject,
  DuplicateMapObject,
  EditMapObjectVertex,
  GardenObjectResource,
  GetMapObject,
  JoinMapObjectLinework,
  MapCommandResultResource,
  MoveMapObject,
  ReplaceMapObjectGeometry,
  RestoreMapObject,
  SplitMapObjectLinework,
  UpsertMapCalibration,
} from '../../gardens-mapping/public.js';
import type { CalibrationRepository } from '../../gardens-mapping/public.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import { executeAndMapOutcome } from './execute-and-map-outcome.js';
import type { SyncOperationOutcome } from './sync-operation-outcome.js';

export interface GardenObjectOperationRouterDependencies {
  readonly createMapObject: CreateMapObject;
  readonly moveMapObject: MoveMapObject;
  readonly replaceMapObjectGeometry: ReplaceMapObjectGeometry;
  readonly editMapObjectVertex: EditMapObjectVertex;
  readonly splitMapObjectLinework: SplitMapObjectLinework;
  readonly joinMapObjectLinework: JoinMapObjectLinework;
  readonly changeMapObjectProperties: ChangeMapObjectProperties;
  readonly assignPlantToTarget: AssignPlantToTarget;
  readonly upsertMapCalibration: UpsertMapCalibration;
  readonly decideMapProposal: DecideMapProposal;
  readonly deleteMapObject: DeleteMapObject;
  readonly restoreMapObject: RestoreMapObject;
  readonly duplicateMapObject: DuplicateMapObject;
  readonly getMapObject: GetMapObject;
  readonly calibrations: CalibrationRepository;
}

function toRecordRevisions(objects: readonly GardenObjectResource[]): SyncRecordReference[] {
  return objects.map((object) => ({
    recordId: object.id,
    recordType: 'gardenObject',
    revision: object.revision,
  }));
}

/**
 * `upsertCalibration` also creates a `platform.sync_change` row for
 * `recordType: 'calibration'` (see `upsert-map-calibration.ts`), but its own
 * `MapCommandResultResource` only ever names the affected background
 * `gardenObject` — it has no field for the calibration it just inserted. The
 * calibration's id/revision is recovered here with one follow-up read
 * (`CalibrationRepository.findLatestForBackground`, already exported),
 * rather than left out of `recordRevisions`, since section "8. Push
 * Protocol" says the response carries "authoritative record revisions...
 * needed to update the local projection" for everything the operation
 * changed, not only its primary target.
 */
async function withCalibrationRevision(
  deps: GardenObjectOperationRouterDependencies,
  backgroundObjectId: Uuid,
  base: SyncRecordReference[],
): Promise<SyncRecordReference[]> {
  const calibration = await deps.calibrations.findLatestForBackground(backgroundObjectId);
  if (calibration === null) {
    // Not reachable in practice — `UpsertMapCalibration` just inserted this
    // row in the same transaction — but a defensive fallback is cheaper and
    // more honest than a non-null assertion.
    return base;
  }
  return [
    ...base,
    { recordId: calibration.id, recordType: 'calibration', revision: calibration.revision },
  ];
}

export async function routeGardenObjectOperation(
  deps: GardenObjectOperationRouterDependencies,
  profileId: Uuid,
  operationId: Uuid,
  payload: SyncGardenObjectOperationPayload,
): Promise<SyncOperationOutcome> {
  const { gardenId, command } = payload;
  // `SyncGardenObjectOperationPayload.command` reuses `MapCommandPayload`
  // verbatim on the wire (same JSON Schema), but the api-contracts-generated
  // TS type and geometry-contracts' own hand-written type diverge in ways
  // that don't matter at runtime (a loose `number[]` versus a strict
  // `readonly [number, number]` tuple for `Position`, for example — see
  // `map-object-view.ts`'s own doc comment on the identical divergence for
  // `GardenObjectResource`) — a double cast through `unknown` is the correct
  // tool here, not a structural mismatch to paper over silently.
  const mapCommand = command as unknown as MapCommandPayload;

  const fetchCurrentRecordFor = (objectId: Uuid) => async () => ({
    recordType: 'gardenObject' as const,
    data: (await deps.getMapObject.execute(
      gardenId,
      objectId,
      profileId,
    )) as unknown as GardenObjectContract,
  });

  const runCommand = async (
    result: Promise<MapCommandResultResource>,
  ): Promise<SyncRecordReference[]> => toRecordRevisions((await result).affectedObjects);

  switch (mapCommand.type) {
    case 'createObject':
      return executeAndMapOutcome(
        () =>
          runCommand(deps.createMapObject.execute(gardenId, profileId, mapCommand, operationId)),
        null,
      );
    case 'moveObject':
      return executeAndMapOutcome(
        () => runCommand(deps.moveMapObject.execute(gardenId, profileId, mapCommand, operationId)),
        fetchCurrentRecordFor(mapCommand.objectId),
      );
    case 'replaceGeometry':
      return executeAndMapOutcome(
        () =>
          runCommand(
            deps.replaceMapObjectGeometry.execute(gardenId, profileId, mapCommand, operationId),
          ),
        fetchCurrentRecordFor(mapCommand.objectId),
      );
    case 'editVertex':
      return executeAndMapOutcome(
        () =>
          runCommand(
            deps.editMapObjectVertex.execute(gardenId, profileId, mapCommand, operationId),
          ),
        fetchCurrentRecordFor(mapCommand.objectId),
      );
    case 'splitLinework':
      return executeAndMapOutcome(
        () =>
          runCommand(
            deps.splitMapObjectLinework.execute(gardenId, profileId, mapCommand, operationId),
          ),
        fetchCurrentRecordFor(mapCommand.objectId),
      );
    case 'joinLinework':
      return executeAndMapOutcome(
        () =>
          runCommand(
            deps.joinMapObjectLinework.execute(gardenId, profileId, mapCommand, operationId),
          ),
        fetchCurrentRecordFor(mapCommand.firstObjectId),
      );
    case 'changeProperties':
      return executeAndMapOutcome(
        () =>
          runCommand(
            deps.changeMapObjectProperties.execute(gardenId, profileId, mapCommand, operationId),
          ),
        fetchCurrentRecordFor(mapCommand.objectId),
      );
    case 'assignPlant':
      return executeAndMapOutcome(
        () =>
          runCommand(
            deps.assignPlantToTarget.execute(gardenId, profileId, mapCommand, operationId),
          ),
        fetchCurrentRecordFor(mapCommand.plantObjectId),
      );
    case 'upsertCalibration':
      return executeAndMapOutcome(async () => {
        const result = await deps.upsertMapCalibration.execute(
          gardenId,
          profileId,
          mapCommand,
          operationId,
        );
        return withCalibrationRevision(
          deps,
          mapCommand.backgroundObjectId,
          toRecordRevisions(result.affectedObjects),
        );
      }, null);
    case 'decideProposal':
      // `DecideMapProposal` always throws `notFound` this pass (see its own
      // doc comment) — never a stale-revision conflict, so `null` here.
      return executeAndMapOutcome(
        () => runCommand(deps.decideMapProposal.execute(gardenId, profileId, mapCommand)),
        null,
      );
    case 'deleteObject':
      return executeAndMapOutcome(
        () =>
          runCommand(deps.deleteMapObject.execute(gardenId, profileId, mapCommand, operationId)),
        fetchCurrentRecordFor(mapCommand.objectId),
      );
    case 'restoreObject':
      return executeAndMapOutcome(
        () =>
          runCommand(deps.restoreMapObject.execute(gardenId, profileId, mapCommand, operationId)),
        fetchCurrentRecordFor(mapCommand.objectId),
      );
    case 'duplicateObject':
      // No `expectedRevision` — the source is only read, never written (see
      // `DuplicateMapObject`'s own doc comment) — so no conflict producer.
      return executeAndMapOutcome(
        () =>
          runCommand(deps.duplicateMapObject.execute(gardenId, profileId, mapCommand, operationId)),
        null,
      );
  }
}
