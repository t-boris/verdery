/**
 * Composition-root helper for the gardens-mapping module: garden lifecycle
 * and garden-map dependency wiring, split out of `app.ts` purely to keep
 * that file at or below the repository's 600-line source-file limit — this
 * is still composition-root code, not a module boundary. `app.ts` remains
 * the one place every plugin, adapter, and route is assembled and every
 * route is registered; this file only builds the two dependency objects
 * `registerGardenRoutes`/`registerMapRoutes` need, by hand, the same
 * explicit-constructor-injection style `app.ts`'s own header comment
 * describes — nothing here is auto-loaded or looked up at runtime.
 *
 * `gardenAuthorization` is returned alongside the two route-dependency
 * objects because every module wired after this one in `app.ts`
 * (observations-history, plants-inventory, tasks-recommendations) reuses
 * this exact instance rather than constructing its own — the same
 * shared-capability-matrix reasoning `app.ts`'s own comment on
 * `gardenAuthorization` already gives.
 *
 * Source: architecture/backend-modular-monolith.md, section "9. Composition Root".
 */

import {
  AcceptInvitation,
  AcceptOwnershipTransfer,
  ArchiveGarden,
  AssignPlantToTarget,
  CancelOwnershipTransfer,
  ChangeMapObjectProperties,
  ChangeMemberRole,
  CreateGarden,
  CreateInvitation,
  CreateMapObject,
  DecideMapProposal,
  DeclineOwnershipTransfer,
  DeleteMapObject,
  DemoteOwner,
  DuplicateMapObject,
  EditMapObjectVertex,
  GardenAuthorization,
  GetGarden,
  GetGardenMap,
  GetGardenOwnershipTransfer,
  JoinMapObjectLinework,
  KyselyCoordinateSpaceRepository,
  KyselyGardenAssignmentAccessSource,
  KyselyGardenContextFactRepository,
  KyselyGardenRepository,
  KyselyGardensMappingUnitOfWork,
  KyselyGeoreferenceRepository,
  KyselyInvitationRepository,
  KyselyMapObjectRepository,
  KyselyMembershipRepository,
  KyselyOwnershipTransferRepository,
  ListGardenContextFacts,
  ListGardenInvitations,
  ListGardenMembers,
  ListGardens,
  ListIncomingOwnershipTransfers,
  MediaPlatPageResolver,
  MoveMapObject,
  ReadPlatFromPlan,
  PromoteToOwner,
  RecordGardenContextFact,
  RemoveMember,
  RenameGarden,
  ReplaceMapObjectGeometry,
  RequestGardenDeletion,
  RestoreGardenDeletion,
  RestoreMapObject,
  RevokeInvitation,
  RunInvitationExpirySweep,
  SetGardenGeoreference,
  SplitMapObjectLinework,
  TransferOwnership,
  TraceGardenFromAerial,
  UpsertMapCalibration,
} from './modules/gardens-mapping/public.js';
import type {
  GardenContextRoutesDependencies,
  GardenRoutesDependencies,
  GeoreferenceRoutesDependencies,
  InvitationExpirySweepRouteDependencies,
  InvitationRoutesDependencies,
  MapRoutesDependencies,
  MemberRoutesDependencies,
  OwnershipRoutesDependencies,
  PlatRoutesDependencies,
} from './modules/gardens-mapping/public.js';
import type { FastifyBaseLogger } from 'fastify';
import { KyselyMediaRepository } from './modules/media/public.js';
import type {
  AerialTracingProviderAdapter,
  PlatExtractionProviderAdapter,
} from './modules/integrations/public.js';
import type { CloudTasksInvocationVerifier } from './platform/tasks/cloud-tasks-invocation-verifier.js';
import type { DatabaseGateway } from './platform/database/database-gateway.js';
import type { Clock } from './shared/time/clock.js';
import { KyselyIdempotencyStore } from './platform/idempotency/kysely-idempotency-store.js';

