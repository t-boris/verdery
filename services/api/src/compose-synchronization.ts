/**
 * Composition-root helper for the synchronization module (P5-BE-01/
 * P5-API-01), split out of `app.ts` purely to keep that file at or below the
 * repository's 600-line source-file limit — the same reason
 * `compose-gardens-mapping.ts` exists, and still composition-root code, not
 * a module boundary; see that file's own header comment for the full
 * rationale, which applies here verbatim.
 *
 * Called last, after every other module's own dependency-bundle object is
 * built: this module routes across all five record families, so it needs
 * `gardenRoutesDependencies`/`mapRoutesDependencies`/`plantRoutesDependencies`/
 * `observationRoutesDependencies`/`taskRoutesDependencies` already
 * constructed — reused directly rather than re-constructing a second set of
 * command instances, since each one already bundles exactly the command
 * classes this module's own routers need to call.
 */

import {
  KyselyCalibrationRepository,
  GetCalibration,
  GetMapObject,
  KyselyMapObjectRepository,
  KyselyMembershipRepository,
} from './modules/gardens-mapping/public.js';
import type {
  GardenAuthorization,
  GardenRoutesDependencies,
  MapRoutesDependencies,
} from './modules/gardens-mapping/public.js';
import {
  GetObservationForSync,
  KyselyObservationRepository,
} from './modules/observations-history/public.js';
import type { ObservationRoutesDependencies } from './modules/observations-history/public.js';
import { KyselyPlantRepository } from './modules/plants-inventory/public.js';
import type { PlantRoutesDependencies } from './modules/plants-inventory/public.js';
import { GetTask, KyselyTaskRepository } from './modules/tasks-recommendations/public.js';
import type { TaskRoutesDependencies } from './modules/tasks-recommendations/public.js';
import {
  AcknowledgeSyncOperations,
  GetSyncChanges,
  KyselySyncChangeQuery,
  KyselySyncClientInstallationRepository,
  PushSyncOperations,
  RegisterSyncClient,
  SyncOperationRouter,
} from './modules/synchronization/public.js';
import type { SyncRoutesDependencies } from './modules/synchronization/public.js';
import type { DatabaseGateway } from './platform/database/database-gateway.js';
import { KyselyIdempotencyStore } from './platform/idempotency/kysely-idempotency-store.js';
import type { Clock } from './shared/time/clock.js';

export interface SynchronizationComposition {
  readonly syncRoutesDependencies: SyncRoutesDependencies;
}

