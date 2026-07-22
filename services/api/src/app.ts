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
  GetGarden,
  GetGardenMap,
  JoinMapObjectLinework,
  KyselyCoordinateSpaceRepository,
  KyselyGardenRepository,
  KyselyGardensMappingUnitOfWork,
  KyselyGeoreferenceRepository,
  KyselyMapObjectRepository,
  KyselyMembershipRepository,
  ListGardens,
  MoveMapObject,
  registerGardenRoutes,
  registerMapRoutes,
  RenameGarden,
  ReplaceMapObjectGeometry,
  RequestGardenDeletion,
  RestoreMapObject,
  SplitMapObjectLinework,
  UpsertMapCalibration,
} from './modules/gardens-mapping/public.js';
import {
  KyselyIdentityProviderLinkRepository,
  KyselyProfileRepository,
  ProvisionProfile,
} from './modules/identity-access/public.js';
import {
  DatabaseDependencyProbe,
  registerHealthRoutes,
  ServiceHealth,
} from './modules/service-health/public.js';
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

  // gardens-mapping: owns gardens and, in Phase 2 only, garden membership —
  // see membership-repository.ts for why. Read paths use the pooled
  // connection directly; commands go through the transactional unit of work.
  const gardenRepository = new KyselyGardenRepository(database.queries);
  const gardenAuthorization = new GardenAuthorization(
    new KyselyMembershipRepository(database.queries),
  );
  const gardenIdempotency = new KyselyIdempotencyStore(database.queries, clock);
  const gardensMappingUnitOfWork = new KyselyGardensMappingUnitOfWork(database.queries, clock);

  const gardenRoutesDependencies = {
    listGardens: new ListGardens(gardenRepository),
    createGarden: new CreateGarden(gardenIdempotency, gardensMappingUnitOfWork, clock),
    getGarden: new GetGarden(gardenRepository, gardenAuthorization),
    renameGarden: new RenameGarden(
      gardenIdempotency,
      gardensMappingUnitOfWork,
      gardenAuthorization,
      clock,
    ),
    archiveGarden: new ArchiveGarden(
      gardenIdempotency,
      gardensMappingUnitOfWork,
      gardenAuthorization,
      clock,
    ),
    requestGardenDeletion: new RequestGardenDeletion(
      gardenIdempotency,
      gardensMappingUnitOfWork,
      gardenAuthorization,
      clock,
    ),
  };

  // Garden map (P3-BE-01, P3-BE-02): the read side (GetGardenMap) uses the
  // pooled connection directly, same as gardenRepository above; every
  // mutating command shares gardenIdempotency/gardensMappingUnitOfWork/
  // gardenAuthorization with the garden lifecycle commands, since both are
  // the same idempotency table, the same transaction boundary, and the same
  // capability matrix.
  const mapObjectRepository = new KyselyMapObjectRepository(database.queries);
  const coordinateSpaceRepository = new KyselyCoordinateSpaceRepository(database.queries);
  const georeferenceRepository = new KyselyGeoreferenceRepository(database.queries);

  const mapRoutesDependencies = {
    getGardenMap: new GetGardenMap(
      gardenAuthorization,
      coordinateSpaceRepository,
      georeferenceRepository,
      mapObjectRepository,
      clock,
    ),
    createMapObject: new CreateMapObject(
      gardenIdempotency,
      gardensMappingUnitOfWork,
      gardenAuthorization,
      clock,
    ),
    moveMapObject: new MoveMapObject(
      gardenIdempotency,
      gardensMappingUnitOfWork,
      gardenAuthorization,
      clock,
    ),
    replaceMapObjectGeometry: new ReplaceMapObjectGeometry(
      gardenIdempotency,
      gardensMappingUnitOfWork,
      gardenAuthorization,
      clock,
    ),
    editMapObjectVertex: new EditMapObjectVertex(
      gardenIdempotency,
      gardensMappingUnitOfWork,
      gardenAuthorization,
      clock,
    ),
    splitMapObjectLinework: new SplitMapObjectLinework(
      gardenIdempotency,
      gardensMappingUnitOfWork,
      gardenAuthorization,
      clock,
    ),
    joinMapObjectLinework: new JoinMapObjectLinework(
      gardenIdempotency,
      gardensMappingUnitOfWork,
      gardenAuthorization,
      clock,
    ),
    changeMapObjectProperties: new ChangeMapObjectProperties(
      gardenIdempotency,
      gardensMappingUnitOfWork,
      gardenAuthorization,
      clock,
    ),
    assignPlantToTarget: new AssignPlantToTarget(
      gardenIdempotency,
      gardensMappingUnitOfWork,
      gardenAuthorization,
      clock,
    ),
    upsertMapCalibration: new UpsertMapCalibration(
      gardenIdempotency,
      gardensMappingUnitOfWork,
      gardenAuthorization,
      clock,
    ),
    decideMapProposal: new DecideMapProposal(gardenAuthorization),
    deleteMapObject: new DeleteMapObject(
      gardenIdempotency,
      gardensMappingUnitOfWork,
      gardenAuthorization,
      clock,
    ),
    restoreMapObject: new RestoreMapObject(
      gardenIdempotency,
      gardensMappingUnitOfWork,
      gardenAuthorization,
      clock,
    ),
    duplicateMapObject: new DuplicateMapObject(
      gardenIdempotency,
      gardensMappingUnitOfWork,
      gardenAuthorization,
      clock,
    ),
  };

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
      done();
    },
    { prefix: API_BASE_PATH },
  );

  return app;
}
