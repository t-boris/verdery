/**
 * The shared media-deletion workflow steps (P6-RET-01) — architecture/
 * media-storage-and-processing.md section 16, implemented once and called
 * from every initiator: `DeleteGardenMedia` (a user deleting a photo),
 * `RunMediaRetentionSweep` (a passed retention deadline, or a stale
 * never-completed upload being orphan-reconciled), and
 * `RecordMediaProcessingResult` (re-emitting deletion to clean up bytes a
 * late derivative job wrote for an already-scheduled source).
 *
 * Section 16's steps map onto this codebase like so:
 *
 *  1. "Revoke new access"          — `deletion_scheduled` itself: every
 *     read path already gates on `available` (`GetMediaAccess`,
 *     `listDisplayDerivatives`), so the transition IS the revocation.
 *  2. "Mark media deletion scheduled" — `scheduleMediaDeletion` /
 *     `scheduleStaleMediaUploadDeletion`, revision-guarded.
 *  3. "Cancel eligible pending processing" — every `requested`/`queued`/
 *     `running` job for the media is marked `cancelled` in the same
 *     transaction. A Cloud Tasks task already dispatched cannot be
 *     recalled; its eventual result lands on a terminal job and
 *     `RecordMediaProcessingResult` treats it as a duplicate (plus the
 *     late-derivative cleanup re-emit — see that file).
 *  4./5. "Delete derivatives. Delete original and raw objects" — the
 *     `media.deletion_requested` outbox event, executed by the worker-side
 *     `media_deletion` job with the worker's own storage identity: the API
 *     never deletes objects itself, keeping every byte-touching operation
 *     in `services/workers` exactly as validation and derivative
 *     generation already are. Prefix-scoped — see
 *     `objectKeyPrefixForMedia`'s own doc comment.
 *  6. "Verify absence or record provider retry state" — the worker
 *     re-lists each prefix after deleting and only reports `succeeded` on
 *     zero remaining objects; a failed job stays internally visible as the
 *     job row while the record stays `deletion_scheduled` ("User-visible
 *     deletion remains pending until required objects are confirmed
 *     deleted").
 *  7. "Purge or minimize metadata" — not this workflow's own step: the row
 *     survives at `deleted` as audit evidence, and row purge belongs to the
 *     garden/account deletion workflows (data-export-and-deletion.md), which
 *     P8-DELETE-01 built. Those workflows delete the row only AFTER this
 *     workflow has confirmed the bytes absent — see
 *     `schedule-purge-media-deletion.ts`.
 *  8. "Emit completion" — the `media.deleted` audit event, recorded when
 *     absence is confirmed, plus the quota release (section 17's
 *     "released bytes", `releaseQuotaReservationForDeletedMedia`).
 *
 * ATTACH-VERSUS-DELETE LOCK ORDERING: the referenced-media check runs
 * AFTER the `deletion_scheduled` row update, inside the same transaction,
 * deliberately. Every attachment command reads the media record with
 * `getForShare` before inserting its reference row, so the two sides
 * serialize on the media row itself: if the attach commits first, this
 * workflow's UPDATE waits on the share lock and the subsequent reference
 * check sees the committed attachment (the whole deletion rolls back); if
 * this workflow's UPDATE commits first, the attach's `FOR SHARE` read
 * observes `deletion_scheduled` and rejects. Checking references BEFORE
 * the update would leave a window where both sides pass their checks and
 * an attachment ends up pointing at deleted media.
 *
 * A record that never reached Cloud Storage (`bucketName === null` — a
 * `registered` row whose upload session was never even authorized) skips
 * the worker round-trip entirely and completes in the same transaction:
 * there are no bytes whose absence a worker could verify more honestly
 * than the row itself already proves.
 */

import { MEDIA_DELETION_REQUESTED_EVENT_TYPE } from '@verdery/api-contracts';
import type {
  MediaDeletionObjectPrefix,
  MediaDeletionRequestedEventPayload,
} from '@verdery/api-contracts';
import type { AuditActorType } from '../../../platform/audit/audit-logger.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import {
  markMediaDeleted,
  scheduleMediaDeletion,
  scheduleStaleMediaUploadDeletion,
} from '../domain/media-lifecycle.js';
import type { MediaRecord } from '../domain/media-record.js';
import { markProcessingJobCancelled } from '../domain/processing-job.js';
import { releaseQuotaReservationForDeletedMedia } from '../domain/quota-reservation.js';
import { objectKeyPrefixForMedia } from './media-storage-target.js';
import type { MediaTransactionContext } from './media-unit-of-work.js';