export function composeSynchronization(
  database: DatabaseGateway,
  clock: Clock,
  gardenAuthorization: GardenAuthorization,
  gardenRoutesDependencies: GardenRoutesDependencies,
  mapRoutesDependencies: MapRoutesDependencies,
  plantRoutesDependencies: PlantRoutesDependencies,
  observationRoutesDependencies: ObservationRoutesDependencies,
  taskRoutesDependencies: TaskRoutesDependencies,
): SynchronizationComposition {
  // synchronization: owns `platform.sync_client_installation` (see that
  // migration's own comment for why it lives in `platform`'s schema despite
  // being exclusively this module's). `synchronizationIdempotency` is its
  // own instance, matching the one-`KyselyIdempotencyStore`-per-module
  // convention every sibling module's own composition already follows
  // (`gardenIdempotency`, `plantsInventoryIdempotency`, and so on in
  // `app.ts`) — the underlying table and port are shared infrastructure, but
  // each module still injects its own handle.
  const synchronizationIdempotency = new KyselyIdempotencyStore(database.queries, clock);
  const installations = new KyselySyncClientInstallationRepository(database.queries);
  const registerSyncClient = new RegisterSyncClient(
    installations,
    synchronizationIdempotency,
    clock,
  );

  // Two read-only, pooled repositories this module needs for its own
  // `GetMapObject`/`upsertCalibration` follow-up reads (see
  // `route-garden-object-operation.ts`) that no other module's own
  // composition currently constructs and exposes — gardens-mapping's own
  // `CreateMapObject`/`UpsertMapCalibration` only ever reach `mapObjects`/
  // `calibrations` through their transactional unit-of-work context, not as
  // a directly injectable constructor dependency.
  const mapObjectRepository = new KyselyMapObjectRepository(database.queries);
  const calibrationRepository = new KyselyCalibrationRepository(database.queries);
  const getMapObject = new GetMapObject(mapObjectRepository, gardenAuthorization);

  // Read-only, pooled repositories for the two "re-read the unbumped
  // revision" follow-ups `route-plant-operation.ts`/`route-task-operation.ts`
  // need after `attachPlantPhoto`/`setPrimaryPlantPhoto`/`attachTaskFile` —
  // separate instances from the ones each sibling module's own composition
  // constructs for the identical reason `mapObjectRepository` above is.
  const plantRepository = new KyselyPlantRepository(database.queries);
  const taskRepository = new KyselyTaskRepository(database.queries);
  const getTask = new GetTask(taskRepository, gardenAuthorization);

  const router = new SyncOperationRouter({
    garden: {
      createGarden: gardenRoutesDependencies.createGarden,
      renameGarden: gardenRoutesDependencies.renameGarden,
      archiveGarden: gardenRoutesDependencies.archiveGarden,
      requestGardenDeletion: gardenRoutesDependencies.requestGardenDeletion,
      getGarden: gardenRoutesDependencies.getGarden,
    },
    gardenObject: {
      createMapObject: mapRoutesDependencies.createMapObject,
      moveMapObject: mapRoutesDependencies.moveMapObject,
      replaceMapObjectGeometry: mapRoutesDependencies.replaceMapObjectGeometry,
      editMapObjectVertex: mapRoutesDependencies.editMapObjectVertex,
      splitMapObjectLinework: mapRoutesDependencies.splitMapObjectLinework,
      joinMapObjectLinework: mapRoutesDependencies.joinMapObjectLinework,
      changeMapObjectProperties: mapRoutesDependencies.changeMapObjectProperties,
      assignPlantToTarget: mapRoutesDependencies.assignPlantToTarget,
      upsertMapCalibration: mapRoutesDependencies.upsertMapCalibration,
      decideMapProposal: mapRoutesDependencies.decideMapProposal,
      deleteMapObject: mapRoutesDependencies.deleteMapObject,
      restoreMapObject: mapRoutesDependencies.restoreMapObject,
      duplicateMapObject: mapRoutesDependencies.duplicateMapObject,
      getMapObject,
      calibrations: calibrationRepository,
    },
    plant: {
      addPlant: plantRoutesDependencies.addPlant,
      addPlantFromPhoto: plantRoutesDependencies.addPlantFromPhoto,
      updatePlantDetails: plantRoutesDependencies.updatePlantDetails,
      attachPlantPhoto: plantRoutesDependencies.attachPlantPhoto,
      setPrimaryPlantPhoto: plantRoutesDependencies.setPrimaryPlantPhoto,
      confirmPlantIdentification: plantRoutesDependencies.confirmPlantIdentification,
      transitionPlantLifecycleStage: plantRoutesDependencies.transitionPlantLifecycleStage,
      setPlantStatus: plantRoutesDependencies.setPlantStatus,
      movePlant: plantRoutesDependencies.movePlant,
      getPlant: plantRoutesDependencies.getPlant,
      plants: plantRepository,
    },
    observation: {
      recordObservation: observationRoutesDependencies.recordObservation,
      correctObservation: observationRoutesDependencies.correctObservation,
    },
    task: {
      createManualTask: taskRoutesDependencies.createManualTask,
      editTask: taskRoutesDependencies.editTask,
      rescheduleTask: taskRoutesDependencies.rescheduleTask,
      completeTask: taskRoutesDependencies.completeTask,
      dismissTask: taskRoutesDependencies.dismissTask,
      skipTask: taskRoutesDependencies.skipTask,
      deleteTask: taskRoutesDependencies.deleteTask,
      attachTaskFile: taskRoutesDependencies.attachTaskFile,
      getTask,
      tasks: taskRepository,
    },
  });

  const pushSyncOperations = new PushSyncOperations(synchronizationIdempotency, router);
  const acknowledgeSyncOperations = new AcknowledgeSyncOperations(synchronizationIdempotency);

  // `GetSyncChanges` (P5-BE-02): three more read-only, pooled dependencies
  // this pass needs and no existing composition already exposes —
  // `membershipRepository` for the garden-partition split
  // `GetSyncChanges`'s own header comment explains, `observationRepository`
  // for `GetObservationForSync`'s history-enriched read, and
  // `syncChangeQuery` over `platform.sync_change` itself. `getCalibration`/
  // `getObservationForSync` are this pass's own two new authorized readers;
  // `getGarden`/`getMapObject`/`getPlant`/`getTask` are the exact same
  // instances the router above already uses, reused rather than duplicated —
  // each is stateless and already authorized per call, so sharing one
  // instance across both push's conflict payloads and pull's upsert
  // snapshots is correct, not merely convenient.
  const membershipRepository = new KyselyMembershipRepository(database.queries);
  const observationRepository = new KyselyObservationRepository(database.queries);
  const getCalibration = new GetCalibration(calibrationRepository, gardenAuthorization);
  const getObservationForSync = new GetObservationForSync(
    observationRepository,
    gardenAuthorization,
  );
  const syncChangeQuery = new KyselySyncChangeQuery(database.queries);
  const getSyncChanges = new GetSyncChanges(
    membershipRepository,
    syncChangeQuery,
    {
      getGarden: gardenRoutesDependencies.getGarden,
      getMapObject,
      getCalibration,
      getPlant: plantRoutesDependencies.getPlant,
      getObservationForSync,
      getTask,
    },
    clock,
  );

  return {
    syncRoutesDependencies: {
      registerSyncClient,
      pushSyncOperations,
      getSyncChanges,
      acknowledgeSyncOperations,
    },
  };
}
