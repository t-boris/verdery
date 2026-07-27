/**
 * Composition-root helper for the exports module's P8-EXPORT-01 surface:
 * the export request command, status and download reads, and the three
 * internal endpoints the generation worker calls — split out of `app.ts`
 * for the same 600-line reason as its sibling `compose-*.ts` files. Still
 * composition-root code, not a module boundary.
 *
 * Reuses `gardenAuthorization` and the shared `mediaStorageGateway` (the
 * download signs URLs through the same gateway `GetMediaAccess` uses —
 * "the existing signed-access mechanism").
 *
 * Also composes the client-entitled export manifest (P9C-EXPORT-01):
 * `getClientMediaAccess` arrives ALREADY CONSTRUCTED (built once by
 * `composeMedia`, the same `clientMediaRoutesDependencies.getClientMediaAccess`
 * instance `registerClientMediaRoutes` itself uses) rather than a second
 * one — there is no per-call state to duplicate, and constructing a second
 * instance would risk the two drifting in configuration. Every other new
 * dependency here (`GardenRepository`/`MapObjectRepository`/
 * `CoordinateSpaceRepository`/`GeoreferenceRepository`/`PlantRepository`/
 * `ClientAccessGrantRepository`/`ClientEngagementRepository`/
 * `ClientPublicationReadRepository`) is a FRESH, stateless reader over the
 * same pooled connection — the identical "second independent reader over
 * the same pool" posture `compose-collaboration.ts`'s own header documents
 * for its own `KyselyGardenRepository`, applied here to a fifth consumer
 * rather than a fourth.
 */

import {
  ClientPortalAuthorization,
  KyselyClientAccessGrantRepository,
  KyselyClientEngagementRepository,
  KyselyClientPublicationReadRepository,
} from './modules/collaboration/public.js';
import {
  KyselyCoordinateSpaceRepository,
  KyselyGardenRepository,
  KyselyGeoreferenceRepository,
  KyselyMapObjectRepository,
} from './modules/gardens-mapping/public.js';
import type { GardenAuthorization } from './modules/gardens-mapping/public.js';
import type { GetClientMediaAccess, MediaStorageGateway } from './modules/media/public.js';
import { KyselyMediaRepository } from './modules/media/public.js';
import { KyselyPlantRepository } from './modules/plants-inventory/public.js';
import {
  CompleteExport,
  GetClientExportManifest,
  GetExportDownload,
  GetExportRequest,
  KyselyExportRequestRepository,
  KyselyExportSnapshotReader,
  KyselyExportsUnitOfWork,
  RecordExportCheckpoints,
  RequestExport,
  RunExportSnapshot,
} from './modules/exports/public.js';
import type {
  ClientExportRoutesDependencies,
  ExportInternalRoutesDependencies,
  ExportRoutesDependencies,
} from './modules/exports/public.js';
import type { DatabaseGateway } from './platform/database/database-gateway.js';
import { KyselyIdempotencyStore } from './platform/idempotency/kysely-idempotency-store.js';
import type { MediaConfiguration } from './platform/configuration/configuration-schema.js';
import type { CloudTasksInvocationVerifier } from './platform/tasks/cloud-tasks-invocation-verifier.js';
import type { Clock } from './shared/time/clock.js';

export interface ExportsComposition {
  readonly exportRoutesDependencies: ExportRoutesDependencies;
  readonly exportInternalRoutesDependencies: ExportInternalRoutesDependencies;
  readonly clientExportRoutesDependencies: ClientExportRoutesDependencies;
}

export function composeExports(
  database: DatabaseGateway,
  clock: Clock,
  gardenAuthorization: GardenAuthorization,
  mediaStorageGateway: MediaStorageGateway,
  bucketNames: MediaConfiguration['buckets'],
  serviceVersion: string,
  cloudTasksInvocationVerifier: CloudTasksInvocationVerifier,
  getClientMediaAccess: GetClientMediaAccess,
): ExportsComposition {
  const exportRequestRepository = new KyselyExportRequestRepository(database.queries);
  const exportsUnitOfWork = new KyselyExportsUnitOfWork(database.queries, clock);
  const exportsIdempotency = new KyselyIdempotencyStore(database.queries, clock);

  const exportRoutesDependencies: ExportRoutesDependencies = {
    requestExport: new RequestExport(
      exportsIdempotency,
      exportsUnitOfWork,
      gardenAuthorization,
      bucketNames,
      clock,
    ),
    getExportRequest: new GetExportRequest(exportRequestRepository),
    getExportDownload: new GetExportDownload(
      exportRequestRepository,
      new KyselyMediaRepository(database.queries),
      mediaStorageGateway,
      clock,
    ),
  };

  const exportInternalRoutesDependencies: ExportInternalRoutesDependencies = {
    runExportSnapshot: new RunExportSnapshot(
      exportsUnitOfWork,
      new KyselyExportSnapshotReader(database.queries, clock),
      serviceVersion,
      clock,
    ),
    recordExportCheckpoints: new RecordExportCheckpoints(exportsUnitOfWork, clock),
    completeExport: new CompleteExport(exportsUnitOfWork, clock),
    cloudTasksInvocationVerifier,
  };

  const clientPortalAuthorization = new ClientPortalAuthorization(
    new KyselyClientAccessGrantRepository(database.queries),
    new KyselyClientEngagementRepository(database.queries),
  );

  const clientExportRoutesDependencies: ClientExportRoutesDependencies = {
    getClientExportManifest: new GetClientExportManifest(
      clientPortalAuthorization,
      new KyselyClientPublicationReadRepository(database.queries),
      new KyselyGardenRepository(database.queries),
      new KyselyCoordinateSpaceRepository(database.queries),
      new KyselyGeoreferenceRepository(database.queries),
      new KyselyMapObjectRepository(database.queries),
      new KyselyPlantRepository(database.queries),
      getClientMediaAccess,
      clock,
    ),
  };

  return {
    exportRoutesDependencies,
    exportInternalRoutesDependencies,
    clientExportRoutesDependencies,
  };
}
