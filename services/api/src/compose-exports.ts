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
 */

import type { GardenAuthorization } from './modules/gardens-mapping/public.js';
import type { MediaStorageGateway } from './modules/media/public.js';
import { KyselyMediaRepository } from './modules/media/public.js';
import {
  CompleteExport,
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
}

export function composeExports(
  database: DatabaseGateway,
  clock: Clock,
  gardenAuthorization: GardenAuthorization,
  mediaStorageGateway: MediaStorageGateway,
  bucketNames: MediaConfiguration['buckets'],
  serviceVersion: string,
  cloudTasksInvocationVerifier: CloudTasksInvocationVerifier,
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

  return { exportRoutesDependencies, exportInternalRoutesDependencies };
}
