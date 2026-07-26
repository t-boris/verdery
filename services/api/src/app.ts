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
import { composeDeletion } from './compose-deletion.js';
import { composeExports } from './compose-exports.js';
import { composeGardensMapping } from './compose-gardens-mapping.js';
import { composeIntegrations } from './compose-integrations.js';
import { composeMedia } from './compose-media.js';
import { composeNotifications } from './compose-notifications.js';
import { composePlantsInventory } from './compose-plants-inventory.js';
import { composeSynchronization } from './compose-synchronization.js';
import { composeTasksRecommendations } from './compose-tasks-recommendations.js';
import { registerWeatherRefreshSweepRoute } from './modules/integrations/public.js';
import type { AiExplanationProviderAdapter } from './modules/integrations/public.js';
import { registerGardenRoutes, registerMapRoutes } from './modules/gardens-mapping/public.js';
import {
  KyselyIdentityProviderLinkRepository,
  KyselyProfileRepository,
  ProvisionProfile,
} from './modules/identity-access/public.js';
import { registerExportInternalRoutes, registerExportRoutes } from './modules/exports/public.js';
import {
  registerAccountDeletionRoutes,
  registerDeletionSweepRoute,
} from './modules/deletion/public.js';
import {
  registerMediaProcessingCallbackRoute,
  registerMediaRetentionSweepRoute,
  registerMediaRoutes,
} from './modules/media/public.js';
import type { MediaStorageGateway } from './modules/media/public.js';
import {
  registerNotificationDeliverySweepRoute,
  registerNotificationDeviceRoutes,
  registerNotificationEventsRoute,
  registerNotificationRoutes,
} from './modules/notifications/public.js';
import type { PushMessageSender } from './modules/notifications/public.js';
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
import { registerPlantRoutes } from './modules/plants-inventory/public.js';
import {
  DatabaseDependencyProbe,
  registerHealthRoutes,
  ServiceHealth,
} from './modules/service-health/public.js';
import {
  registerRecommendationEvaluationSweepRoute,
  registerRecommendationRoutes,
  registerTaskRoutes,
} from './modules/tasks-recommendations/public.js';
import { registerSyncRoutes } from './modules/synchronization/public.js';
import { KyselyAuditLogger } from './platform/audit/kysely-audit-logger.js';
import { registerAppCheck } from './platform/app-check/app-check-plugin.js';
import type { AppCheckVerifier } from './platform/app-check/app-check-verifier.js';
import { registerAuthentication } from './platform/authentication/authentication-plugin.js';
import type { IdentityProviderAccountGateway } from './platform/authentication/identity-provider-account-gateway.js';
import { registerSessionRoutes } from './platform/authentication/transport/session-routes.js';
import type { TokenVerifier } from './platform/authentication/token-verifier.js';
import type { ApplicationConfiguration } from './platform/configuration/configuration-schema.js';
import type { DatabaseGateway } from './platform/database/database-gateway.js';
import { KyselyIdempotencyStore } from './platform/idempotency/kysely-idempotency-store.js';
import { registerErrorHandling } from './platform/errors/error-handler.js';
import type { CloudTasksInvocationVerifier } from './platform/tasks/cloud-tasks-invocation-verifier.js';
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
  /**
   * The media module's Cloud Storage port, already constructed — mirrors
   * `tokenVerifier`/`appCheckVerifier`: `main.ts` builds the concrete
   * adapter (`GcsMediaStorageGateway`, wrapping a `@google-cloud/storage`
   * client authenticated through Application Default Credentials) and this
   * file only ever depends on the port interface, so a test can substitute a
   * fake here the same way it substitutes `stubTokenVerifier()`.
   */
  readonly mediaStorageGateway: MediaStorageGateway;
  /**
   * P6-ASYNC-01: verifies the Cloud Tasks OIDC token on the media-processing
   * callback. Same "port arrives already constructed" shape as
   * `mediaStorageGateway`: `main.ts` builds the real `GoogleOidcInvocationVerifier`,
   * tests substitute a fake.
   */
  readonly cloudTasksInvocationVerifier: CloudTasksInvocationVerifier;
  /**
   * P7-AI-01: the Vertex AI explanation adapter, or `null` whenever the
   * `RECOMMENDATION_AI_EXPLANATION_ENABLED` kill-switch is off (every
   * environment today). Same "port arrives already constructed" shape as
   * `mediaStorageGateway`; `null` here means no code path can reach
   * Vertex at all — the strongest form of the rollback guarantee.
   */
  readonly aiExplanationAdapter: AiExplanationProviderAdapter | null;
  /**
   * P7-NOTIF-02: the FCM boundary — `main.ts` builds the real
   * `FcmPushMessageSender` over the same `firebase-admin` app the token
   * verifier uses; tests substitute a fake. Same "port arrives already
   * constructed" shape as `mediaStorageGateway`.
   */
  readonly pushMessageSender: PushMessageSender;
  /**
   * P8-DELETE-01: the Firebase Authentication boundary account purge uses to
   * delete the identity itself (`deleteUser`). Same "port arrives already
   * constructed" shape as `mediaStorageGateway`: `main.ts` builds the real
   * `FirebaseIdentityProviderAccountGateway` over the same `firebase-admin`
   * app the token verifier uses; tests substitute a fake, so no test can
   * reach a real identity provider.
   */
  readonly identityProviderAccounts: IdentityProviderAccountGateway;
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
  const {
    configuration,
    logger,
    database,
    tokenVerifier,
    appCheckVerifier,
    clock,
    mediaStorageGateway,
    cloudTasksInvocationVerifier,
    aiExplanationAdapter,
    pushMessageSender,
    identityProviderAccounts,
  } = dependencies;

  // P8-SEC-02: read once, here, and handed to every `registerAppCheck` call
  // below, so the three registrations cannot drift into disagreeing about
  // whether enforcement is on. `'monitor'` in every environment today.
  const appCheckEnforcement = configuration.appCheck.enforcement;

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
    // PUT joined the list with P7-NOTIF-01's whole-document
    // `PUT /notification-preferences` — the same lesson, applied before a
    // browser hits it rather than after.
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
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

  // gardens-mapping and the garden map (P3-BE-01, P3-BE-02): garden
  // lifecycle and map-object dependency wiring, split into
  // `compose-gardens-mapping.ts` purely to keep this file under the
  // repository's 600-line source-file limit — see that file's own header
  // comment. `gardenAuthorization` is reused by every module wired below.
  const { gardenAuthorization, gardenRoutesDependencies, mapRoutesDependencies } =
    composeGardensMapping(database, clock);

  // media (P6-API-01): registration, authorized resumable upload sessions,
  // completion verification, status, and authorized short-lived access.
  // Reuses `gardenAuthorization`. HTTP transport (`registerMediaRoutes`, tag
  // `Media`) wired below. Split into `compose-media.ts` for the same
  // 600-line reason `compose-gardens-mapping.ts` was split out.
  const {
    mediaRoutesDependencies,
    mediaProcessingCallbackRouteDependencies,
    mediaRetentionSweepRouteDependencies,
  } = composeMedia(
    database,
    clock,
    gardenAuthorization,
    mediaStorageGateway,
    configuration.media.buckets,
    cloudTasksInvocationVerifier,
  );

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
  // transport (`registerPlantRoutes`, tag `Plants`) wired below. Split into
  // `compose-plants-inventory.ts` for the same 600-line reason as its
  // siblings.
  const plantRoutesDependencies = composePlantsInventory(database, clock, gardenAuthorization);
  // integrations (P7-ASYNC-01, P7-AI-01): the weather registry (zero
  // registrations — P0-PROV-01 undecided), both weather use cases, the
  // scheduled weather-refresh sweep + internal route, and the bounded
  // AI-explanation call machinery around the (usually null) Vertex
  // adapter. Split into `compose-integrations.ts` for the same 600-line
  // reason as its siblings.
  const { getGardenWeather, generateAiExplanation, weatherRefreshSweepRouteDependencies } =
    composeIntegrations(
      database,
      clock,
      configuration.weather,
      configuration.aiExplanation,
      aiExplanationAdapter,
      cloudTasksInvocationVerifier,
    );

  // tasks-recommendations: task commands (tag `Tasks`), the scheduled
  // recommendation-evaluation sweep (P7-ASYNC-01), and the Today surface —
  // query, feedback commands, task conversion (P7-BE-01, tag
  // `Recommendations`). Reuses `gardenAuthorization`, `getObservation`
  // (validates `CreateManualTask`'s `originObservationId`), and
  // integrations' `getGardenWeather`. Split into
  // `compose-tasks-recommendations.ts` for the same 600-line reason as its
  // siblings.
  const {
    taskRoutesDependencies,
    recommendationRoutesDependencies,
    recommendationEvaluationSweepRouteDependencies,
  } = composeTasksRecommendations(
    database,
    clock,
    gardenAuthorization,
    getObservation,
    getGardenWeather,
    generateAiExplanation,
    configuration.aiExplanation.enabled,
    cloudTasksInvocationVerifier,
  );

  // notifications (P7-NOTIF-01, P7-NOTIF-02): the in-app inbox,
  // preferences, device registration, the internal event endpoint the
  // workers outbox relay posts `recommendation.candidate_created` events
  // to, and the internal delivery sweep that turns pending intents into
  // FCM attempts. Reuses `gardenAuthorization` (garden-scoped preference
  // entries) and the same worker-to-API invocation verifier as every
  // sweep. Split into `compose-notifications.ts` for the same 600-line
  // reason as its siblings.
  const {
    notificationRoutesDependencies,
    notificationDeviceRoutesDependencies,
    notificationEventsRouteDependencies,
    notificationDeliverySweepRouteDependencies,
  } = composeNotifications(
    database,
    clock,
    gardenAuthorization,
    cloudTasksInvocationVerifier,
    pushMessageSender,
    configuration.environment,
  );

  // exports (P8-EXPORT-01): the data-export request/status/download surface
  // and the three internal endpoints the generation worker calls. Reuses
  // `gardenAuthorization` (garden-scoped export capability), the shared
  // storage gateway (signed package downloads), and the same worker-to-API
  // invocation verifier as every internal endpoint. Split into
  // `compose-exports.ts` for the same 600-line reason as its siblings.
  const { exportRoutesDependencies, exportInternalRoutesDependencies } = composeExports(
    database,
    clock,
    gardenAuthorization,
    mediaStorageGateway,
    configuration.media.buckets,
    configuration.serviceVersion,
    cloudTasksInvocationVerifier,
  );

  // deletion (P8-DELETE-01): the account-deletion command surface and the
  // internal sweep that purges gardens and accounts once their 30-day
  // recovery windows close. Reuses the media module's byte-deletion workflow,
  // the Firebase identity boundary, and the same worker-to-API invocation
  // verifier as every other internal endpoint. Split into
  // `compose-deletion.ts` for the same 600-line reason as its siblings.
  const { accountDeletionRoutesDependencies, deletionSweepRouteDependencies } = composeDeletion(
    database,
    clock,
    configuration.media.buckets,
    identityProviderAccounts,
    cloudTasksInvocationVerifier,
  );

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
  //
  // App Check is registered here too (P8-SEC-02). `POST /v1/auth/session` is
  // the most expensive UNAUTHENTICATED endpoint in the product — every call
  // costs a Firebase verifyIdToken AND a createSessionCookie (threat-model.md
  // `T-COST-02`) — so it is precisely where attestation is worth the most and
  // precisely where P2-APPCHK-01's "authenticated routes only" scope left a
  // hole. Monitor-only by default like everywhere else; the enforced-endpoint
  // list decides which routes the `enforce` position actually applies to, and
  // `DELETE /v1/auth/session` is deliberately not on it, so sign-out keeps
  // working for a client whose attestation is broken.
  await app.register(
    (instance, _options, done) => {
      registerAppCheck(instance, { appCheckVerifier, enforcementMode: appCheckEnforcement });
      registerSessionRoutes(instance, { tokenVerifier, provisionProfile });
      done();
    },
    { prefix: API_BASE_PATH },
  );

  // Unauthenticated by Firebase's own pipeline: Cloud Tasks, not an app
  // user, calls this endpoint, authenticating itself with a Google-signed
  // OIDC token that `cloudTasksInvocationVerifier` checks inside the route
  // handler itself (P6-ASYNC-01) — the same "this is how access is
  // established in the first place, so it cannot itself require the
  // ordinary session pipeline" reasoning the session routes above already
  // apply, with a different, machine-to-machine identity check standing in
  // for Firebase.
  await app.register(
    (instance, _options, done) => {
      registerMediaProcessingCallbackRoute(instance, mediaProcessingCallbackRouteDependencies);
      // P6-RET-01: the worker-triggered retention sweep, same
      // machine-to-machine identity check as the callback above.
      registerMediaRetentionSweepRoute(instance, mediaRetentionSweepRouteDependencies);
      // P7-ASYNC-01: the worker-triggered weather-refresh and
      // recommendation-evaluation sweeps — same identity check again.
      registerWeatherRefreshSweepRoute(instance, weatherRefreshSweepRouteDependencies);
      registerRecommendationEvaluationSweepRoute(
        instance,
        recommendationEvaluationSweepRouteDependencies,
      );
      // P7-NOTIF-01: the workers outbox relay's notification-event
      // endpoint — same identity check yet again.
      registerNotificationEventsRoute(instance, notificationEventsRouteDependencies);
      // P7-NOTIF-02: the worker-triggered notification delivery sweep —
      // same identity check once more.
      registerNotificationDeliverySweepRoute(instance, notificationDeliverySweepRouteDependencies);
      // P8-EXPORT-01: the export-generation worker's snapshot/checkpoint/
      // completion endpoints — same identity check again.
      registerExportInternalRoutes(instance, exportInternalRoutesDependencies);
      // P8-DELETE-01: the deletion sweep — same identity check, fifth sweep.
      registerDeletionSweepRoute(instance, deletionSweepRouteDependencies);
      done();
    },
    { prefix: API_BASE_PATH },
  );

  // Authenticated: registerAuthentication's onRequest hook and the garden
  // routes share this one encapsulation context, so the hook applies to
  // every route below it and no sibling registration outside this block.
  // registerAppCheck shares it too: P2-APPCHK-01 depends on P2-AUTH-01 and
  // its completion evidence concerns these authenticated routes. P8-SEC-02
  // added the unauthenticated session block above, where `T-COST-02` lives.
  // Registered BEFORE registerAuthentication for two reasons: the
  // classification is observed for every request that reaches this block,
  // including one authentication itself goes on to reject; and, once
  // `appCheckEnforcement` is `'enforce'`, a refusal happens before any
  // credential is verified, any profile is provisioned, and any garden is
  // read — so it cannot disclose whether either exists.
  await app.register(
    (instance, _options, done) => {
      registerAppCheck(instance, { appCheckVerifier, enforcementMode: appCheckEnforcement });
      registerAuthentication(instance, { tokenVerifier, provisionProfile });
      registerGardenRoutes(instance, gardenRoutesDependencies);
      registerMapRoutes(instance, mapRoutesDependencies);
      registerPlantRoutes(instance, plantRoutesDependencies);
      registerObservationRoutes(instance, observationRoutesDependencies);
      registerTaskRoutes(instance, taskRoutesDependencies);
      registerRecommendationRoutes(instance, recommendationRoutesDependencies);
      registerNotificationRoutes(instance, notificationRoutesDependencies);
      registerNotificationDeviceRoutes(instance, notificationDeviceRoutesDependencies);
      registerMediaRoutes(instance, mediaRoutesDependencies);
      registerExportRoutes(instance, exportRoutesDependencies);
      registerSyncRoutes(instance, syncRoutesDependencies);
      done();
    },
    { prefix: API_BASE_PATH },
  );

  // P8-DELETE-01: its own encapsulation context, and the ONLY one that admits
  // a non-active account. A user inside their 30-day recovery window is
  // deliberately unusable everywhere else (`isAccountUsable`), which would
  // otherwise make withdrawing their own deletion request impossible — see
  // `account-deletion-routes.ts` for why the admission is exactly one state
  // and exactly three routes.
  await app.register(
    (instance, _options, done) => {
      registerAppCheck(instance, { appCheckVerifier, enforcementMode: appCheckEnforcement });
      registerAuthentication(instance, {
        tokenVerifier,
        provisionProfile,
        additionalPermittedAccountStates: ['deletion_requested'],
      });
      registerAccountDeletionRoutes(instance, accountDeletionRoutesDependencies);
      done();
    },
    { prefix: API_BASE_PATH },
  );

  return app;
}
