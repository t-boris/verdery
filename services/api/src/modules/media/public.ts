/**
 * Public interface of the media module.
 *
 * Other modules and the composition root may import only from this file.
 *
 * Four different audiences use this file:
 *
 * - `plants-inventory`, `observations-history`, and `tasks-recommendations`
 *   need `MediaRecord` and `MediaRepository`: the type and the port
 *   interface they foreign-key their own photo/attachment tables against.
 * - P6-API-01's own commands/queries and their tests need the state-machine
 *   surface: the `MediaClass`/`MediaUploadState`/`MediaProcessingState`/
 *   `MediaSensitivityClassification` types, `registerMediaRecord` and every
 *   `media-lifecycle.ts` transition function, and the quota-reservation
 *   domain surface (`QuotaReservation` and its own reserve/commit/release
 *   functions) — built as pure, tested domain logic by P6-DATA-01, now
 *   wired into HTTP endpoints by P6-API-01's `RegisterMediaUpload`/
 *   `CompleteMediaUpload`/`GetMediaStatus`/`GetMediaAccess`, exported here
 *   alongside the ports (`MediaStorageGateway`, `QuotaReservationRepository`)
 *   and bucket-selection helpers those commands depend on.
 * - The composition root (`app.ts` / `compose-media.ts`) additionally needs
 *   the concrete classes below — `KyselyMediaRepository`,
 *   `KyselyQuotaReservationRepository`, `KyselyMediaUnitOfWork`,
 *   `GcsMediaStorageGateway`, `RegisterMediaRecord`, and the four P6-API-01
 *   commands/queries plus `registerMediaRoutes` — to construct this module's
 *   dependency graph and wire its HTTP transport, the same way it already
 *   does for gardens-mapping and identity-access.
 * - This module's own `*.test.ts` files (unit tests for each P6-API-01
 *   command/query) import `media-test-doubles.ts`'s shared fakes directly,
 *   not through this file — the same "not re-exported through public.ts,
 *   it's an internal test-only detail" precedent
 *   `plants-inventory-test-doubles.ts` already sets.
 *
 * Source: architecture/backend-modular-monolith.md, section "5.5 Public Interface".
 */

export type {
  MediaClass,
  MediaRecord,
  MediaSensitivityClassification,
} from './domain/media-record.js';
export {
  deriveDefaultSensitivityClassification,
  normalizeChecksumSha256,
  normalizeDisplayFilename,
  registerMediaRecord,
  registerExportPackageMediaRecord,
  validateDeclaredByteSize,
  validateDeclaredContentType,
} from './domain/media-record.js';
// P8-EXPORT-01: the export package's own registration input.
export type { RegisterExportPackageMediaRecordInput } from './domain/media-record.js';
export type { MediaProcessingState, MediaUploadState } from './domain/media-lifecycle.js';
export {
  authorizeMediaUpload,
  beginMediaProcessing,
  beginMediaUpload,
  beginMediaVerification,
  markMediaAvailable,
  markMediaDeleted,
  markMediaProcessed,
  markMediaProcessingFailed,
  markMediaRejected,
  scheduleMediaDeletion,
  scheduleStaleMediaUploadDeletion,
} from './domain/media-lifecycle.js';
// P6-RET-01: retention policy, deletion workflow, and the retention sweep.
export type { MediaClassRetentionRule, MediaRetentionAnchor } from './domain/media-retention.js';
export {
  deriveDefaultRetentionDeadline,
  EXPORT_PACKAGE_RETENTION_DAYS,
  MEDIA_RETENTION_RULES,
  RAW_CAPTURE_RETENTION_DAYS,
  STALE_UPLOAD_RECONCILIATION_DAYS,
  staleUploadCutoff,
} from './domain/media-retention.js';
export type {
  MediaReferenceFinder,
  MediaReferenceKind,
} from './application/media-reference-finder.js';
export { DeleteGardenMedia } from './application/delete-garden-media.js';
export { GetMediaRetentionPolicy } from './application/get-media-retention-policy.js';
export { RunMediaRetentionSweep } from './application/run-media-retention-sweep.js';
export type { MediaRetentionSweepResult } from './application/run-media-retention-sweep.js';
// P8-DELETE-01: the purge's entry into the same byte-deletion workflow.
export type { MediaDeletionInitiator } from './application/media-deletion-workflow.js';
export { SchedulePurgeMediaDeletion } from './application/schedule-purge-media-deletion.js';
export type { SchedulePurgeMediaDeletionResult } from './application/schedule-purge-media-deletion.js';
export { KyselyMediaReferenceFinder } from './persistence/kysely-media-reference-finder.js';
export type { MediaRetentionSweepRouteDependencies } from './transport/media-retention-sweep-route.js';
export { registerMediaRetentionSweepRoute } from './transport/media-retention-sweep-route.js';
export type {
  QuotaReservation,
  QuotaReservationScopeKind,
  QuotaReservationState,
} from './domain/quota-reservation.js';
export {
  commitQuotaReservation,
  releaseQuotaReservation,
  reserveMediaQuota,
} from './domain/quota-reservation.js';
export type { MediaPurgeScope, MediaRepository } from './application/media-repository.js';
export type { MediaRecordResource } from './application/media-record-view.js';
export type { MediaUnitOfWork, MediaTransactionContext } from './application/media-unit-of-work.js';
// P6-ASYNC-01: durable processing-job state, the processing-result callback
// command, and the Cloud Tasks invocation verifier port.
export type {
  ProcessingJob,
  ProcessingJobOutputObject,
  ProcessingJobResourceMetrics,
  ProcessingJobState,
} from './domain/processing-job.js';
export {
  createProcessingJob,
  isProcessingJobTerminal,
  markProcessingJobCancelled,
  markProcessingJobExpired,
  markProcessingJobFailedRetryable,
  markProcessingJobFailedTerminal,
  markProcessingJobPartial,
  markProcessingJobQueued,
  markProcessingJobRunning,
  markProcessingJobSucceeded,
  retryProcessingJob,
} from './domain/processing-job.js';
export type { ProcessingJobRepository } from './application/processing-job-repository.js';
export { KyselyProcessingJobRepository } from './persistence/kysely-processing-job-repository.js';
export { RecordMediaProcessingResult } from './application/record-media-processing-result.js';
export type { MediaProcessingCallbackRouteDependencies } from './transport/media-processing-callback-route.js';
export { registerMediaProcessingCallbackRoute } from './transport/media-processing-callback-route.js';
export type { RegisterMediaRecordInput } from './application/register-media-record.js';
export { RegisterMediaRecord } from './application/register-media-record.js';

