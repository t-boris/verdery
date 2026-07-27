/**
 * Public interface of the exports module (P8-EXPORT-01).
 *
 * Other modules and the composition root may import only from this file.
 *
 * Source: architecture/backend-modular-monolith.md, section "5.5 Public Interface".
 */

export type { ExportRequest, ExportRequestState, ExportScope } from './domain/export-request.js';
export {
  assertRecentAuthenticationForAccountExport,
  beginExportGeneration,
  completeExportRequest,
  createExportRequest,
  failExportRequest,
  isExportRequestTerminal,
  RECENT_AUTHENTICATION_MAX_AGE_MS,
  recordExportBoundary,
} from './domain/export-request.js';
export type {
  ExportRequestRepository,
  ExportSectionCheckpointRecord,
  NewExportSectionCheckpoint,
} from './application/export-request-repository.js';
export type {
  ExportsTransactionContext,
  ExportsUnitOfWork,
} from './application/exports-unit-of-work.js';
export type {
  ExportGardenData,
  ExportGardenListing,
  ExportMediaFileEntry,
  ExportSnapshotData,
  ExportSnapshotReader,
  ExportSnapshotScope,
} from './application/export-snapshot-reader.js';
export { buildExportSections } from './application/export-sections.js';
export { RequestExport } from './application/request-export.js';
export type { RequestExportInput } from './application/request-export.js';
export { GetExportRequest } from './application/get-export-request.js';
export { GetExportDownload } from './application/get-export-download.js';
export {
  RunExportSnapshot,
  exportStagingObjectKeyPrefix,
} from './application/run-export-snapshot.js';
export { RecordExportCheckpoints } from './application/record-export-checkpoints.js';
export { CompleteExport } from './application/complete-export.js';
export { KyselyExportRequestRepository } from './persistence/kysely-export-request-repository.js';
export { KyselyExportsUnitOfWork } from './persistence/kysely-exports-unit-of-work.js';
export { KyselyExportSnapshotReader } from './persistence/kysely-export-snapshot-reader.js';
export type { ExportsDatabaseSchema } from './persistence/schema.js';
export type { ExportRoutesDependencies } from './transport/export-routes.js';
export { registerExportRoutes } from './transport/export-routes.js';
export type { ExportInternalRoutesDependencies } from './transport/export-internal-routes.js';
export { registerExportInternalRoutes } from './transport/export-internal-routes.js';

// Client-entitled export/handoff manifest (P9C-EXPORT-01, tag ClientPortal) —
// the client-scoped equivalent of the surface above, reusing its discipline
// (a manifest discloses what is included; entitlement is re-verified, never
// assumed) without reusing its asynchronous job machinery — see
// `GetClientExportManifest`'s own header for why.
export type {
  ClientExportGardenModelResource,
  ClientExportManifestResource,
  ClientExportMediaEntryResource,
} from './application/client-export-view.js';
export { GetClientExportManifest } from './application/get-client-export-manifest.js';
export type { ClientExportRoutesDependencies } from './transport/client-export-routes.js';
export { registerClientExportRoutes } from './transport/client-export-routes.js';
