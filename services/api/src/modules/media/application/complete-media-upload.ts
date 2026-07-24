/**
 * Explicit, client-triggered completion verification — architecture/
 * media-storage-and-processing.md section 7 ("Upload Flow") steps 5-7, the
 * synchronous path only (no event-driven/Pub/Sub trigger for step 5 itself
 * — "Completion event or explicit client call triggers verification" —
 * exists yet; only the explicit client call does).
 *
 * Drives the record through the remainder of section 6's state machine in
 * one call: `authorized` -> `uploading` -> `verifying`, reads real object
 * metadata from `MediaStorageGateway`, and resolves to `available` (exact
 * declared/actual content-type and byte-size match) or `rejected`
 * (mismatch, or the object does not exist yet — no retry edge is modeled
 * from `verifying`, matching section 6's diagram literally). Commits the
 * quota reservation on success, releases it on rejection — mirrors
 * `domain/quota-reservation.ts`'s own idempotent release/non-idempotent
 * commit contract exactly.
 *
 * Full content-hash verification is not performed here — see
 * `domain/media-lifecycle.ts`'s own updated comment on `markMediaAvailable`
 * for why; that is P6-WORKER-01's job.
 *
 * Idempotent under a duplicate completion notification (section 20): a
 * record already `available` or already `rejected` short-circuits to
 * returning its current state, never re-verifying or erroring — and never
 * re-appending the outbox event below, since the `available` branch that
 * appends it is only reached once, on the one call that actually performs
 * the transition.
 *
 * The outbox event starts P6-WORKER-01's deeper byte validation after the
 * cheap synchronous Cloud Storage metadata check succeeds. Signed access is
 * withheld until that job succeeds. Derivative generation remains a
 * separate P6-WORKER-02 job.
 */

import { MEDIA_PROCESSING_REQUESTED_EVENT_TYPE, type Media } from '@verdery/api-contracts';
import type { MediaProcessingRequestedEventPayload } from '@verdery/api-contracts';
import type { IdempotencyStore } from '../../../platform/idempotency/idempotency-store.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { Clock } from '../../../shared/time/clock.js';
import type { GardenAuthorization } from '../../gardens-mapping/public.js';
import {
  beginMediaUpload,
  beginMediaVerification,
  markMediaAvailable,
  markMediaRejected,
} from '../domain/media-lifecycle.js';
import type { MediaRecord } from '../domain/media-record.js';
import { commitQuotaReservation, releaseQuotaReservation } from '../domain/quota-reservation.js';
import {
  mediaNotFoundError,
  mediaStaleRevisionError,
  mediaUploadStateConflictError,
} from './media-errors.js';
import type { MediaObjectMetadata, MediaStorageGateway } from './media-storage-gateway.js';
import { toMediaResource } from './media-view.js';
import type { MediaUnitOfWork } from './media-unit-of-work.js';
import { runIdempotentCommand } from './run-idempotent-command.js';

const OPERATION = 'media.completeUpload';
const RESPONSE_STATUS_CODE = 200;

/** `true` when real object metadata matches what was declared at registration — the only path to `available`. */
function matchesDeclared(record: MediaRecord, metadata: MediaObjectMetadata | null): boolean {
  return (
    metadata !== null &&
    metadata.contentType === record.declaredContentType &&
    metadata.sizeBytes === record.declaredByteSize
  );
}

export class CompleteMediaUpload {
  constructor(
    private readonly idempotency: IdempotencyStore,
    private readonly unitOfWork: MediaUnitOfWork,
    private readonly authorization: GardenAuthorization,
    private readonly storage: MediaStorageGateway,
    private readonly clock: Clock,
  ) {}

  async execute(
    gardenId: Uuid,
    mediaId: Uuid,
    profileId: Uuid,
    expectedRevision: number,
    idempotencyKey: string,
  ): Promise<Media> {
    await this.authorization.requireCapability(gardenId, profileId, 'editGardenContent');

    const idempotencyInput = {
      actorProfileId: profileId,
      operation: OPERATION,
      idempotencyKey,
      requestFingerprint: JSON.stringify({ gardenId, mediaId, expectedRevision }),
    };

    return runIdempotentCommand(
      this.idempotency,
      this.unitOfWork,
      idempotencyInput,
      RESPONSE_STATUS_CODE,
      async (context) => {
        const record = await context.media.get(mediaId);
        if (record === null || record.gardenId !== gardenId) {
          throw mediaNotFoundError();
        }

        // Duplicate completion notification (section 20): a terminal
        // outcome already reached is replayed, not re-verified or rejected
        // as a state conflict.
        if (record.uploadState === 'available' || record.uploadState === 'rejected') {
          return toMediaResource(record);
        }

        if (record.uploadState !== 'authorized') {
          throw mediaUploadStateConflictError(record.uploadState);
        }
        if (record.revision !== expectedRevision) {
          throw mediaStaleRevisionError(record.revision);
        }

        const now = this.clock.now();
        const uploading = beginMediaUpload(record, now);
        const verifying = beginMediaVerification(uploading, now);

        // `bucketName`/`objectKey` are always both set once `uploadState`
        // reached `authorized` — `authorizeMediaUpload` sets them together,
        // and `media_record_storage_target_pairing_check` enforces the pair
        // at the database level.
        const metadata = await this.storage.getObjectMetadata({
          bucketName: verifying.bucketName as string,
          objectKey: verifying.objectKey as string,
        });

        const accepted = matchesDeclared(verifying, metadata);
        const resolved = accepted
          ? markMediaAvailable(
              verifying,
              // Non-null here: `accepted` is only true when `metadata` is non-null.
              (metadata as MediaObjectMetadata).contentType,
              (metadata as MediaObjectMetadata).sizeBytes,
              verifying.checksumSha256,
              now,
            )
          : markMediaRejected(verifying, now);

        const applied = await context.media.update(resolved, record.revision);
        if (!applied) {
          throw mediaStaleRevisionError(record.revision);
        }

        if (accepted) {
          // Section 7 step 7: "API marks media available and emits
          // processing events" — this first event requests constrained byte
          // validation. `bucketName`/`objectKey` are non-null here
          // for the same reason the metadata read above already relies on:
          // both are always set once `uploadState` reached `authorized`.
          const payload: MediaProcessingRequestedEventPayload = {
            mediaId: resolved.id,
            gardenId: resolved.gardenId,
            mediaClass: resolved.mediaClass,
            displayFilename: resolved.displayFilename,
            bucketName: resolved.bucketName as string,
            objectKey: resolved.objectKey as string,
            contentType: resolved.verifiedContentType as string,
            byteSize: resolved.verifiedByteSize as number,
            checksumSha256: resolved.checksumSha256,
          };
          await context.outbox.append({
            eventType: MEDIA_PROCESSING_REQUESTED_EVENT_TYPE,
            aggregateType: 'media_record',
            aggregateId: resolved.id,
            payload,
          });
        }

        const reservation = await context.quotaReservations.findByMediaId(mediaId);
        if (reservation !== null) {
          const updatedReservation = accepted
            ? commitQuotaReservation(reservation, now)
            : releaseQuotaReservation(reservation, now);
          await context.quotaReservations.updateState(updatedReservation);
        }

        return toMediaResource(resolved);
      },
    );
  }
}