// P6-API-01: registration, authorized resumable upload sessions, completion
// verification, status, and authorized short-lived access.
export type { QuotaReservationRepository } from './application/quota-reservation-repository.js';
export type {
  MediaObjectMetadata,
  MediaResumableUploadSession,
  MediaSignedDownloadAccess,
  MediaStorageGateway,
  MediaStorageObjectTarget,
} from './application/media-storage-gateway.js';
export type { MediaStorageBucketNames } from './application/media-storage-target.js';
export { generateObjectKey, selectBucketName } from './application/media-storage-target.js';
export type { RegisterMediaUploadInput } from './application/register-media-upload.js';
export { RegisterMediaUpload } from './application/register-media-upload.js';
export { CompleteMediaUpload } from './application/complete-media-upload.js';
export { GetMediaStatus } from './application/get-media-status.js';
export { GetMediaAccess } from './application/get-media-access.js';
// P6-PLAN-01: media listing (originals, by garden and class).
export { ListGardenMedia } from './application/list-garden-media.js';
// P9C-MEDIA-01: client-side media authorization — active engagement plus
// explicit publication entitlement, short-lived and rechecked at issuance
// time. `ClientMediaEntitlementSource` is a narrow read port into
// `collaboration`'s own client-publication tables (see that file's own
// header for the module-boundary reasoning); `KyselyClientMediaEntitlementSource`
// is its Kysely adapter, exported here for a future P9C-API-01 route to wire
// alongside `GetClientMediaAccess`.
export type {
  ClientAccessGrantState,
  ClientMediaEntitlementGrant,
  ClientMediaEntitlementSource,
} from './application/client-media-entitlement-source.js';
export { GetClientMediaAccess } from './application/get-client-media-access.js';
export { KyselyClientMediaEntitlementSource } from './persistence/kysely-client-media-entitlement-source.js';
export { KyselyMediaRepository } from './persistence/kysely-media-repository.js';
export { KyselyQuotaReservationRepository } from './persistence/kysely-quota-reservation-repository.js';
export { KyselyMediaUnitOfWork } from './persistence/kysely-media-unit-of-work.js';
export { GcsMediaStorageGateway } from './persistence/gcs-media-storage-gateway.js';
export type { MediaDatabaseSchema } from './persistence/schema.js';
export type { MediaRoutesDependencies } from './transport/media-routes.js';
export { registerMediaRoutes } from './transport/media-routes.js';
// P9C-API-01: the client-portal's own thin transport wrapper around
// `GetClientMediaAccess` above (`/client/publications/{publicationId}/media/
// {mediaId}/access`, tag `ClientPortal`) — a separate registration function
// from `registerMediaRoutes` because it lives under a distinct client-facing
// path group with no `gardenId`, the same operational/client route-file
// split `collaboration/public.ts` already draws.
export type { ClientMediaRoutesDependencies } from './transport/client-media-routes.js';
export { registerClientMediaRoutes } from './transport/client-media-routes.js';
