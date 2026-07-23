/**
 * Registers a new media record in the `registered` upload state.
 *
 * Validates and normalizes its inputs through the domain constructor
 * `registerMediaRecord`, goes through the shared idempotency wrapper exactly
 * like gardens-mapping's `CreateGarden` and this module's own prior design,
 * and returns a view, never the raw domain entity, for the same
 * idempotency-replay reason `toGardenResource` documents.
 *
 * `RegisterMediaRecordInput` mirrors `plants-inventory/application/
 * add-plant.ts`'s `AddPlantInput` shape: an options object for the fields
 * beyond the actor and idempotency key, rather than a long positional
 * parameter list on `execute` itself.
 */

import type { IdempotencyStore } from '../../../platform/idempotency/idempotency-store.js';
import { generateUuidV7 } from '../../../shared/identifiers/uuid.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { Clock } from '../../../shared/time/clock.js';
import type { MediaClass } from '../domain/media-record.js';
import { registerMediaRecord } from '../domain/media-record.js';
import { toMediaRecordResource } from './media-record-view.js';
import type { MediaRecordResource } from './media-record-view.js';
import type { MediaUnitOfWork } from './media-unit-of-work.js';
import { runIdempotentCommand } from './run-idempotent-command.js';

const OPERATION = 'media.register';
const RESPONSE_STATUS_CODE = 201;

export interface RegisterMediaRecordInput {
  /** Nullable: see `domain/media-record.ts`'s own doc comment on `MediaRecord.gardenId` for why a media row may not yet belong to a garden. */
  readonly gardenId?: Uuid | null;
  readonly mediaClass: MediaClass;
  readonly displayFilename: string;
  readonly declaredContentType: string;
  readonly declaredByteSize: number;
  /** "when available" per architecture/media-storage-and-processing.md section 7, step 1 — omitted or `null` when the client has not computed one yet. */
  readonly checksumSha256?: string | null;
  readonly captureSessionId?: Uuid | null;
  /** Set together, only for internally registering a derivative (a future processing worker's use, not an ordinary client upload). */
  readonly derivedFromMediaId?: Uuid | null;
  readonly transformationVersion?: number | null;
}

export class RegisterMediaRecord {
  constructor(
    private readonly idempotency: IdempotencyStore,
    private readonly unitOfWork: MediaUnitOfWork,
    private readonly clock: Clock,
  ) {}

  async execute(
    profileId: Uuid,
    input: RegisterMediaRecordInput,
    idempotencyKey: string,
  ): Promise<MediaRecordResource> {
    const idempotencyInput = {
      actorProfileId: profileId,
      operation: OPERATION,
      idempotencyKey,
      requestFingerprint: JSON.stringify({ actorProfileId: profileId, input }),
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
          input.gardenId ?? null,
          profileId,
          input.mediaClass,
          input.displayFilename,
          input.declaredContentType,
          input.declaredByteSize,
          input.checksumSha256 ?? null,
          input.captureSessionId ?? null,
          input.derivedFromMediaId ?? null,
          input.transformationVersion ?? null,
          now,
        );

        await context.media.insert(record);

        return toMediaRecordResource(record);
      },
    );
  }
}
