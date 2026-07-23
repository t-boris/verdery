/**
 * Public interface of the media module.
 *
 * Other modules and the composition root may import only from this file.
 *
 * Three different audiences use this file:
 *
 * - `plants-inventory`, `observations-history`, and `tasks-recommendations`
 *   need `MediaRecord` and `MediaRepository`: the type and the port
 *   interface they foreign-key their own photo/attachment tables against.
 * - A future stage (P6-API-01) needs the state-machine surface: the
 *   `MediaClass`/`MediaUploadState`/`MediaProcessingState`/
 *   `MediaSensitivityClassification` types, `registerMediaRecord` and every
 *   `media-lifecycle.ts` transition function, and the quota-reservation
 *   domain surface (`QuotaReservation` and its own reserve/commit/release
 *   functions) — this stage (P6-DATA-01) builds all of these as pure,
 *   tested domain logic but wires none of them into an HTTP endpoint.
 * - The composition root (`app.ts`) additionally needs the concrete classes
 *   below — `KyselyMediaRepository`, `KyselyMediaUnitOfWork`, and
 *   `RegisterMediaRecord` — to construct this module's dependency graph, the
 *   same way it already does for gardens-mapping and identity-access.
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
  validateDeclaredByteSize,
  validateDeclaredContentType,
} from './domain/media-record.js';
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
} from './domain/media-lifecycle.js';
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
export type { MediaRepository } from './application/media-repository.js';
export type { MediaRecordResource } from './application/media-record-view.js';
export type { MediaUnitOfWork } from './application/media-unit-of-work.js';
export type { RegisterMediaRecordInput } from './application/register-media-record.js';
export { RegisterMediaRecord } from './application/register-media-record.js';
export { KyselyMediaRepository } from './persistence/kysely-media-repository.js';
export { KyselyMediaUnitOfWork } from './persistence/kysely-media-unit-of-work.js';
export type { MediaDatabaseSchema } from './persistence/schema.js';
