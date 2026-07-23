/**
 * Shared test harness for the synchronization module's integration tests:
 * constructs every sibling-module command, the five per-family router
 * dependency bundles, and the three synchronization use cases
 * (`registerSyncClient`, `pushSyncOperations`, `acknowledgeSyncOperations`)
 * against a real, migrated PostgreSQL/PostGIS database.
 *
 * Mirrors `compose-synchronization.ts`'s own wiring (the exact dependency
 * graph the running service builds), not a parallel or simplified one — the
 * one intentional difference is this harness constructs each sibling
 * module's own command classes directly (the same "construct only what a
 * test needs, directly" convention `tests/integration/tasks-recommendations.test.ts`'s
 * own `buildHandlers` already follows) rather than going through
 * `compose-gardens-mapping.ts`, since that file takes a `DatabaseGateway`
 * this harness has no other use for.
 *
 * Source: architecture/testing-strategy.md, section "6. Backend Integration Tests".
 */

import {
  ArchiveGarden,
  AssignPlantToTarget,
  ChangeMapObjectProperties,
  CreateGarden,
  CreateMapObject,
  DecideMapProposal,
  DeleteMapObject,
  DuplicateMapObject,
  EditMapObjectVertex,
  GardenAuthorization,
  GetCalibration,
  GetGarden,
  GetMapObject,
  JoinMapObjectLinework,
  KyselyCalibrationRepository,
  KyselyGardenRepository,
  KyselyGardensMappingUnitOfWork,
  KyselyMapObjectRepository,
  KyselyMembershipRepository,
  MoveMapObject,
  RenameGarden,
  ReplaceMapObjectGeometry,
  RequestGardenDeletion,
  RestoreMapObject,
  SplitMapObjectLinework,
  UpsertMapCalibration,
} from '../../src/modules/gardens-mapping/public.js';
import {
  KyselyObservationRepository,
  KyselyObservationsHistoryUnitOfWork,
  CorrectObservation,
  GetObservationForSync,
  RecordObservation,
} from '../../src/modules/observations-history/public.js';
import {
  AddPlant,
  AddPlantFromPhoto,
  AttachPlantPhoto,
  ConfirmPlantIdentification,
  GetPlant,
  KyselyPlantRepository,
  KyselyPlantsInventoryUnitOfWork,
  MovePlant,
  SetPlantStatus,
  SetPrimaryPlantPhoto,
  TransitionPlantLifecycleStage,
  UpdatePlantDetails,
} from '../../src/modules/plants-inventory/public.js';
import {
  AttachTaskFile,
  CompleteTask,
  CreateManualTask,
  DeleteTask,
  DismissTask,
  EditTask,
  GetTask,
  KyselyTaskRepository,
  KyselyTasksRecommendationsUnitOfWork,
  RescheduleTask,
  SkipTask,
} from '../../src/modules/tasks-recommendations/public.js';
import { GetObservation } from '../../src/modules/observations-history/public.js';
import {
  AcknowledgeSyncOperations,
  GetSyncChanges,
  KyselySyncChangeQuery,
  KyselySyncClientInstallationRepository,
  PushSyncOperations,
  RegisterSyncClient,
  SyncOperationRouter,
} from '../../src/modules/synchronization/public.js';
import type { DatabaseSchema } from '../../src/platform/database/database-gateway.js';
import { KyselyIdempotencyStore } from '../../src/platform/idempotency/kysely-idempotency-store.js';
import type { Clock } from '../../src/shared/time/clock.js';
import type { Kysely } from 'kysely';