export interface GardensMappingComposition {
  readonly gardenAuthorization: GardenAuthorization;
  readonly gardenRoutesDependencies: GardenRoutesDependencies;
  readonly mapRoutesDependencies: MapRoutesDependencies;
  /** P12-GEO-01 — the garden's revisioned relationship to the Earth. */
  readonly georeferenceRoutesDependencies: GeoreferenceRoutesDependencies;
  /** ADR-0018 — reading an uploaded plat of survey into a reviewable boundary and objects. */
  readonly platRoutesDependencies: PlatRoutesDependencies;
  /** P9A-API-01 — garden-scoped invitation issue/revoke/accept. */
  readonly invitationRoutesDependencies: InvitationRoutesDependencies;
  /** P9A-API-01 — garden member roster, role change, removal. */
  readonly memberRoutesDependencies: MemberRoutesDependencies;
  /** P9A-API-01 — the worker-triggered invitation expiry sweep. */
  readonly invitationExpirySweepRouteDependencies: InvitationExpirySweepRouteDependencies;
  /** P9A-OWNER-01 — recent-auth-gated promote/demote/transfer/cancel. */
  readonly ownershipRoutesDependencies: OwnershipRoutesDependencies;
  /** P9D-CONTEXT-01 — garden context facts (sun exposure, soil type, drainage, irrigation method, growing context, microclimate) list/record. */
  readonly gardenContextRoutesDependencies: GardenContextRoutesDependencies;
}

