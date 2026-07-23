/**
 * The media record: identity, ownership, class, checksum, upload/processing
 * state, variants, relationships, and quota reservations for one stored (or
 * about-to-be-stored) file.
 *
 * P6-DATA-01 grows this from the deliberately minimal stand-in Phase 4 left
 * behind (`storageReference`/`mimeType` only, no state machine, immutable
 * after insert) into the real thing that module's own doc comment always
 * deferred. This is DATA MODEL AND DOMAIN LOGIC ONLY: no HTTP endpoint
 * reads or writes any of this yet, and nothing here touches Cloud Storage —
 * `bucketName`/`objectKey` exist as columns for a later stage
 * (P6-API-01/P6-PLAT-01) to populate through `authorizeMediaUpload`
 * (media-lifecycle.ts), not something this file creates itself.
 *
 * Mirrors `media.media_record` exactly, the same way `plants_inventory/
 * domain/plant.ts`'s `Plant` mirrors `plants_inventory.plant`. Upload and
 * processing transitions live in the sibling `media-lifecycle.ts`, the same
 * split `plant.ts`/`plant-lifecycle.ts` and `task.ts`/`task-lifecycle.ts`
 * already use.
 *
 * Source: migrations/1785100000000_media-lifecycle-and-quotas.sql;
 * architecture/media-storage-and-processing.md, sections "3. Media
 * Classes", "5. Media Record".
 */

import { SharedErrorCode } from '@verdery/api-contracts';
import { ValidationError } from '../../../platform/errors/application-error.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { MediaProcessingState, MediaUploadState } from './media-lifecycle.js';

/**
 * Matches architecture/media-storage-and-processing.md section 3's table
 * exactly. Section 5's own bullet reads "Media class and purpose," but no
 * document anywhere gives "purpose" a vocabulary distinct from class — see
 * the migration's own comment on this decision for the full reasoning.
 */
export type MediaClass =
  | 'garden_photo'
  | 'imported_plan'
  | 'raw_capture'
  | 'derived_preview'
  | 'processing_output'
  | 'export_package';

/**
 * No document names this vocabulary directly; derived from two concrete
 * textual signals in architecture/media-storage-and-processing.md: section
 * 12's two-way viewer-access line ("ordinary accepted photos ... but not
 * raw scan artifacts unless explicitly allowed") and section 11's "sensitive
 * documents" for plans. See `deriveDefaultSensitivityClassification` below
 * and the migration's own comment for the full mapping and reasoning.
 */
export type MediaSensitivityClassification = 'standard' | 'sensitive' | 'restricted';