export function buildSyncTestHarness(db: Kysely<DatabaseSchema>, clock: Clock) {
  const gardenAuthorization = new GardenAuthorization(new KyselyMembershipRepository(db));

  // garden family — shares one idempotency store/unit-of-work with the map
  // family, matching `compose-gardens-mapping.ts`'s own convention.
  const gardenIdempotency = new KyselyIdempotencyStore(db, clock);
  const gardensMappingUnitOfWork = new KyselyGardensMappingUnitOfWork(db, clock);
  const gardenRepository = new KyselyGardenRepository(db);
  const createGarden = new CreateGarden(gardenIdempotency, gardensMappingUnitOfWork, clock);
  const renameGarden = new RenameGarden(
    gardenIdempotency,
    gardensMappingUnitOfWork,
    gardenAuthorization,
    clock,
  );
  const archiveGarden = new ArchiveGarden(
    gardenIdempotency,
    gardensMappingUnitOfWork,
    gardenAuthorization,
    clock,
  );
  const requestGardenDeletion = new RequestGardenDeletion(
    gardenIdempotency,
    gardensMappingUnitOfWork,
    gardenAuthorization,
    clock,
  );
  const getGarden = new GetGarden(gardenRepository, gardenAuthorization);

  // gardenObject (map) family.
  const mapObjectRepository = new KyselyMapObjectRepository(db);
  const calibrationRepository = new KyselyCalibrationRepository(db);
  const createMapObject = new CreateMapObject(
    gardenIdempotency,
    gardensMappingUnitOfWork,
    gardenAuthorization,
    clock,
  );
  const moveMapObject = new MoveMapObject(
    gardenIdempotency,
    gardensMappingUnitOfWork,
    gardenAuthorization,
    clock,
  );
  const replaceMapObjectGeometry = new ReplaceMapObjectGeometry(
    gardenIdempotency,
    gardensMappingUnitOfWork,
    gardenAuthorization,
    clock,
  );
  const editMapObjectVertex = new EditMapObjectVertex(
    gardenIdempotency,
    gardensMappingUnitOfWork,
    gardenAuthorization,
    clock,
  );
  const splitMapObjectLinework = new SplitMapObjectLinework(
    gardenIdempotency,
    gardensMappingUnitOfWork,
    gardenAuthorization,
    clock,
  );
  const joinMapObjectLinework = new JoinMapObjectLinework(
    gardenIdempotency,
    gardensMappingUnitOfWork,
    gardenAuthorization,
    clock,
  );
  const changeMapObjectProperties = new ChangeMapObjectProperties(
    gardenIdempotency,
    gardensMappingUnitOfWork,
    gardenAuthorization,
    clock,
  );
  const assignPlantToTarget = new AssignPlantToTarget(
    gardenIdempotency,
    gardensMappingUnitOfWork,
    gardenAuthorization,
    clock,
  );
  const upsertMapCalibration = new UpsertMapCalibration(
    gardenIdempotency,
    gardensMappingUnitOfWork,
    gardenAuthorization,
    clock,
  );
  const decideMapProposal = new DecideMapProposal(gardenAuthorization);
  const deleteMapObject = new DeleteMapObject(
    gardenIdempotency,
    gardensMappingUnitOfWork,
    gardenAuthorization,
    clock,
  );
  const restoreMapObject = new RestoreMapObject(
    gardenIdempotency,
    gardensMappingUnitOfWork,
    gardenAuthorization,
    clock,
  );
  const duplicateMapObject = new DuplicateMapObject(
    gardenIdempotency,
    gardensMappingUnitOfWork,
    gardenAuthorization,
    clock,
  );
  const getMapObject = new GetMapObject(mapObjectRepository, gardenAuthorization);

  // plant family.
  const plantsInventoryIdempotency = new KyselyIdempotencyStore(db, clock);
  const plantsInventoryUnitOfWork = new KyselyPlantsInventoryUnitOfWork(db, clock);
  const plantRepository = new KyselyPlantRepository(db);
  const addPlant = new AddPlant(
    plantsInventoryIdempotency,
    plantsInventoryUnitOfWork,
    gardenAuthorization,
    clock,
  );
  const addPlantFromPhoto = new AddPlantFromPhoto(
    plantsInventoryIdempotency,
    plantsInventoryUnitOfWork,
    gardenAuthorization,
    clock,
  );
  const updatePlantDetails = new UpdatePlantDetails(
    plantRepository,
    plantsInventoryIdempotency,
    plantsInventoryUnitOfWork,
    gardenAuthorization,
    clock,
  );
  const attachPlantPhoto = new AttachPlantPhoto(
    plantRepository,
    plantsInventoryIdempotency,
    plantsInventoryUnitOfWork,
    gardenAuthorization,
    clock,
  );
  const setPrimaryPlantPhoto = new SetPrimaryPlantPhoto(
    plantRepository,
    plantsInventoryIdempotency,
    plantsInventoryUnitOfWork,
    gardenAuthorization,
  );
  const confirmPlantIdentification = new ConfirmPlantIdentification(
    plantRepository,
    plantsInventoryIdempotency,
    plantsInventoryUnitOfWork,
    gardenAuthorization,
    clock,
  );
  const transitionPlantLifecycleStage = new TransitionPlantLifecycleStage(
    plantRepository,
    plantsInventoryIdempotency,
    plantsInventoryUnitOfWork,
    gardenAuthorization,
    clock,
  );
  const setPlantStatus = new SetPlantStatus(
    plantRepository,
    plantsInventoryIdempotency,
    plantsInventoryUnitOfWork,
    gardenAuthorization,
    clock,
  );
  const movePlant = new MovePlant(
    plantRepository,
    plantsInventoryIdempotency,
    plantsInventoryUnitOfWork,
    gardenAuthorization,
    clock,
  );
  const getPlant = new GetPlant(plantRepository, gardenAuthorization);

  // observation family.
  const observationsHistoryIdempotency = new KyselyIdempotencyStore(db, clock);
  const observationsHistoryUnitOfWork = new KyselyObservationsHistoryUnitOfWork(db, clock);
  const observationRepository = new KyselyObservationRepository(db);
  const recordObservation = new RecordObservation(
    observationsHistoryIdempotency,
    observationsHistoryUnitOfWork,
    gardenAuthorization,
    clock,
  );
  const correctObservation = new CorrectObservation(
    observationsHistoryIdempotency,
    observationsHistoryUnitOfWork,
    gardenAuthorization,
    observationRepository,
    clock,
  );
  const getObservation = new GetObservation(observationRepository);

  // task family.
  const tasksRecommendationsIdempotency = new KyselyIdempotencyStore(db, clock);
  const tasksRecommendationsUnitOfWork = new KyselyTasksRecommendationsUnitOfWork(db, clock);
  const taskRepository = new KyselyTaskRepository(db);
  const createManualTask = new CreateManualTask(
    tasksRecommendationsIdempotency,
    tasksRecommendationsUnitOfWork,
    gardenAuthorization,
    getObservation,
    clock,
  );
  const editTask = new EditTask(
    taskRepository,
    tasksRecommendationsIdempotency,
    tasksRecommendationsUnitOfWork,
    gardenAuthorization,
    clock,
  );
  const rescheduleTask = new RescheduleTask(
    taskRepository,
    tasksRecommendationsIdempotency,
    tasksRecommendationsUnitOfWork,
    gardenAuthorization,
    clock,
  );
  const completeTask = new CompleteTask(
    taskRepository,
    tasksRecommendationsIdempotency,
    tasksRecommendationsUnitOfWork,
    gardenAuthorization,
    clock,
  );
  const dismissTask = new DismissTask(
    taskRepository,
    tasksRecommendationsIdempotency,
    tasksRecommendationsUnitOfWork,
    gardenAuthorization,
    clock,
  );
  const skipTask = new SkipTask(
    taskRepository,
    tasksRecommendationsIdempotency,
    tasksRecommendationsUnitOfWork,
    gardenAuthorization,
    clock,
  );
  const deleteTask = new DeleteTask(
    taskRepository,
    tasksRecommendationsIdempotency,
    tasksRecommendationsUnitOfWork,
    gardenAuthorization,
    clock,
  );
  const attachTaskFile = new AttachTaskFile(
    taskRepository,
    tasksRecommendationsIdempotency,
    tasksRecommendationsUnitOfWork,
    gardenAuthorization,
    clock,
  );
  const getTask = new GetTask(taskRepository, gardenAuthorization);

  const router = new SyncOperationRouter({
    garden: { createGarden, renameGarden, archiveGarden, requestGardenDeletion, getGarden },
    gardenObject: {
      createMapObject,
      moveMapObject,
      replaceMapObjectGeometry,
      editMapObjectVertex,
      splitMapObjectLinework,
      joinMapObjectLinework,
      changeMapObjectProperties,
      assignPlantToTarget,
      upsertMapCalibration,
      decideMapProposal,
      deleteMapObject,
      restoreMapObject,
      duplicateMapObject,
      getMapObject,
      calibrations: calibrationRepository,
    },
    plant: {
      addPlant,
      addPlantFromPhoto,
      updatePlantDetails,
      attachPlantPhoto,
      setPrimaryPlantPhoto,
      confirmPlantIdentification,
      transitionPlantLifecycleStage,
      setPlantStatus,
      movePlant,
      getPlant,
      plants: plantRepository,
    },
    observation: { recordObservation, correctObservation },
    task: {
      createManualTask,
      editTask,
      rescheduleTask,
      completeTask,
      dismissTask,
      skipTask,
      deleteTask,
      attachTaskFile,
      getTask,
      tasks: taskRepository,
    },
  });

  const synchronizationIdempotency = new KyselyIdempotencyStore(db, clock);
  const installations = new KyselySyncClientInstallationRepository(db);

  // Pull (`GetSyncChanges`, P5-BE-02) — mirrors `compose-synchronization.ts`'s
  // own wiring: reuses `getGarden`/`getMapObject`/`getPlant`/`getTask` above,
  // adds `getCalibration`/`getObservationForSync` as this pass's own two new
  // authorized readers, plus the membership and sync-change-log read ports.
  const membershipRepository = new KyselyMembershipRepository(db);
  const getCalibration = new GetCalibration(calibrationRepository, gardenAuthorization);
  const getObservationForSync = new GetObservationForSync(
    observationRepository,
    gardenAuthorization,
  );
  const syncChangeQuery = new KyselySyncChangeQuery(db);
  const getSyncChanges = new GetSyncChanges(
    membershipRepository,
    syncChangeQuery,
    { getGarden, getMapObject, getCalibration, getPlant, getObservationForSync, getTask },
    clock,
  );

  return {
    gardenAuthorization,
    gardenRepository,
    plantRepository,
    taskRepository,
    mapObjectRepository,
    membershipRepository,
    createGarden,
    renameGarden,
    createMapObject,
    deleteMapObject,
    addPlant,
    updatePlantDetails,
    createManualTask,
    editTask,
    registerSyncClient: new RegisterSyncClient(installations, synchronizationIdempotency, clock),
    pushSyncOperations: new PushSyncOperations(synchronizationIdempotency, router),
    getSyncChanges,
    acknowledgeSyncOperations: new AcknowledgeSyncOperations(synchronizationIdempotency),
  };
}
