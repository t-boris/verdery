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

import { API_BASE_PATH } from '@verdery/api-contracts';
import type { FastifyInstance } from 'fastify';
import {
  registerClientEngagementRoutes,
  registerClientPortalRoutes,
  registerGardenAssignmentRoutes,
  registerGardenScopedCollaborationRoutes,
  registerOrganizationMemberRoutes,
  registerOrganizationRoutes,
  registerPublicationRoutes,
} from './modules/collaboration/public.js';
import { composeCollaboration } from './compose-collaboration.js';
import { composeDeletion } from './compose-deletion.js';
import { composeExports } from './compose-exports.js';
import { composeGardensMapping } from './compose-gardens-mapping.js';
import { composeHttpServer } from './compose-http-server.js';
import { composeIntegrations } from './compose-integrations.js';
import { composeMedia } from './compose-media.js';
import { composeNotifications } from './compose-notifications.js';
import { composePlantsInventory } from './compose-plants-inventory.js';
import { composeSynchronization } from './compose-synchronization.js';
import { composeTasksRecommendations } from './compose-tasks-recommendations.js';
import {
  registerPlantAssertionReviewRoutes,
  registerGeocodingRoutes,
  registerWeatherRoutes,
} from './modules/integrations/public.js';
import {
  registerGardenContextRoutes,
  registerGardenRoutes,
  registerInvitationRoutes,
  registerGeoreferenceRoutes,
  registerMapRoutes,
  registerPlatRoutes,
  registerMemberRoutes,
  registerOwnershipRoutes,
} from './modules/gardens-mapping/public.js';
import {
  KyselyIdentityProviderLinkRepository,
  KyselyProfileRepository,
  ProvisionProfile,
} from './modules/identity-access/public.js';
import { registerClientExportRoutes, registerExportRoutes } from './modules/exports/public.js';
import { registerAccountDeletionRoutes } from './modules/deletion/public.js';
import { registerClientMediaRoutes, registerMediaRoutes } from './modules/media/public.js';
import {
  registerNotificationDeviceRoutes,
  registerNotificationRoutes,
} from './modules/notifications/public.js';
import {
  CorrectObservation,
  GetObservation,
  KyselyImageAnalysisResultRepository,
  KyselyObservationPhotoRepository,
  KyselyObservationRepository,
  KyselyObservationsHistoryUnitOfWork,
  ListObservationsForGarden,
  ListObservationsForPlant,
  ListPlantJournalFrames,
  RecordObservation,
  registerObservationRoutes,
  SetHealthSuggestionDisposition,
} from './modules/observations-history/public.js';
import {
  registerCandidateRoutes,
  registerPlantRoutes,
  registerSeasonalFactReviewRoutes,
} from './modules/plants-inventory/public.js';
import {
  DatabaseDependencyProbe,
  registerHealthRoutes,
  ServiceHealth,
} from './modules/service-health/public.js';
import {
  registerCareRuleRoutes,
  registerRecommendationRoutes,
  registerSeasonalPlanRoutes,
  registerTaskRoutes,
} from './modules/tasks-recommendations/public.js';
import { registerSyncRoutes } from './modules/synchronization/public.js';
import { registerInternalRoutes } from './register-internal-routes.js';
import { KyselyAuditLogger } from './platform/audit/kysely-audit-logger.js';
import { registerAppCheck } from './platform/app-check/app-check-plugin.js';
import { registerAuthentication } from './platform/authentication/authentication-plugin.js';
import { registerSessionRoutes } from './platform/authentication/transport/session-routes.js';
import { KyselyIdempotencyStore } from './platform/idempotency/kysely-idempotency-store.js';
import type { ApplicationDependencies } from './application-dependencies.js';

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
    plantSpeciesIdentificationAdapter,
    plantConditionAnalysisAdapter,
    platExtractionAdapter,
    pushMessageSender,
    identityProviderAccounts,
  } = dependencies;

  // P8-SEC-02: read once, here, and handed to every `registerAppCheck` call
  // below, so the registrations cannot drift into disagreeing about it.
  const appCheckEnforcement = configuration.appCheck.enforcement;

  const app = await composeHttpServer(configuration, logger);

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
  // lifecycle and map-object dependency wiring. `gardenAuthorization` is reused below.
  const {
    gardenAuthorization,
    gardenRoutesDependencies,
    mapRoutesDependencies,
    georeferenceRoutesDependencies,
    platRoutesDependencies,
    invitationRoutesDependencies,
    memberRoutesDependencies,
    invitationExpirySweepRouteDependencies,
    ownershipRoutesDependencies,
    gardenContextRoutesDependencies,
  } = composeGardensMapping(
    database,
    clock,
    cloudTasksInvocationVerifier,
    logger,
    platExtractionAdapter,
    configuration.platReading.callTimeoutMs,
    dependencies.aerialTracingAdapter ?? null,
  );

  // integrations (P7-ASYNC-01, P7-AI-01, P9C-INVITE-01, P11-ASYNC-01):
  // weather, bounded AI-explanation, the (usually null) Resend adapter, and
  // the taxon-enrichment pipeline.
  const {
    getGardenWeather,
    getGardenPrecipitation,
    generateAiExplanation,
    identifyPlantSpecies,
    analyzePlantCondition,
    geocodingRoutesDependencies,
    weatherRoutesDependencies,
    weatherRefreshSweepRouteDependencies,
    taxonEnrichmentSweepRouteDependencies,
    taxonProfileEnricher,
    plantAssertionReviewRoutesDependencies,
    transactionalEmailAdapter,
  } = composeIntegrations(
    database,
    clock,
    gardenAuthorization,
    configuration.weather,
    configuration.aiExplanation,
    aiExplanationAdapter,
    configuration.plantSpeciesAi,
    plantSpeciesIdentificationAdapter,
    configuration.plantConditionAi,
    plantConditionAnalysisAdapter,
    configuration.taxonKnowledge,
    configuration.plantReview,
    configuration.transactionalEmail,
    cloudTasksInvocationVerifier,
    logger,
    dependencies.addressGeocoder ?? null,
  );

  // collaboration (P9B-API-01, P9C-PUBLISH-01, P9C-INVITE-01): organizations,
  // assignments, engagements, publisher capability, and client invitations.
  // Split out for the same 600-line reason as its siblings.
  const {
    organizationRoutesDependencies,
    organizationMemberRoutesDependencies,
    gardenAssignmentRoutesDependencies,
    clientEngagementRoutesDependencies,
    gardenScopedRoutesDependencies,
    publicationRoutesDependencies,
    clientPortalRoutesDependencies,
  } = composeCollaboration(database, clock, gardenAuthorization, profileRepository, {
    adapter: transactionalEmailAdapter,
    clientPortalBaseUrl: configuration.transactionalEmail.clientPortalBaseUrl,
    callTimeoutMs: configuration.transactionalEmail.callTimeoutMs,
  });

  // media (P6-API-01): registration, authorized resumable upload sessions,
  // completion verification, status, and authorized short-lived access.
  // Reuses `gardenAuthorization`. HTTP transport (`registerMediaRoutes`, tag
  // `Media`) wired below. Split into `compose-media.ts` for the same
  // 600-line reason `compose-gardens-mapping.ts` was split out.
  const {
    mediaRoutesDependencies,
    mediaProcessingCallbackRouteDependencies,
    mediaRetentionSweepRouteDependencies,
    clientMediaRoutesDependencies,
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
  const imageAnalysisResultRepository = new KyselyImageAnalysisResultRepository(database.queries);
  // Standalone, outside the unit of work: journal frames are a READ, and
  // wrapping a read in a transaction to reach the repository would be paying
  // for a guarantee it does not need.
  const observationPhotoRepository = new KyselyObservationPhotoRepository(database.queries);
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
    analyzePlantCondition,
  );
  const correctObservation = new CorrectObservation(
    observationsHistoryIdempotency,
    observationsHistoryUnitOfWork,
    gardenAuthorization,
    observationRepository,
    clock,
    analyzePlantCondition,
  );
  const listObservationsForGarden = new ListObservationsForGarden(
    observationRepository,
    gardenAuthorization,
  );
  const listObservationsForPlant = new ListObservationsForPlant(
    observationRepository,
    gardenAuthorization,
  );
  // P11-MEDIA-01: a plant's photographs as an ordered comparison sequence.
  const listPlantJournalFrames = new ListPlantJournalFrames(
    observationPhotoRepository,
    gardenAuthorization,
  );
  // Used below by tasks-recommendations' `CreateManualTask`.
  const getObservation = new GetObservation(observationRepository);
  // P11-HEALTH-01: reviewing a health suggestion's disposition.
  const setHealthSuggestionDisposition = new SetHealthSuggestionDisposition(
    observationsHistoryIdempotency,
    observationsHistoryUnitOfWork,
    gardenAuthorization,
    imageAnalysisResultRepository,
    clock,
  );

  const observationRoutesDependencies = {
    recordObservation,
    correctObservation,
    listObservationsForGarden,
    listObservationsForPlant,
    listPlantJournalFrames,
    setHealthSuggestionDisposition,
  };

  // plants-inventory: owns the mutable `plant` aggregate root, its
  // `plant_photo`/`plant_identification` children, and the read-only
  // `taxonomy_reference` catalog. Reuses `gardenAuthorization`. HTTP
  // transport (`registerPlantRoutes`, tag `Plants`) wired below. Split into
  // `compose-plants-inventory.ts` for the same 600-line reason as its
  // siblings.
  const {
    plantRoutesDependencies,
    candidateRoutesDependencies,
    seasonalFactReviewRoutesDependencies,
  } = composePlantsInventory(
    database,
    clock,
    gardenAuthorization,
    identifyPlantSpecies,
    logger,
    analyzePlantCondition,
    recordObservation,
    taxonProfileEnricher,
    configuration.plantReview.reviewerEmails,
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
    careRuleRoutesDependencies,
    recommendationEvaluationSweepRouteDependencies,
    seasonalPlanRoutesDependencies,
  } = composeTasksRecommendations(
    database,
    clock,
    gardenAuthorization,
    getObservation,
    getGardenWeather,
    getGardenPrecipitation,
    generateAiExplanation,
    configuration.aiExplanation.enabled,
    cloudTasksInvocationVerifier,
    configuration.weather.activeProviderKey,
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

  // exports (P8-EXPORT-01, P9C-EXPORT-01): export request/status/download,
  // the worker-internal endpoints, and the client export/handoff manifest —
  // see `compose-exports.ts` for the dependency reasoning.
  const {
    exportRoutesDependencies,
    exportInternalRoutesDependencies,
    clientExportRoutesDependencies,
  } = composeExports(
    database,
    clock,
    gardenAuthorization,
    mediaStorageGateway,
    configuration.media.buckets,
    configuration.serviceVersion,
    cloudTasksInvocationVerifier,
    clientMediaRoutesDependencies.getClientMediaAccess,
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
      registerInternalRoutes(instance, {
        mediaProcessingCallback: mediaProcessingCallbackRouteDependencies,
        mediaRetentionSweep: mediaRetentionSweepRouteDependencies,
        weatherRefreshSweep: weatherRefreshSweepRouteDependencies,
        recommendationEvaluationSweep: recommendationEvaluationSweepRouteDependencies,
        notificationEvents: notificationEventsRouteDependencies,
        notificationDeliverySweep: notificationDeliverySweepRouteDependencies,
        exportInternal: exportInternalRoutesDependencies,
        deletionSweep: deletionSweepRouteDependencies,
        invitationExpirySweep: invitationExpirySweepRouteDependencies,
        taxonEnrichmentSweep: taxonEnrichmentSweepRouteDependencies,
      });
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
      registerGeoreferenceRoutes(instance, georeferenceRoutesDependencies);
      registerPlatRoutes(instance, platRoutesDependencies);
      // P12-GEO-01: address lookup for that same resource. Authenticated like
      // everything else in this block — it reads no garden, but it spends a
      // provider call, and an unauthenticated one would be a free proxy to a
      // third-party service.
      registerGeocodingRoutes(instance, geocodingRoutesDependencies);
      // The garden's stored weather — the same readings the rule engine's
      // weather gate reasons from, so what a person sees and what the
      // engine decided on cannot disagree.
      registerWeatherRoutes(instance, weatherRoutesDependencies);
      // What the automation does and what currently stops it — read-only
      // disclosure of the same catalog the engine evaluates.
      registerCareRuleRoutes(instance, careRuleRoutesDependencies);
      // P9D-CONTEXT-01: reviewed/declared garden context facts (sun
      // exposure, soil type, drainage, irrigation method, growing context,
      // microclimate).
      registerGardenContextRoutes(instance, gardenContextRoutesDependencies);
      // P9A-API-01: operational invitations and membership administration.
      registerInvitationRoutes(instance, invitationRoutesDependencies);
      registerMemberRoutes(instance, memberRoutesDependencies);
      // P9A-OWNER-01: recent-auth-gated promote/demote/transfer/cancel.
      registerOwnershipRoutes(instance, ownershipRoutesDependencies);
      // P9B-API-01: service organizations, organization membership, garden
      // assignment, and client engagement lifecycle, plus the two
      // garden-scoped reads onto that domain.
      registerOrganizationRoutes(instance, organizationRoutesDependencies);
      registerOrganizationMemberRoutes(instance, organizationMemberRoutesDependencies);
      registerGardenAssignmentRoutes(instance, gardenAssignmentRoutesDependencies);
      registerClientEngagementRoutes(instance, clientEngagementRoutesDependencies);
      registerGardenScopedCollaborationRoutes(instance, gardenScopedRoutesDependencies);
      // P9C-PUBLISH-01: publisher capability and client-update workflow.
      registerPublicationRoutes(instance, publicationRoutesDependencies);
      registerPlantRoutes(instance, plantRoutesDependencies);
      // P11-API-01: plant candidates, conversion, suitability, and the
      // shared taxon knowledge profile (tags `PlantCandidates`,
      // `PlantCatalog`). `getTaxonProfile`'s own route is not garden-scoped
      // but still requires authentication — the same posture
      // `searchTaxonomyReferences` (just above) already takes.
      registerCandidateRoutes(instance, candidateRoutesDependencies);
      // P11-PROV-01: the horticultural-review surface (guard lives in the use cases, not here).
      registerPlantAssertionReviewRoutes(instance, plantAssertionReviewRoutesDependencies);
      // The seasonal-timing review queue and its sign-off — the same
      // allowlisted reviewer role, applied to the content three rules read.
      registerSeasonalFactReviewRoutes(instance, seasonalFactReviewRoutesDependencies);
      registerObservationRoutes(instance, observationRoutesDependencies);
      registerTaskRoutes(instance, taskRoutesDependencies);
      registerRecommendationRoutes(instance, recommendationRoutesDependencies);
      // P9D-SEASON-API-01: the garden-wide seasonal plan read.
      registerSeasonalPlanRoutes(instance, seasonalPlanRoutesDependencies);
      registerNotificationRoutes(instance, notificationRoutesDependencies);
      registerNotificationDeviceRoutes(instance, notificationDeviceRoutesDependencies);
      registerMediaRoutes(instance, mediaRoutesDependencies);
      // P9C-API-01: the publication-only client portal, its media-access
      // route (media module), and the P9C-EXPORT-01 export/handoff manifest.
      registerClientPortalRoutes(instance, clientPortalRoutesDependencies);
      registerClientMediaRoutes(instance, clientMediaRoutesDependencies);
      registerClientExportRoutes(instance, clientExportRoutesDependencies);
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