/** The `outcomeCode` a job cancelled by this workflow carries — section 16 step 3's own reason, recorded rather than implied. */
export const MEDIA_DELETION_CANCELLED_OUTCOME_CODE = 'media_deletion_scheduled';

const DELETION_REQUESTED_AUDIT_EVENT_TYPE = 'media.deletion_requested';
const DELETED_AUDIT_EVENT_TYPE = 'media.deleted';

/** Who and why — carried into the audit trail, never into the storage-facing event payload. */
export interface MediaDeletionInitiator {
  readonly actorProfileId: Uuid | null;
  readonly actorType: AuditActorType;
  readonly reason:
    | 'user_request'
    | 'retention_deadline'
    | 'stale_upload'
    | 'derivative_cleanup'
    /** P8-DELETE-01: a garden or account purge past its recovery window. */
    | 'garden_purge'
    | 'account_purge';
}

/**
 * Every bucket/prefix pair the record's objects can live under: the
 * record's own bucket, plus the derived bucket its derivative objects were
 * written to — de-duplicated, since a `derived_preview`/`processing_output`
 * classed original's own bucket IS the derived bucket.
 */
export function deletionObjectPrefixes(
  record: MediaRecord,
  derivedBucketName: string,
): readonly MediaDeletionObjectPrefix[] {
  const prefix = objectKeyPrefixForMedia(record.id);
  const prefixes: MediaDeletionObjectPrefix[] = [];
  if (record.bucketName !== null) {
    prefixes.push({ bucketName: record.bucketName, objectKeyPrefix: prefix });
  }
  if (record.bucketName !== derivedBucketName) {
    prefixes.push({ bucketName: derivedBucketName, objectKeyPrefix: prefix });
  }
  return prefixes;
}

/** Appends the `media.deletion_requested` outbox event for `record` — shared by the scheduling path below and the late-derivative cleanup re-emit. */
export async function appendMediaDeletionRequestedEvent(
  context: MediaTransactionContext,
  record: MediaRecord,
  derivedBucketName: string,
): Promise<void> {
  const payload: MediaDeletionRequestedEventPayload = {
    mediaId: record.id,
    gardenId: record.gardenId,
    mediaClass: record.mediaClass,
    displayFilename: record.displayFilename,
    // Non-null on every path that reaches this append — see
    // `scheduleMediaDeletionWorkflow` below for the `bucketName === null`
    // short-circuit that never emits an event.
    bucketName: record.bucketName as string,
    objectKey: record.objectKey as string,
    contentType: record.verifiedContentType ?? record.declaredContentType,
    byteSize: record.verifiedByteSize ?? record.declaredByteSize,
    // Always null: a deletion job verifies ABSENCE, not content — see the
    // payload type's own doc comment.
    checksumSha256: null,
    objectPrefixes: deletionObjectPrefixes(record, derivedBucketName),
  };
  await context.outbox.append({
    eventType: MEDIA_DELETION_REQUESTED_EVENT_TYPE,
    aggregateType: 'media_record',
    aggregateId: record.id,
    payload,
  });
}

export type ScheduleMediaDeletionResult =
  | { readonly kind: 'scheduled'; readonly record: MediaRecord }
  /** No stored object existed, so the record completed to `deleted` in this same transaction. */
  | { readonly kind: 'deleted'; readonly record: MediaRecord }
  /** The revision-guarded update lost a race — the caller decides whether that is a stale-revision error (user command) or a skip (sweep). */
  | { readonly kind: 'lost_race' };

/**
 * Section 16 steps 1-5 in one transaction-scoped call. The caller has
 * already performed authorization, idempotency, and its own preconditions
 * (revision expectations, the derivative/original distinction) — this
 * function owns only the workflow itself. Throws `ConflictError` via the
 * caller when referenced — see `findReferenceKinds`' placement below.
 */
