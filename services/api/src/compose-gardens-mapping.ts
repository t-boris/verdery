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
  RenameGarden,
  ReplaceMapObjectGeometry,
  RequestGardenDeletion,
  RestoreMapObject,
  SplitMapObjectLinework,
  UpsertMapCalibration,
} from './modules/gardens-mapping/public.js';
import type {
  GardenRoutesDependencies,
  MapRoutesDependencies,
} from './modules/gardens-mapping/public.js';
import type { DatabaseGateway } from './platform/database/database-gateway.js';
import type { Clock } from './shared/time/clock.js';
import { KyselyIdempotencyStore } from './platform/idempotency/kysely-idempotency-store.js';

export interface GardensMappingComposition {
  readonly gardenAuthorization: GardenAuthorization;
  readonly gardenRoutesDependencies: GardenRoutesDependencies;
  readonly mapRoutesDependencies: MapRoutesDependencies;
}

export function composeGardensMapping(
  database: DatabaseGateway,
  clock: Clock,
): GardensMappingComposition {
  // gardens-mapping: owns gardens and, in Phase 2 only, garden membership —
  // see membership-repository.ts for why. Read paths use the pooled
  // connection directly; commands go through the transactional unit of work.
  const gardenRepository = new KyselyGardenRepository(database.queries);
  const gardenAuthorization = new GardenAuthorization(
    new KyselyMembershipRepository(database.queries),
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

  return { gardenAuthorization, gardenRoutesDependencies, mapRoutesDependencies };
}