export interface MediaRecord {
  readonly id: Uuid;
  /**
   * Nullable: a media row's registration can precede any garden
   * association — see the migration's own comment on this column for the
   * full reasoning (the upload flow's own registration step, and property-
   * plan-import onboarding, both plausibly precede a known garden).
   */
  readonly gardenId: Uuid | null;
  readonly uploadedByProfileId: Uuid;
  readonly mediaClass: MediaClass;
  /** User-facing name after `normalizeDisplayFilename` — never the opaque object key. */
  readonly displayFilename: string;
  readonly declaredContentType: string;
  /** Nullable until a future verifier populates it; not this stage's job. */
  readonly verifiedContentType: string | null;
  readonly declaredByteSize: number;
  /** Nullable until a future verifier populates it; not this stage's job. */
  readonly verifiedByteSize: number | null;
  /** SHA-256, lowercase hex. Nullable until computed — the client supplies it "when available" at registration, or a later verifier computes it. */
  readonly checksumSha256: string | null;
  /** Nullable until `authorizeMediaUpload` assigns a real Cloud Storage upload session's target — that assignment is a future stage's job, not this one's. */
  readonly bucketName: string | null;
  /** Paired with `bucketName`: always both null or both set. */
  readonly objectKey: string | null;
  readonly uploadState: MediaUploadState;
  /**
   * Orthogonal to `uploadState`, not a second half of the same state
   * machine — see media-lifecycle.ts's own header comment for why. Null
   * means "not started" (or, for a class that never needs processing, "not
   * applicable").
   */
  readonly processingState: MediaProcessingState | null;
  /**
   * Bare reference, no FK target yet: Garden Scan/AR capture sessions
   * (Phase 10) do not exist as a table anywhere in this codebase. The
   * "or observation" half of "Capture or observation relationships" needs
   * no column here — it is already satisfied by
   * `observations_history.observation_photo.media_id`, the other direction
   * of the same relationship.
   */
  readonly captureSessionId: Uuid | null;
  readonly sensitivityClassification: MediaSensitivityClassification;
  /**
   * Null at registration for every class — no concrete retention duration
   * exists anywhere in this repository's docs to compute one from yet (see
   * the migration's own comment). A future stage computes this once a real
   * event/duration exists to anchor it to.
   */
  readonly retentionDeadlineAt: Date | null;
  /** Set only on a derivative row — the original this row was produced from. */
  readonly derivedFromMediaId: Uuid | null;
  /** Meaningful only alongside `derivedFromMediaId`; enforced by `media_record_transformation_version_requires_derivative_check`. */
  readonly transformationVersion: number | null;
  /** Optimistic-concurrency counter — "Transitions are server-owned and revisioned" (section 6). Bumped by every domain transition, including registration itself (starts at 1). */
  readonly revision: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

const MAX_DISPLAY_FILENAME_LENGTH = 255;
// C0 control characters (code points 0-31) and DEL (code point 127), named
// by code point rather than embedded as raw bytes or backslash escapes in a
// regex literal, so this file's own source stays plain, diffable text.
const MAX_CONTROL_CHARACTER_CODE_POINT = 0x1f;
const DELETE_CODE_POINT = 0x7f;
const CHECKSUM_SHA256_PATTERN = /^[0-9a-f]{64}$/u;

const SENSITIVITY_CLASSIFICATION_BY_MEDIA_CLASS: Readonly<
  Record<MediaClass, MediaSensitivityClassification>
> = {
  garden_photo: 'standard',
  derived_preview: 'standard',
  imported_plan: 'sensitive',
  processing_output: 'sensitive',
  export_package: 'sensitive',
  raw_capture: 'restricted',
};

/**
 * Safe normalization for the user-facing display filename — architecture/
 * media-storage-and-processing.md section 4's own words: "the DISPLAY
 * filename can keep the user's name, but sanitize it against path
 * traversal/control characters/excessive length." Never used to build a
 * real filesystem or storage path — object keys are always opaque
 * `<shard>/<mediaUuid>/<objectUuid>` values (section 4), never derived from
 * this column — so this sanitizes purely against this string later being
 * misused as one, not because it is used as one today:
 *
 * 1. Strips any directory component: only the text after the last `/` or
 *    `\` (Windows-originated clients may send one) survives.
 * 2. Strips C0 control characters and DEL.
 * 3. Trims surrounding whitespace.
 * 4. Truncates to 255 characters (the longest filename POSIX and NTFS both
 *    accept for one path segment — a technical bound, not a product one).
 *
 * Throws only when nothing usable survives normalization — mirroring
 * `validateStorageReference`'s and `plant.ts`'s `validateDisplayName`'s
 * "blank after trimming is still blank" precedent.
 */
export function normalizeDisplayFilename(rawDisplayFilename: string): string {
  const lastSegment = rawDisplayFilename.split(/[/\\]/u).pop() ?? '';
  const withoutControlCharacters = Array.from(lastSegment)
    .filter((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint > MAX_CONTROL_CHARACTER_CODE_POINT && codePoint !== DELETE_CODE_POINT;
    })
    .join('');
  const truncated = withoutControlCharacters.trim().slice(0, MAX_DISPLAY_FILENAME_LENGTH).trim();

  if (truncated.length === 0) {
    throw new ValidationError(
      SharedErrorCode.RequestInvalid,
      'displayFilename must not be blank once normalized.',
      {
        details: [
          { code: 'media.media_record.display_filename.blank', pointer: '/displayFilename' },
        ],
      },
    );
  }

  return truncated;
}

/** Trims and validates the declared content type, the same shape of gap `validateStorageReference` closed for the retired `storageReference` column. */
export function validateDeclaredContentType(rawDeclaredContentType: string): string {
  const declaredContentType = rawDeclaredContentType.trim();

  if (declaredContentType.length === 0) {
    throw new ValidationError(
      SharedErrorCode.RequestInvalid,
      'declaredContentType must not be blank.',
      {
        details: [
          {
            code: 'media.media_record.declared_content_type.blank',
            pointer: '/declaredContentType',
          },
        ],
      },
    );
  }

  return declaredContentType;
}

/** Enforces the migration's `media_record_declared_byte_size_positive_check` invariant one level up, the same "clean ValidationError instead of a raw CHECK violation" precedent `validateQuantityForGroupingKind` sets. */
export function validateDeclaredByteSize(rawDeclaredByteSize: number): number {
  if (!Number.isInteger(rawDeclaredByteSize) || rawDeclaredByteSize <= 0) {
    throw new ValidationError(
      SharedErrorCode.RequestInvalid,
      'declaredByteSize must be a positive integer.',
      {
        details: [
          { code: 'media.media_record.declared_byte_size.invalid', pointer: '/declaredByteSize' },
        ],
      },
    );
  }

  return rawDeclaredByteSize;
}

/** Lowercases and trims a client-supplied checksum, when one was supplied ("when available" — section 7, step 1). Format is validated against `CHECKSUM_SHA256_PATTERN`, mirroring the migration's own `media_record_checksum_sha256_format_check`. */
export function normalizeChecksumSha256(rawChecksumSha256: string | null): string | null {
  if (rawChecksumSha256 === null) {
    return null;
  }

  const checksumSha256 = rawChecksumSha256.trim().toLowerCase();

  if (!CHECKSUM_SHA256_PATTERN.test(checksumSha256)) {
    throw new ValidationError(
      SharedErrorCode.RequestInvalid,
      'checksumSha256 must be 64 lowercase hexadecimal characters.',
      {
        details: [
          { code: 'media.media_record.checksum_sha256.invalid', pointer: '/checksumSha256' },
        ],
      },
    );
  }

  return checksumSha256;
}

/** Computed, never client-supplied — see `MediaSensitivityClassification`'s own doc comment for the mapping's textual grounding. */
export function deriveDefaultSensitivityClassification(
  mediaClass: MediaClass,
): MediaSensitivityClassification {
  return SENSITIVITY_CLASSIFICATION_BY_MEDIA_CLASS[mediaClass];
}

/** Mirrors the migration's `media_record_transformation_version_requires_derivative_check`: a transformation version is only meaningful on a derivative row. */
function validateTransformationVersion(
  derivedFromMediaId: Uuid | null,
  transformationVersion: number | null,
): number | null {
  if (transformationVersion !== null && derivedFromMediaId === null) {
    throw new ValidationError(
      SharedErrorCode.RequestInvalid,
      'transformationVersion requires derivedFromMediaId to be set.',
      {
        details: [
          {
            code: 'media.media_record.transformation_version.requires_derivative',
            pointer: '/transformationVersion',
          },
        ],
      },
    );
  }

  return transformationVersion;
}

/**
 * Registers a new media record in the `registered` state (section 6's
 * entry point). Serves both ordinary client uploads (P6-API-01's future
 * use, `derivedFromMediaId`/`transformationVersion` left `null`) and
 * internal derivative creation (a future processing worker's use, with
 * both set) through the one constructor — the same "one constructor, every
 * caller" shape `createPlant` already uses for plants-inventory.
 */
export function registerMediaRecord(
  id: Uuid,
  gardenId: Uuid | null,
  uploadedByProfileId: Uuid,
  mediaClass: MediaClass,
  rawDisplayFilename: string,
  rawDeclaredContentType: string,
  rawDeclaredByteSize: number,
  rawChecksumSha256: string | null,
  captureSessionId: Uuid | null,
  derivedFromMediaId: Uuid | null,
  transformationVersion: number | null,
  now: Date,
): MediaRecord {
  return {
    id,
    gardenId,
    uploadedByProfileId,
    mediaClass,
    displayFilename: normalizeDisplayFilename(rawDisplayFilename),
    declaredContentType: validateDeclaredContentType(rawDeclaredContentType),
    verifiedContentType: null,
    declaredByteSize: validateDeclaredByteSize(rawDeclaredByteSize),
    verifiedByteSize: null,
    checksumSha256: normalizeChecksumSha256(rawChecksumSha256),
    bucketName: null,
    objectKey: null,
    uploadState: 'registered',
    processingState: null,
    captureSessionId,
    sensitivityClassification: deriveDefaultSensitivityClassification(mediaClass),
    retentionDeadlineAt: null,
    derivedFromMediaId,
    transformationVersion: validateTransformationVersion(derivedFromMediaId, transformationVersion),
    revision: 1,
    createdAt: now,
    updatedAt: now,
  };
}
