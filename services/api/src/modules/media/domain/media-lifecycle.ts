/**
 * `uploadState`/`processingState` transitions — split out of `media-record.
 * ts` the same way `task-lifecycle.ts` splits out of `task.ts` and
 * `plant-lifecycle.ts` splits out of `plant.ts`.
 *
 * `uploadState` is ONE gated state machine — like `requireEditableStatus`'s
 * task statuses, not like `setPlantStatus`'s ungated ones — following
 * section 6's diagram literally: `registered` -> `authorized` ->
 * `uploading` -> `verifying` -> (`rejected` | `available`) ->
 * `deletion_scheduled` -> `deleted`. Every transition function here rejects
 * a source state it does not expect, matching `requireEditableStatus`'s
 * "reject an invalid transition, not a permissive setter" shape, not
 * `plant-lifecycle.ts`'s "no hard ordering enforced" one — section 6 gives
 * this state machine a real, documented order, unlike `lifecycleStage`.
 *
 * `processingState` is a SEPARATE, orthogonal column, not a second half of
 * `uploadState`'s own ten-node reading of the diagram — see
 * `migrations/1785100000000_media-lifecycle-and-quotas.sql`'s own comment
 * on this decision for the full reasoning (short version: no arrow in the
 * diagram leads from `processed`/`processing_failed` back to
 * `deletion_scheduled`, which would make a processed media row's deletion
 * path unreachable under a single-column reading — a real correctness gap,
 * not a stylistic one). `beginMediaProcessing`/`markMediaProcessed`/
 * `markMediaProcessingFailed` gate on `processingState` alone and never
 * touch `uploadState`; `scheduleMediaDeletion` gates on `uploadState` alone
 * and never touches `processingState` — the two state machines advance
 * independently, exactly as the diagram's two branches off `available`
 * suggest.
 *
 * Source: migrations/1785100000000_media-lifecycle-and-quotas.sql;
 * architecture/media-storage-and-processing.md, section
 * "6. Upload State Machine".
 */

import { DomainRuleViolatedError } from '../../../platform/errors/application-error.js';
import type { MediaRecord } from './media-record.js';

export type MediaUploadState =
  | 'registered'
  | 'authorized'
  | 'uploading'
  | 'verifying'
  | 'rejected'
  | 'available'
  | 'deletion_scheduled'
  | 'deleted';

export type MediaProcessingState = 'processing' | 'processed' | 'processing_failed';

function requireUploadState(media: MediaRecord, expected: MediaUploadState, action: string): void {
  if (media.uploadState !== expected) {
    throw new DomainRuleViolatedError(
      'media.media_record.upload_state_conflict',
      `${action} requires media '${media.id}' to be in upload state '${expected}', but it is '${media.uploadState}'.`,
    );
  }
}

function requireProcessingState(
  media: MediaRecord,
  expected: MediaProcessingState | null,
  action: string,
): void {
  if (media.processingState !== expected) {
    throw new DomainRuleViolatedError(
      'media.media_record.processing_state_conflict',
      `${action} requires media '${media.id}' to be in processing state '${String(expected)}', but it is '${String(media.processingState)}'.`,
    );
  }
}

/**
 * `registered` -> `authorized`. `bucketName`/`objectKey` are recorded here,
 * not created here: a real Cloud Storage resumable upload session is
 * P6-API-01/P6-PLAT-01's job, entirely out of this stage's scope — this
 * function only accepts whatever target that future infrastructure layer
 * assigned and stores it, the same way `markMediaAvailable` below only
 * records a verifier's output rather than performing verification itself.
 */
export function authorizeMediaUpload(
  media: MediaRecord,
  bucketName: string,
  objectKey: string,
  now: Date,
): MediaRecord {
  requireUploadState(media, 'registered', 'authorizeMediaUpload');

  return {
    ...media,
    uploadState: 'authorized',
    bucketName,
    objectKey,
    revision: media.revision + 1,
    updatedAt: now,
  };
}

/** `authorized` -> `uploading`. */
export function beginMediaUpload(media: MediaRecord, now: Date): MediaRecord {
  requireUploadState(media, 'authorized', 'beginMediaUpload');

  return { ...media, uploadState: 'uploading', revision: media.revision + 1, updatedAt: now };
}

/** `uploading` -> `verifying`. */
export function beginMediaVerification(media: MediaRecord, now: Date): MediaRecord {
  requireUploadState(media, 'uploading', 'beginMediaVerification');

  return { ...media, uploadState: 'verifying', revision: media.revision + 1, updatedAt: now };
}

/**
 * `verifying` -> `available`. Records the verifier's own output
 * (`verifiedContentType`/`verifiedByteSize`/`checksumSha256`) — deciding
 * whether a verification result should lead here or to
 * `markMediaRejected` (for example, on a declared/verified mismatch, per
 * section 8's "Declared versus actual type and size mismatch") is that
 * future verifier's own decision, not this function's: this function only
 * records an already-decided "accepted" outcome.
 *
 * `checksumSha256` is nullable, unlike `verifiedContentType`/
 * `verifiedByteSize`: P6-API-01's own synchronous verifier (`CompleteMediaUpload`)
 * reads real object metadata (content type, size) from Cloud Storage, but
 * never downloads and hashes the object's bytes to compute a real SHA-256 —
 * doing that from the interactive API would violate section 2's own
 * principle, "Binary media bypasses the interactive API data path." A real
 * content-hash verification is P6-WORKER-01's job. This parameter therefore
 * carries through whatever value was already on the record (the client's own
 * declared checksum, or `null` if none was supplied) unchanged — recording
 * that a checksum was never independently confirmed against real bytes at
 * this stage, not asserting a new one.
 */