export async function scheduleMediaDeletionWorkflow(
  context: MediaTransactionContext,
  record: MediaRecord,
  derivedBucketName: string,
  initiator: MediaDeletionInitiator,
  now: Date,
): Promise<ScheduleMediaDeletionResult> {
  const scheduled =
    record.uploadState === 'available'
      ? scheduleMediaDeletion(record, now)
      : scheduleStaleMediaUploadDeletion(record, now);

  const applied = await context.media.update(scheduled, record.revision);
  if (!applied) {
    return { kind: 'lost_race' };
  }

  // Step 3: cancel eligible pending processing. A lost job-revision race
  // means the job reached a terminal state concurrently — its own callback
  // already ran or will land on the duplicate-delivery guard; nothing to
  // do here.
  const activeJobs = await context.processingJobs.listActiveForMedia(record.id);
  for (const job of activeJobs) {
    const cancelled = markProcessingJobCancelled(
      job,
      { outcomeCode: MEDIA_DELETION_CANCELLED_OUTCOME_CODE },
      now,
    );
    await context.processingJobs.updateState(cancelled, job.revision);
  }

  // Step 4's row half: every derivative row follows its source.
  await context.media.scheduleDerivativesForDeletion(record.id, now);

  await context.audit.record({
    eventType: DELETION_REQUESTED_AUDIT_EVENT_TYPE,
    subjectType: 'media',
    subjectId: record.id,
    actorProfileId: initiator.actorProfileId,
    actorType: initiator.actorType,
    details: { gardenId: record.gardenId, mediaClass: record.mediaClass, reason: initiator.reason },
  });

  if (scheduled.bucketName === null) {
    // No object was ever assigned, so no worker round-trip can verify more
    // than the row already proves — complete in place (see this file's own
    // header comment).
    const deleted = markMediaDeleted(scheduled, now);
    await context.media.update(deleted, scheduled.revision);
    await completeMediaDeletionResiduals(context, deleted, now);
    return { kind: 'deleted', record: deleted };
  }

  await appendMediaDeletionRequestedEvent(context, scheduled, derivedBucketName);
  return { kind: 'scheduled', record: scheduled };
}

/**
 * Section 16 steps 6-8's API half, applied when a `media_deletion` job
 * reports objects confirmed absent: `deletion_scheduled -> deleted`,
 * derivative rows to `deleted`, the quota reservation released (section
 * 17's "released bytes" — only now, once the bytes are genuinely gone),
 * and the `media.deleted` completion audit event. Idempotent under
 * duplicate delivery: an already-`deleted` record re-runs only the
 * residual steps (each itself idempotent) and never re-audits.
 */
export async function completeMediaDeletion(
  context: MediaTransactionContext,
  record: MediaRecord,
  now: Date,
): Promise<void> {
  if (record.uploadState === 'deleted') {
    // Duplicate completion — converge the residuals without a second
    // `media.deleted` audit event.
    await context.media.markScheduledDerivativesDeleted(record.id, now);
    await releaseReservation(context, record.id, now);
    return;
  }

  if (record.uploadState !== 'deletion_scheduled') {
    // Not in the deletion pipeline at all — a misdirected or very stale
    // callback; leave the record alone.
    return;
  }

  const deleted = markMediaDeleted(record, now);
  const applied = await context.media.update(deleted, record.revision);
  if (!applied) {
    // A concurrent completion won; its own call performs the residuals.
    return;
  }

  await completeMediaDeletionResiduals(context, deleted, now);
}

/**
 * The residual completion steps shared by the worker-confirmed path and
 * the no-object immediate path: derivative rows, quota release, and the
 * `media.deleted` completion audit event — always system-actored, since
 * completion is the workflow's own act (the initiating actor is already on
 * the `media.deletion_requested` audit event).
 */
async function completeMediaDeletionResiduals(
  context: MediaTransactionContext,
  deleted: MediaRecord,
  now: Date,
): Promise<void> {
  await context.media.markScheduledDerivativesDeleted(deleted.id, now);
  await releaseReservation(context, deleted.id, now);
  await context.audit.record({
    eventType: DELETED_AUDIT_EVENT_TYPE,
    subjectType: 'media',
    subjectId: deleted.id,
    actorProfileId: null,
    actorType: 'system',
    details: { gardenId: deleted.gardenId, mediaClass: deleted.mediaClass },
  });
}

async function releaseReservation(
  context: MediaTransactionContext,
  mediaId: Uuid,
  now: Date,
): Promise<void> {
  const reservation = await context.quotaReservations.findByMediaId(mediaId);
  if (reservation === null) {
    return;
  }
  const released = releaseQuotaReservationForDeletedMedia(reservation, now);
  if (released !== reservation) {
    await context.quotaReservations.updateState(released);
  }
}
