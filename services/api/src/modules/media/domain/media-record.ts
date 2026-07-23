/**
 * The media record: an immutable pointer to a stored file.
 *
 * Deliberately minimal — not the future Media module (architecture/
 * backend-modular-monolith.md, section "6.6 Media"), only the stable FK
 * target Phase 4's plant, observation, and task photo attachments need.
 * Nothing here models upload authorization, verification, derivatives,
 * processing state, or retention state; that remains the future module's
 * job. `storageReference` is an opaque pointer only — what it actually
 * resolves to is that future module's concern, not this one's.
 *
 * No update function: `media.media_record`'s own migration comment says "No
 * UPDATE path: every row is immutable after insert in this minimal slice."
 *
 * Source: migrations/1784900000000_plants-observations-tasks-baseline.sql,
 * `media.media_record`.
 */

import { SharedErrorCode } from '@verdery/api-contracts';
import { ValidationError } from '../../../platform/errors/application-error.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';

export interface MediaRecord {
  readonly id: Uuid;
  readonly storageReference: string;
  readonly mimeType: string;
  readonly uploadedByProfileId: Uuid;
  readonly createdAt: Date;
}

/**
 * Trims and validates the opaque storage pointer.
 *
 * `storage_reference` carries only a `NOT NULL` constraint in the migration,
 * no `CHECK` — a string of only spaces would satisfy that while still being
 * useless. This is what turns that case into a clean `ValidationError`
 * instead of a row nothing can ever resolve, matching how
 * `gardens-mapping/domain/garden.ts`'s `validateGardenName` handles the same
 * shape of gap for `garden.name`.
 */
export function validateStorageReference(rawStorageReference: string): string {
  const storageReference = rawStorageReference.trim();

  if (storageReference.length === 0) {
    throw new ValidationError(
      SharedErrorCode.RequestInvalid,
      'storageReference must not be blank.',
      { details: [{ code: 'media.storage_reference.blank', pointer: '/storageReference' }] },
    );
  }

  return storageReference;
}

/** Trims and validates the declared MIME type, for the same reason as `validateStorageReference` above. */
export function validateMimeType(rawMimeType: string): string {
  const mimeType = rawMimeType.trim();

  if (mimeType.length === 0) {
    throw new ValidationError(SharedErrorCode.RequestInvalid, 'mimeType must not be blank.', {
      details: [{ code: 'media.mime_type.blank', pointer: '/mimeType' }],
    });
  }

  return mimeType;
}

export function registerMediaRecord(
  id: Uuid,
  rawStorageReference: string,
  rawMimeType: string,
  uploadedByProfileId: Uuid,
  now: Date,
): MediaRecord {
  return {
    id,
    storageReference: validateStorageReference(rawStorageReference),
    mimeType: validateMimeType(rawMimeType),
    uploadedByProfileId,
    createdAt: now,
  };
}
