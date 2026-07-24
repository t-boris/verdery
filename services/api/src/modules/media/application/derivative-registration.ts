/**
 * Registers one produced derivative output object as its own new
 * `media.media_record` row, or finds the already-registered one for an
 * identical regeneration — the concrete mechanism behind "regenerating the
 * exact same derivative for the exact same source checksum and
 * transformation-version pins must be a safe no-op" (this work package's own
 * completion evidence: "Checksum/version reproducibility tests").
 *
 * Two layers of the same guarantee, deliberately redundant:
 *
 * 1. Application layer (`findDerivative` before `insert`): the common,
 *    fast path — no wasted UUID generation or insert attempt for a plain,
 *    sequential regeneration (an operator re-running the same
 *    derivative-generation job, or a duplicate outbox delivery reaching a
 *    second job for the same source+version).
 * 2. Database layer (the two partial unique indexes migrations/
 *    1785300000000_media-derivative-identity.sql adds): the ULTIMATE
 *    guarantee under a real concurrent race this in-process check-then-
 *    insert cannot close on its own — mirrors `run-idempotent-command.ts`'s
 *    own "catch `isUniqueViolation`, treat as the expected outcome, not an
 *    error" precedent.
 *
 * Lives in its own file, not inlined into `record-media-processing-result.ts`,
 * the same "one focused file per concern" split that module's own
 * domain/application boundary already follows.
 *
 * Source: implementation-plan.md work package P6-WORKER-02;
 * architecture/media-storage-and-processing.md, section "9. Image Derivatives"
 * ("Derivative generation is idempotent and addressed by source checksum
 * plus transformation version.").
 */

import type { MediaDerivativeKind, MediaProcessingOutputObject } from '@verdery/api-contracts';
import { isUniqueViolation } from '../../../platform/database/postgres-errors.js';
import { generateUuidV7 } from '../../../shared/identifiers/uuid.js';
import type { TileCoordinates } from '../domain/media-record.js';
import { registerDerivativeMediaRecord } from '../domain/media-record.js';
import type { MediaRecord } from '../domain/media-record.js';
import type { MediaTransactionContext } from './media-unit-of-work.js';

const DERIVATIVE_KINDS: ReadonlySet<string> = new Set([
  'thumbnail',
  'screen_preview',
  'high_resolution',
  'tile',
]);

export interface ParsedDerivativeOutput {
  readonly bucketName: string;
  readonly objectKey: string;
  readonly checksumSha256: string;
  readonly contentType: string;
  readonly byteSize: number;
  readonly derivativeKind: MediaDerivativeKind;
  readonly transformationVersion: number;
  readonly tile: TileCoordinates | null;
}

/**
 * Validates a wire `MediaProcessingOutputObject` carries every field its own
 * `derivativeKind` requires (see that interface's own doc comment in
 * `@verdery/api-contracts` for why these fields are optional on the wire
 * type at all — a `media_validation` job's own `outputObjects` never
 * populates them). Returns `null` for a malformed entry rather than
 * throwing: one bad output object in an otherwise-valid result should not
 * fail the whole callback and leave every other real derivative
 * unregistered.
 */
export function parseDerivativeOutput(
  output: MediaProcessingOutputObject,
): ParsedDerivativeOutput | null {
  if (
    output.contentType === undefined ||
    output.byteSize === undefined ||
    output.derivativeKind === undefined ||
    output.transformationVersion === undefined ||
    !DERIVATIVE_KINDS.has(output.derivativeKind)
  ) {
    return null;
  }

  const isTile = output.derivativeKind === 'tile';
  if (isTile !== (output.tile !== undefined)) {
    return null;
  }

  return {
    bucketName: output.bucketName,
    objectKey: output.objectKey,
    checksumSha256: output.checksumSha256,
    contentType: output.contentType,
    byteSize: output.byteSize,
    derivativeKind: output.derivativeKind,
    transformationVersion: output.transformationVersion,
    tile: output.tile ?? null,
  };
}

/**
 * Registers `output` as a new `media_record` row derived from `source`, or
 * returns the already-registered row for the identical identity — see this
 * file's own header comment for the two-layer idempotency guarantee.
 */
export async function registerDerivativeIfAbsent(
  context: MediaTransactionContext,
  source: MediaRecord,
  output: ParsedDerivativeOutput,
  now: Date,
): Promise<MediaRecord> {
  const identity = {
    derivedFromMediaId: source.id,
    transformationVersion: output.transformationVersion,
    derivativeKind: output.derivativeKind,
    tile: output.tile,
  };

  const existing = await context.media.findDerivative(identity);
  if (existing !== null) {
    return existing;
  }

  const record = registerDerivativeMediaRecord(
    generateUuidV7(),
    {
      gardenId: source.gardenId,
      uploadedByProfileId: source.uploadedByProfileId,
      displayFilename: source.displayFilename,
      contentType: output.contentType,
      byteSize: output.byteSize,
      checksumSha256: output.checksumSha256,
      bucketName: output.bucketName,
      objectKey: output.objectKey,
      derivedFromMediaId: source.id,
      transformationVersion: output.transformationVersion,
      derivativeKind: output.derivativeKind,
      tile: output.tile,
    },
    now,
  );

  try {
    await context.media.insert(record);
    return record;
  } catch (error) {
    if (!isUniqueViolation(error)) {
      throw error;
    }
    // Lost a race against a concurrent identical regeneration — the
    // database's own partial unique index is what actually stopped the
    // duplicate; re-read the row it already accepted.
    const raced = await context.media.findDerivative(identity);
    if (raced === null) {
      throw error;
    }
    return raced;
  }
}