export function markMediaAvailable(
  media: MediaRecord,
  verifiedContentType: string,
  verifiedByteSize: number,
  checksumSha256: string | null,
  now: Date,
): MediaRecord {
  requireUploadState(media, 'verifying', 'markMediaAvailable');

  return {
    ...media,
    uploadState: 'available',
    verifiedContentType,
    verifiedByteSize,
    checksumSha256,
    revision: media.revision + 1,
    updatedAt: now,
  };
}

/** `verifying` -> `rejected`. Terminal: the diagram draws no outgoing edge from `rejected`, so no transition function here accepts a `rejected` source. */
export function markMediaRejected(media: MediaRecord, now: Date): MediaRecord {
  requireUploadState(media, 'verifying', 'markMediaRejected');

  return { ...media, uploadState: 'rejected', revision: media.revision + 1, updatedAt: now };
}

/**
 * Starts the orthogonal processing sub-state-machine: requires
 * `uploadState = 'available'` (the diagram's own branch point) and
 * `processingState = null` (not already processing, and not re-entrant —
 * no back-edge from `processing_failed` is modeled; see this file's own
 * header comment).
 */
export function beginMediaProcessing(media: MediaRecord, now: Date): MediaRecord {
  requireUploadState(media, 'available', 'beginMediaProcessing');
  requireProcessingState(media, null, 'beginMediaProcessing');

  return { ...media, processingState: 'processing', revision: media.revision + 1, updatedAt: now };
}

/** `processing` -> `processed`. Never touches `uploadState`. */
export function markMediaProcessed(media: MediaRecord, now: Date): MediaRecord {
  requireProcessingState(media, 'processing', 'markMediaProcessed');

  return {
    ...media,
    processingState: 'processed',
    revision: media.revision + 1,
    updatedAt: now,
  };
}

/** `processing` -> `processing_failed`. Never touches `uploadState`. */
export function markMediaProcessingFailed(media: MediaRecord, now: Date): MediaRecord {
  requireProcessingState(media, 'processing', 'markMediaProcessingFailed');

  return {
    ...media,
    processingState: 'processing_failed',
    revision: media.revision + 1,
    updatedAt: now,
  };
}

/**
 * `available` -> `deletion_scheduled`. Independent of `processingState`'s
 * current value by design — see this file's own header comment. Canceling
 * in-flight processing as part of deletion (section 16, step 3, "Cancel
 * eligible pending processing") is the deletion WORKFLOW's job
 * (`application/media-deletion-workflow.ts`, P6-RET-01), not this
 * transition's — this function stays a pure state edge.
 */
export function scheduleMediaDeletion(media: MediaRecord, now: Date): MediaRecord {
  requireUploadState(media, 'available', 'scheduleMediaDeletion');

  return {
    ...media,
    uploadState: 'deletion_scheduled',
    revision: media.revision + 1,
    updatedAt: now,
  };
}

/** The pre-`available` states a stale, never-completed upload can be orphan-reconciled from — see `scheduleStaleMediaUploadDeletion`. */
const STALE_UPLOAD_STATES: readonly MediaUploadState[] = [
  'registered',
  'authorized',
  'uploading',
  'verifying',
];

/**
 * Orphan reconciliation's own edge (P6-RET-01): any pre-`available` state
 * -> `deletion_scheduled`. Section 6's diagram draws `deletion_scheduled`
 * only below `available`, so this edge is an addition the diagram does not
 * draw — added deliberately, not silently, on two textual grounds the same
 * document states outright: section 15's "Orphan detection reconciles
 * objects without valid metadata and metadata without objects" (a
 * registration whose upload never completed IS metadata whose object never
 * validly arrived — though partial bytes may exist, which is exactly why
 * the reconciliation routes through the real deletion workflow rather than
 * flipping the row terminal in place), and section 17's "A failed
 * abandoned upload eventually releases reserved capacity" (the release
 * happens when the workflow confirms the bytes gone and marks the row
 * `deleted`). Only the retention sweep calls this, and only for records
 * older than the documented staleness window (`domain/media-retention.ts`)
 * — a client-facing command never reaches it.
 *
 * `rejected` is deliberately NOT included: it is a terminal state carrying
 * real evidence (this upload failed verification), and no document names a
 * retention duration for that evidence — see
 * `docs/development/deferred-capabilities.md` (P6-RET-01 entry).
 */
export function scheduleStaleMediaUploadDeletion(media: MediaRecord, now: Date): MediaRecord {
  if (!STALE_UPLOAD_STATES.includes(media.uploadState)) {
    throw new DomainRuleViolatedError(
      'media.media_record.upload_state_conflict',
      `scheduleStaleMediaUploadDeletion requires media '${media.id}' to be in a pre-available upload state, but it is '${media.uploadState}'.`,
    );
  }

  return {
    ...media,
    uploadState: 'deletion_scheduled',
    revision: media.revision + 1,
    updatedAt: now,
  };
}

/** `deletion_scheduled` -> `deleted`. Terminal. */
export function markMediaDeleted(media: MediaRecord, now: Date): MediaRecord {
  requireUploadState(media, 'deletion_scheduled', 'markMediaDeleted');

  return { ...media, uploadState: 'deleted', revision: media.revision + 1, updatedAt: now };
}