export function composeGardensMapping(
  database: DatabaseGateway,
  clock: Clock,
  cloudTasksInvocationVerifier: CloudTasksInvocationVerifier,
  logger: FastifyBaseLogger,
  /** ADR-0018: `null` whenever `PLAT_READING_ENABLED` is off — no code path can reach Vertex. */
  platExtractionAdapter: PlatExtractionProviderAdapter | null,
  platReadingCallTimeoutMs: number,
  aerialTracingAdapter: AerialTracingProviderAdapter | null,
): GardensMappingComposition {
  // gardens-mapping: owns gardens and, in Phase 2 only, garden membership —
  // see membership-repository.ts for why. Read paths use the pooled
  // connection directly; commands go through the transactional unit of work.
  const gardenRepository = new KyselyGardenRepository(database.queries);
  // P9B-API-02: the assignment-sourced fallback `GardenAuthorization` needs
  // to honor `collaboration.garden_assignment` — see that class's own
  // header, "Step 1 has TWO independent sources". Wired here, once, onto the
  // single `gardenAuthorization` instance every other module's composition
  // reuses (see this file's own header), so the fix holds everywhere this
  // instance is already shared.
  const gardenAuthorization = new GardenAuthorization(
    new KyselyMembershipRepository(database.queries),
    new KyselyGardenAssignmentAccessSource(database.queries),
  );
  const gardenIdempotency = new KyselyIdempotencyStore(database.queries, clock);
  const gardensMappingUnitOfWork = new KyselyGardensMappingUnitOfWork(database.queries, clock);

  const gardenRoutesDependencies: GardenRoutesDependencies = {
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
    restoreGardenDeletion: new RestoreGardenDeletion(
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

  const mapRoutesDependencies: MapRoutesDependencies = {
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

  // Collaboration (P9A-API-01): invitations and membership administration.
  // Shares `gardenIdempotency`/`gardensMappingUnitOfWork`/`gardenAuthorization`
  // with the garden lifecycle and map commands above — same idempotency
  // table, same transaction boundary, same capability matrix. The sweep's
  // own repository is bound directly to the pooled connection, not the
  // transactional unit of work — see `RunInvitationExpirySweep`'s header for
  // why one bulk statement needs no transaction wrapper.
  const invitationRoutesDependencies: InvitationRoutesDependencies = {
    createInvitation: new CreateInvitation(
      gardenIdempotency,
      gardensMappingUnitOfWork,
      gardenAuthorization,
      clock,
    ),
    listGardenInvitations: new ListGardenInvitations(
      new KyselyInvitationRepository(database.queries),
      gardenAuthorization,
    ),
    revokeInvitation: new RevokeInvitation(
      gardenIdempotency,
      gardensMappingUnitOfWork,
      gardenAuthorization,
      clock,
    ),
    acceptInvitation: new AcceptInvitation(gardenIdempotency, gardensMappingUnitOfWork, clock),
  };

  const memberRoutesDependencies: MemberRoutesDependencies = {
    listGardenMembers: new ListGardenMembers(
      new KyselyMembershipRepository(database.queries),
      gardenAuthorization,
    ),
    changeMemberRole: new ChangeMemberRole(
      gardenIdempotency,
      gardensMappingUnitOfWork,
      gardenAuthorization,
      clock,
    ),
    removeMember: new RemoveMember(
      gardenIdempotency,
      gardensMappingUnitOfWork,
      gardenAuthorization,
      clock,
    ),
  };

  const invitationExpirySweepRouteDependencies: InvitationExpirySweepRouteDependencies = {
    runInvitationExpirySweep: new RunInvitationExpirySweep(
      new KyselyInvitationRepository(database.queries),
      clock,
    ),
    cloudTasksInvocationVerifier,
  };

  // Owner administration (P9A-OWNER-01): promote to co-owner, demote an
  // owner, request a transfer, accept/decline/cancel it. Shares
  // `gardenIdempotency`/`gardensMappingUnitOfWork`/`gardenAuthorization`
  // with every other Collaboration command above — same idempotency table,
  // same transaction boundary (which is where `KyselyOwnershipTransferRepository`
  // is actually bound; see `kysely-gardens-mapping-unit-of-work.ts`), same
  // capability matrix.
  //
  // The two P9A-OWNER-02 reads below need their own `KyselyOwnershipTransferRepository`
  // instance bound directly to the pooled connection, `database.queries` —
  // the transactional one above is scoped inside `gardensMappingUnitOfWork.run`
  // and never escapes it, exactly the same "read paths use the pooled
  // connection directly" reason `listGardenInvitations` below constructs its
  // own `KyselyInvitationRepository(database.queries)` rather than reusing
  // the unit of work's transactional instance.
  const ownershipTransferReadRepository = new KyselyOwnershipTransferRepository(database.queries);

  const ownershipRoutesDependencies: OwnershipRoutesDependencies = {
    promoteToOwner: new PromoteToOwner(
      gardenIdempotency,
      gardensMappingUnitOfWork,
      gardenAuthorization,
      clock,
    ),
    demoteOwner: new DemoteOwner(
      gardenIdempotency,
      gardensMappingUnitOfWork,
      gardenAuthorization,
      clock,
    ),
    transferOwnership: new TransferOwnership(
      gardenIdempotency,
      gardensMappingUnitOfWork,
      gardenAuthorization,
      clock,
    ),
    acceptOwnershipTransfer: new AcceptOwnershipTransfer(
      gardenIdempotency,
      gardensMappingUnitOfWork,
      gardenAuthorization,
      clock,
    ),
    declineOwnershipTransfer: new DeclineOwnershipTransfer(
      gardenIdempotency,
      gardensMappingUnitOfWork,
      gardenAuthorization,
      clock,
    ),
    cancelOwnershipTransfer: new CancelOwnershipTransfer(
      gardenIdempotency,
      gardensMappingUnitOfWork,
      gardenAuthorization,
      clock,
    ),
    getGardenOwnershipTransfer: new GetGardenOwnershipTransfer(
      ownershipTransferReadRepository,
      gardenAuthorization,
    ),
    listIncomingOwnershipTransfers: new ListIncomingOwnershipTransfers(
      ownershipTransferReadRepository,
    ),
  };

  // Garden context facts (P9D-CONTEXT-01): a single upsert-by-natural-key
  // repository bound directly to the pooled connection — `recordOrUpdate` is
  // one atomic `INSERT ... ON CONFLICT DO UPDATE` statement (see the
  // repository's own header), so unlike the garden lifecycle/map/collaboration
  // commands above it needs neither `gardensMappingUnitOfWork` nor
  // `gardenIdempotency`; it shares only `gardenAuthorization`.
  const gardenContextFactRepository = new KyselyGardenContextFactRepository(database.queries);

  const gardenContextRoutesDependencies: GardenContextRoutesDependencies = {
    listGardenContextFacts: new ListGardenContextFacts(
      gardenAuthorization,
      gardenContextFactRepository,
    ),
    recordGardenContextFact: new RecordGardenContextFact(
      gardenAuthorization,
      gardenContextFactRepository,
      clock,
    ),
  };

  const georeferenceRoutesDependencies: GeoreferenceRoutesDependencies = {
    setGardenGeoreference: new SetGardenGeoreference(
      gardenIdempotency,
      gardensMappingUnitOfWork,
      gardenAuthorization,
      clock,
    ),
  };

  // ADR-0018: the plan's readable page comes from the media module's own
  // repository, bound to the pooled connection like every other read path
  // here — the reading writes nothing, so it needs no unit of work.
  const platRoutesDependencies: PlatRoutesDependencies = {
    readPlatFromPlan: new ReadPlatFromPlan(
      platExtractionAdapter,
      new MediaPlatPageResolver(new KyselyMediaRepository(database.queries)),
      gardenAuthorization,
      platReadingCallTimeoutMs,
      logger,
      georeferenceRepository,
    ),
    traceGardenFromAerial: new TraceGardenFromAerial(
      aerialTracingAdapter,
      georeferenceRepository,
      gardenAuthorization,
      platReadingCallTimeoutMs,
      logger,
    ),
  };

  return {
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
  };
}
