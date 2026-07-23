/**
 * Composition root.
 *
 * Every plugin, adapter, and route is wired here by hand. There is no
 * auto-loading and no runtime service lookup: what the service contains is
 * readable in one file, and a module cannot acquire a dependency that was not
 * handed to it.
 *
 * Source: architecture/backend-modular-monolith.md, section "9. Composition Root".
 */

import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import underPressure from '@fastify/under-pressure';
import { API_BASE_PATH } from '@verdery/api-contracts';
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import { composeGardensMapping } from './compose-gardens-mapping.js';
import { composeSynchronization } from './compose-synchronization.js';
import { registerGardenRoutes, registerMapRoutes } from './modules/gardens-mapping/public.js';
import {
  KyselyIdentityProviderLinkRepository,
  KyselyProfileRepository,
  ProvisionProfile,
} from './modules/identity-access/public.js';
import {
  KyselyMediaRepository,
  KyselyMediaUnitOfWork,
  RegisterMediaRecord,
} from './modules/media/public.js';
import {
  CorrectObservation,
  GetObservation,
  KyselyObservationRepository,
  KyselyObservationsHistoryUnitOfWork,
  ListObservationsForGarden,
  ListObservationsForPlant,
  RecordObservation,
  registerObservationRoutes,
} from './modules/observations-history/public.js';
import {
  AddPlant,
  AddPlantFromPhoto,
  AttachPlantPhoto,
  ConfirmPlantIdentification,
  GetPlant,
  KyselyPlantRepository,
  KyselyPlantsInventoryUnitOfWork,
  KyselyTaxonomyReferenceRepository,
  MovePlant,
  registerPlantRoutes,
  SearchPlants,
  SearchTaxonomyReferences,
  SetPlantStatus,
  SetPrimaryPlantPhoto,
  TransitionPlantLifecycleStage,
  UpdatePlantDetails,
} from './modules/plants-inventory/public.js';
import {
  DatabaseDependencyProbe,
  registerHealthRoutes,
  ServiceHealth,
} from './modules/service-health/public.js';
import {
  AttachTaskFile,
  CompleteTask,
  CreateManualTask,
  DeleteTask,
  DismissTask,
  EditTask,
  KyselyTaskRepository,
  KyselyTasksRecommendationsUnitOfWork,
  ListTasksForGarden,
  registerTaskRoutes,
  RescheduleTask,
  SkipTask,
} from './modules/tasks-recommendations/public.js';
import { registerSyncRoutes } from './modules/synchronization/public.js';
import { KyselyAuditLogger } from './platform/audit/kysely-audit-logger.js';
import { registerAppCheck } from './platform/app-check/app-check-plugin.js';
import type { AppCheckVerifier } from './platform/app-check/app-check-verifier.js';
import { registerAuthentication } from './platform/authentication/authentication-plugin.js';
import { registerSessionRoutes } from './platform/authentication/transport/session-routes.js';
import type { TokenVerifier } from './platform/authentication/token-verifier.js';
import type { ApplicationConfiguration } from './platform/configuration/configuration-schema.js';
import type { DatabaseGateway } from './platform/database/database-gateway.js';
import { KyselyIdempotencyStore } from './platform/idempotency/kysely-idempotency-store.js';
import { registerErrorHandling } from './platform/errors/error-handler.js';
import { generateRequestId, registerCorrelation } from './platform/telemetry/correlation.js';
import type { Clock } from './shared/time/clock.js';

/**
 * Everything the HTTP application needs, constructed before it is built.
 *
 * The logger is typed as Fastify's own interface rather than as a pino instance
 * so that request-scoped child loggers stay assignable throughout the pipeline.
 */
export interface ApplicationDependencies {
  readonly configuration: ApplicationConfiguration;
  readonly logger: FastifyBaseLogger;
  readonly database: DatabaseGateway;
  readonly tokenVerifier: TokenVerifier;
  readonly appCheckVerifier: AppCheckVerifier;
  readonly clock: Clock;
}

/**
 * Event-loop delay above which the instance rejects new work.
 *
 * Shedding load early keeps latency bounded for requests already in flight
 * instead of degrading every request equally.
 */
const MAX_EVENT_LOOP_DELAY_MS = 1_000;

