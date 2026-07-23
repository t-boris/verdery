/**
 * Registers a new immutable media record.
 *
 * The only command this module has this pass — see the module's `public.ts`
 * doc comment for why. Validates and trims its inputs through the domain
 * constructor `registerMediaRecord`, goes through the shared idempotency
 * wrapper exactly like gardens-mapping's `CreateGarden`, and returns a view,
 * never the raw domain entity, for the same idempotency-replay reason
 * `toGardenResource` documents.
 */

import type { IdempotencyStore } from '../../../platform/idempotency/idempotency-store.js';
import { generateUuidV7 } from '../../../shared/identifiers/uuid.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { Clock } from '../../../shared/time/clock.js';
import { registerMediaRecord } from '../domain/media-record.js';
import { toMediaRecordResource } from './media-record-view.js';
import type { MediaRecordResource } from './media-record-view.js';
import type { MediaUnitOfWork } from './media-unit-of-work.js';
import { runIdempotentCommand } from './run-idempotent-command.js';

const OPERATION = 'media.register';
const RESPONSE_STATUS_CODE = 201;

export class RegisterMediaRecord {
  constructor(
    private readonly idempotency: IdempotencyStore,
    private readonly unitOfWork: MediaUnitOfWork,
    private readonly clock: Clock,
  ) {}

  async execute(
    profileId: Uuid,
    rawStorageReference: string,
    rawMimeType: string,
    idempotencyKey: string,
  ): Promise<MediaRecordResource> {
    const input = {
      actorProfileId: profileId,
      operation: OPERATION,
      idempotencyKey,
      requestFingerprint: JSON.stringify({
        storageReference: rawStorageReference,
        mimeType: rawMimeType,
      }),
    };

    return runIdempotentCommand(
      this.idempotency,
      this.unitOfWork,
      input,
      RESPONSE_STATUS_CODE,
      async (context) => {
        const now = this.clock.now();
        const record = registerMediaRecord(
          generateUuidV7(),
          rawStorageReference,
          rawMimeType,
          profileId,
          now,
        );

        await context.media.insert(record);

        return toMediaRecordResource(record);
      },
    );
  }
}
