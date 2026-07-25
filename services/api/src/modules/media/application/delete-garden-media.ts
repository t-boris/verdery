/**
 * `DeleteGardenMedia` (P6-RET-01): the user-facing entry into section 16's
 * deletion workflow — a garden photo's uploader, or any member who can
 * edit garden content, removing a media record and (asynchronously) its
 * stored bytes.
 *
 * Command-shape decisions, each grounded rather than invented:
 *
 * - **Authorization: `editGardenContent`** — the exact capability that
 *   registered the upload (`RegisterMediaUpload`); deleting a photo is
 *   editing garden content the same way attaching one is. No
 *   uploader-only restriction: garden content belongs to the garden, not
 *   the uploader (the same posture every other content command — task
 *   delete, map object delete — already takes), and the audit event
 *   records who acted.
 * - **Only from `available`** — the one state section 6's diagram draws
 *   the `deletion_scheduled` edge from. A pre-`available` record is the
 *   retention sweep's orphan-reconciliation concern, not a user command's;
 *   a `rejected` record's evidence retention is deliberately deferred
 *   (see `docs/development/deferred-capabilities.md`).
 * - **Replay-idempotent like `CompleteMediaUpload`**: an already
 *   `deletion_scheduled`/`deleted` record returns its current state
 *   without a second workflow, never an error — deletion is asynchronous,
 *   so a client retry legitimately observes the intermediate state.
 * - **Originals only** — a derivative row is deleted with its source
 *   (`media.derivative_not_deletable`).
 * - **The referenced-media guard runs AFTER the state update** — see
 *   `media-deletion-workflow.ts`'s lock-ordering comment; the thrown
 *   `ConflictError` rolls the whole transaction back, leaving the record
 *   `available` and untouched.
 */

import type { Media } from '@verdery/api-contracts';
import type { IdempotencyStore } from '../../../platform/idempotency/idempotency-store.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { Clock } from '../../../shared/time/clock.js';
import type { GardenAuthorization } from '../../gardens-mapping/public.js';
import { scheduleMediaDeletionWorkflow } from './media-deletion-workflow.js';
import {
  mediaDerivativeNotDeletableError,
  mediaNotFoundError,
  mediaReferencedError,
  mediaStaleRevisionError,
  mediaUploadStateConflictError,
} from './media-errors.js';
import type { MediaStorageBucketNames } from './media-storage-target.js';
import { toMediaResource } from './media-view.js';
import type { MediaUnitOfWork } from './media-unit-of-work.js';
import { runIdempotentCommand } from './run-idempotent-command.js';

const OPERATION = 'media.delete';
const RESPONSE_STATUS_CODE = 200;

export class DeleteGardenMedia {
  constructor(
    private readonly idempotency: IdempotencyStore,
    private readonly unitOfWork: MediaUnitOfWork,
    private readonly authorization: GardenAuthorization,
    private readonly buckets: MediaStorageBucketNames,
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
        if (record.derivedFromMediaId !== null) {
          throw mediaDerivativeNotDeletableError();
        }

        // Replay of an already-started (or already-finished) deletion —
        // mirror CompleteMediaUpload's duplicate-notification posture.
        if (record.uploadState === 'deletion_scheduled' || record.uploadState === 'deleted') {
          return toMediaResource(record);
        }

        if (record.uploadState !== 'available') {
          throw mediaUploadStateConflictError(record.uploadState);
        }
        if (record.revision !== expectedRevision) {
          throw mediaStaleRevisionError(record.revision);
        }

        const now = this.clock.now();
        const outcome = await scheduleMediaDeletionWorkflow(
          context,
          record,
          this.buckets.derived,
          { actorProfileId: profileId, actorType: 'user', reason: 'user_request' },
          now,
        );
        if (outcome.kind === 'lost_race') {
          throw mediaStaleRevisionError(record.revision);
        }

        // AFTER the row update, per the workflow's lock-ordering contract:
        // a referenced record rolls the whole transaction back.
        const referenceKinds = await context.references.findReferenceKinds(mediaId);
        if (referenceKinds.length > 0) {
          throw mediaReferencedError(referenceKinds);
        }

        return toMediaResource(outcome.record);
      },
    );
  }
}
