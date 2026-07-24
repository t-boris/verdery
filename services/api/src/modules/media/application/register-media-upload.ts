/**
 * Registers a garden-scoped media upload and opens its backend-authorized
 * resumable Cloud Storage upload session in one command — architecture/
 * media-storage-and-processing.md section 7 ("Upload Flow") steps 2 and 3
 * together, per this contract endpoint's own doc comment in `openapi.yaml`
 * on why those two steps are not split across two endpoints.
 *
 * Authorization runs before the transaction (mirrors every gardens-mapping-
 * dependent command's own placement): `editGardenContent` — this capability's
 * own doc comment names media by name ("Add and change garden content —
 * media, observations, tasks, map"). Inside the transaction: register the
 * media record (`registered`), reserve quota for its declared byte size
 * (bookkeeping only — no numeric limit is enforced, matching
 * `domain/quota-reservation.ts`'s own posture), select the destination
 * bucket and generate an opaque object key, create the resumable upload
 * session through `MediaStorageGateway`, then advance the record to
 * `authorized` recording that session's target.
 *
 * The storage-gateway call runs inside the same database transaction as
 * every other write here, exactly like every other command in this
 * codebase's own "one `work` callback, one transaction, one idempotency
 * save" shape (`CreateGarden`, `AttachPlantPhoto`, `RegisterMediaRecord`).
 * This is a deliberate, documented tradeoff, not an oversight: it holds a
 * Postgres transaction open across one outbound network call to Cloud
 * Storage, but the alternative — splitting registration into two
 * transactions with the external call between them — has no established
 * precedent anywhere in this codebase and would need its own new idempotency
 * design (a retry after the external call fails would otherwise re-insert a
 * second media row and a second quota reservation, since nothing durable
 * would mark the first attempt "registered, awaiting a session"). Staying
 * consistent with the established one-transaction shape keeps this command's
 * failure mode simple and correct: any failure, including a Cloud Storage
 * failure, rolls back the whole attempt, and a client retry with the same
 * idempotency key starts clean.
 */

import { SharedErrorCode } from '@verdery/api-contracts';
import type { MediaUploadSession } from '@verdery/api-contracts';
import {
  DependencyUnavailableError,
  InternalError,
} from '../../../platform/errors/application-error.js';
import type { IdempotencyStore } from '../../../platform/idempotency/idempotency-store.js';
import { generateUuidV7 } from '../../../shared/identifiers/uuid.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { Clock } from '../../../shared/time/clock.js';
import type { GardenAuthorization } from '../../gardens-mapping/public.js';
import { authorizeMediaUpload } from '../domain/media-lifecycle.js';
import type { MediaClass } from '../domain/media-record.js';
import { registerMediaRecord } from '../domain/media-record.js';
import { reserveMediaQuota } from '../domain/quota-reservation.js';
import type { MediaStorageBucketNames } from './media-storage-target.js';
import { generateObjectKey, selectBucketName } from './media-storage-target.js';
import type { MediaStorageGateway } from './media-storage-gateway.js';
import { toMediaUploadSessionResource } from './media-view.js';
import type { MediaUnitOfWork } from './media-unit-of-work.js';
import { runIdempotentCommand } from './run-idempotent-command.js';

const OPERATION = 'media.registerUpload';
const RESPONSE_STATUS_CODE = 201;

export interface RegisterMediaUploadInput {
  readonly mediaClass: MediaClass;
  readonly displayFilename: string;
  readonly declaredContentType: string;
  readonly declaredByteSize: number;
  /** "when available" per section 7, step 1 — omitted or `null` when the client has not computed one yet. */
  readonly checksumSha256?: string | null;
}

export class RegisterMediaUpload {
  constructor(
    private readonly idempotency: IdempotencyStore,
    private readonly unitOfWork: MediaUnitOfWork,
    private readonly authorization: GardenAuthorization,
    private readonly storage: MediaStorageGateway,
    private readonly buckets: MediaStorageBucketNames,
    private readonly clock: Clock,
  ) {}

  async execute(
    gardenId: Uuid,
    profileId: Uuid,
    input: RegisterMediaUploadInput,
    idempotencyKey: string,
  ): Promise<MediaUploadSession> {
    await this.authorization.requireCapability(gardenId, profileId, 'editGardenContent');

    const idempotencyInput = {
      actorProfileId: profileId,
      operation: OPERATION,
      idempotencyKey,
      requestFingerprint: JSON.stringify({ gardenId, input }),
    };

    return runIdempotentCommand(
      this.idempotency,
      this.unitOfWork,
      idempotencyInput,
      RESPONSE_STATUS_CODE,
      async (context) => {
        const now = this.clock.now();

        const record = registerMediaRecord(
          generateUuidV7(),
          gardenId,
          profileId,
          input.mediaClass,
          input.displayFilename,
          input.declaredContentType,
          input.declaredByteSize,
          input.checksumSha256 ?? null,
          null,
          null,
          null,
          now,
        );
        await context.media.insert(record);

        const reservation = reserveMediaQuota(
          generateUuidV7(),
          'garden',
          gardenId,
          null,
          record.id,
          record.declaredByteSize,
          now,
        );
        await context.quotaReservations.insert(reservation);

        const bucketName = selectBucketName(record.mediaClass, this.buckets);
        const objectKey = generateObjectKey(record.id);

        let session;
        try {
          session = await this.storage.createResumableUploadSession(
            { bucketName, objectKey },
            record.declaredContentType,
            now,
          );
        } catch (error) {
          if (error instanceof DependencyUnavailableError) {
            throw error;
          }
          throw new DependencyUnavailableError(
            SharedErrorCode.DependencyUnavailable,
            'Cloud Storage is temporarily unable to create an upload session.',
            { cause: error },
          );
        }

        const authorized = authorizeMediaUpload(record, bucketName, objectKey, now);
        const applied = await context.media.update(authorized, record.revision);
        if (!applied) {
          // Unreachable in practice: `record` was inserted by this same
          // transaction moments ago under a freshly generated id, so no
          // concurrent writer can have raced its revision. Failing loudly
          // here is cheaper than silently returning a resource that does not
          // match what was actually persisted.
          throw new InternalError(
            SharedErrorCode.Internal,
            'Failed to persist the authorized upload session.',
          );
        }

        return toMediaUploadSessionResource(authorized, session);
      },
    );
  }
}