export async function buildApplication(
  dependencies: ApplicationDependencies,
): Promise<FastifyInstance> {
  const { configuration, logger, database, tokenVerifier, appCheckVerifier, clock } = dependencies;

  const app = Fastify({
    loggerInstance: logger,
    genReqId: generateRequestId,
    bodyLimit: configuration.http.bodyLimitBytes,
    // The load balancer terminates TLS and sets the forwarding headers; without
    // this the service logs and rate-limits against the proxy address.
    trustProxy: true,
  });

  registerCorrelation(app);
  registerErrorHandling(app);

  await app.register(helmet, { contentSecurityPolicy: false });

  await app.register(cors, {
    origin:
      configuration.http.allowedOrigins.length === 0
        ? false
        : [...configuration.http.allowedOrigins],
    credentials: true,
    // @fastify/cors defaults to 'GET,HEAD,POST' when `methods` is not given,
    // which silently blocks every PATCH (rename garden) and DELETE (end
    // session) request a real cross-origin browser client sends: the
    // preflight succeeds, but the browser then refuses the actual request
    // with "Method ... is not allowed by Access-Control-Allow-Methods".
    // `app.inject()`-based HTTP tests never exercise a browser's CORS
    // preflight at all, so this went unnoticed until a real browser E2E
    // sign-out (apps/web/e2e/sign-out.spec.ts) hit it directly.
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
  });

  await app.register(underPressure, {
    maxEventLoopDelay: MAX_EVENT_LOOP_DELAY_MS,
    // Health endpoints are owned by the service-health module so that they match
    // the contract document exactly.
    exposeStatusRoute: false,
  });

  // Parses `request.cookies`, used by both the Firebase session cookie
  // (`__session`) and the CSRF double-submit cookie. No `secret` option: the
  // service never signs cookies, only reads the opaque Firebase-issued value
  // and compares the CSRF cookie against a header, so there is nothing here
  // for a signature to protect.
  await app.register(cookie);

  const health = new ServiceHealth(
    [new DatabaseDependencyProbe(database)],
    configuration.serviceVersion,
  );

  // identity-access: owns application profiles, Firebase identity links, and
  // account state. No transport of its own in Phase 2 — profile provisioning
  // is a side effect of authentication, not a route.
  const profileRepository = new KyselyProfileRepository(database.queries);
  const identityProviderLinkRepository = new KyselyIdentityProviderLinkRepository(database.queries);
  const identityAuditLogger = new KyselyAuditLogger(database.queries, clock);
  const provisionProfile = new ProvisionProfile(
    profileRepository,
    identityProviderLinkRepository,
    clock,
    identityAuditLogger,
  );

  // media: owns the minimal, immutable `media.media_record` stand-in — see
  // that module's `public.ts` doc comment for the full rationale. No
  // transport of its own this pass, and no sibling module yet either, so
  // nothing in this file reads `mediaRepository` or `registerMediaRecord`
  // today: `mediaRepository` is what plants-inventory, observations-history,
  // and tasks-recommendations will receive injected into their own
  // composition-root wiring next, the same way `gardenAuthorization` below is
  // shared across every gardens-mapping-dependent command; `registerMediaRecord`
  // is exercised end to end against a real database by
  // tests/integration/media.test.ts in the meantime.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- see above.
  const mediaRepository = new KyselyMediaRepository(database.queries);
  const mediaIdempotency = new KyselyIdempotencyStore(database.queries, clock);
  const mediaUnitOfWork = new KyselyMediaUnitOfWork(database.queries, clock);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- see above.
  const registerMediaRecord = new RegisterMediaRecord(mediaIdempotency, mediaUnitOfWork, clock);

  // gardens-mapping and the garden map (P3-BE-01, P3-BE-02): garden
  // lifecycle and map-object dependency wiring, split into
  // `compose-gardens-mapping.ts` purely to keep this file under the
  // repository's 600-line source-file limit — see that file's own header
  // comment. `gardenAuthorization` is reused by every module wired below.
  const { gardenAuthorization, gardenRoutesDependencies, mapRoutesDependencies } =
    composeGardensMapping(database, clock);

  // observations-history: owns the append-only `observation`, `observation_photo`,
  // and `image_analysis_result` tables. Reuses `gardenAuthorization`. HTTP
  // transport (`registerObservationRoutes`, tag `Observations`) wired below.
  const observationRepository = new KyselyObservationRepository(database.queries);
  const observationsHistoryIdempotency = new KyselyIdempotencyStore(database.queries, clock);
  const observationsHistoryUnitOfWork = new KyselyObservationsHistoryUnitOfWork(
    database.queries,
    clock,
  );
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
  const listObservationsForGarden = new ListObservationsForGarden(
    observationRepository,
    gardenAuthorization,
  );
  const listObservationsForPlant = new ListObservationsForPlant(
    observationRepository,
    gardenAuthorization,
  );
  // Used below by tasks-recommendations' `CreateManualTask`.
  const getObservation = new GetObservation(observationRepository);

  const observationRoutesDependencies = {
    recordObservation,
    correctObservation,
    listObservationsForGarden,
    listObservationsForPlant,
  };

  // plants-inventory: owns the mutable `plant` aggregate root, its
  // `plant_photo`/`plant_identification` children, and the read-only
  // `taxonomy_reference` catalog. Reuses `gardenAuthorization`. HTTP
  // transport (`registerPlantRoutes`, tag `Plants`) wired below.
  const plantRepository = new KyselyPlantRepository(database.queries);
  const taxonomyReferenceRepository = new KyselyTaxonomyReferenceRepository(database.queries);
  const plantsInventoryIdempotency = new KyselyIdempotencyStore(database.queries, clock);
  const plantsInventoryUnitOfWork = new KyselyPlantsInventoryUnitOfWork(database.queries, clock);
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
  const getPlant = new GetPlant(plantRepository, gardenAuthorization);
  const searchPlants = new SearchPlants(plantRepository, gardenAuthorization);
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
  const updatePlantDetails = new UpdatePlantDetails(
    plantRepository,
    plantsInventoryIdempotency,
    plantsInventoryUnitOfWork,
    gardenAuthorization,
    clock,
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
  const searchTaxonomyReferences = new SearchTaxonomyReferences(taxonomyReferenceRepository);

  const plantRoutesDependencies = {
    addPlant,
    addPlantFromPhoto,
    getPlant,
    searchPlants,
    updatePlantDetails,
    attachPlantPhoto,
    setPrimaryPlantPhoto,
    confirmPlantIdentification,
    transitionPlantLifecycleStage,
    setPlantStatus,
    movePlant,
    searchTaxonomyReferences,
  };

  // tasks-recommendations: owns `task`, `task_attachment`, and `task_revision`.
  // Reuses `gardenAuthorization` and `getObservation` (validates
  // `CreateManualTask`'s `originObservationId`). HTTP transport
  // (`registerTaskRoutes`, tag `Tasks`) wired below.
  const taskRepository = new KyselyTaskRepository(database.queries);
  const tasksRecommendationsIdempotency = new KyselyIdempotencyStore(database.queries, clock);
  const tasksRecommendationsUnitOfWork = new KyselyTasksRecommendationsUnitOfWork(
    database.queries,
    clock,
  );
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
  const listTasksForGarden = new ListTasksForGarden(taskRepository, gardenAuthorization);
  const attachTaskFile = new AttachTaskFile(
    taskRepository,
    tasksRecommendationsIdempotency,
    tasksRecommendationsUnitOfWork,
    gardenAuthorization,
    clock,
  );

  const taskRoutesDependencies = {
    createManualTask,
    listTasksForGarden,
    editTask,
    rescheduleTask,
    completeTask,
    dismissTask,
    skipTask,
    deleteTask,
    attachTaskFile,
  };

  // synchronization (P5-BE-01, P5-API-01): the native offline outbox
  // protocol's client-registration, push, and acknowledge endpoints. Depends
  // on every module wired above — it routes across all five record families
  // — so it is composed last, split into `compose-synchronization.ts` for
  // the same 600-line reason `compose-gardens-mapping.ts` was split out. HTTP
  // transport (`registerSyncRoutes`, tag `Synchronization`) wired below.
  const { syncRoutesDependencies } = composeSynchronization(
    database,
    clock,
    gardenAuthorization,
    gardenRoutesDependencies,
    mapRoutesDependencies,
    plantRoutesDependencies,
    observationRoutesDependencies,
    taskRoutesDependencies,
  );

  await app.register(
    (instance, _options, done) => {
      registerHealthRoutes(instance, health);
      done();
    },
    { prefix: API_BASE_PATH },
  );

  // Unauthenticated: this is how a session is established or cleared in the
  // first place, so it cannot itself require one.
  await app.register(
    (instance, _options, done) => {
      registerSessionRoutes(instance, { tokenVerifier, provisionProfile });
      done();
    },
    { prefix: API_BASE_PATH },
  );

  // Authenticated: registerAuthentication's onRequest hook and the garden
  // routes share this one encapsulation context, so the hook applies to
  // every route below it and no sibling registration outside this block.
  // registerAppCheck shares it too, monitor-only: P2-APPCHK-01 depends on
  // P2-AUTH-01 and its completion evidence concerns these authenticated
  // routes, not the unauthenticated health or session-login routes.
  // Registered before registerAuthentication so the classification is
  // observed for every request that reaches this block, including one
  // authentication itself goes on to reject.
  await app.register(
    (instance, _options, done) => {
      registerAppCheck(instance, { appCheckVerifier });
      registerAuthentication(instance, { tokenVerifier, provisionProfile });
      registerGardenRoutes(instance, gardenRoutesDependencies);
      registerMapRoutes(instance, mapRoutesDependencies);
      registerPlantRoutes(instance, plantRoutesDependencies);
      registerObservationRoutes(instance, observationRoutesDependencies);
      registerTaskRoutes(instance, taskRoutesDependencies);
      registerSyncRoutes(instance, syncRoutesDependencies);
      done();
    },
    { prefix: API_BASE_PATH },
  );

  return app;
}
