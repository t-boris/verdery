/**
 * Typed errors this module's P6-API-01 commands/queries raise, and the
 * dotted codes that identify them.
 *
 * Unlike `plants-inventory/application/plant-errors.ts` (module-local codes,
 * because that module's own contract landed after its commands), `Media`
 * already has a landed OpenAPI contract as of this same work package, so
 * these codes live in `@verdery/api-contracts`'s `MediaErrorCode` — the same
 * "contract owns the codes" precedent `GardenErrorCode`/`MapErrorCode`
 * already set. This file only holds the small set of constructor functions,
 * mirroring `plant-errors.ts`'s own file shape.
 */

import { MediaErrorCode } from '@verdery/api-contracts';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  StaleRevisionError,
} from '../../../platform/errors/application-error.js';

export function mediaNotFoundError(): NotFoundError {
  return new NotFoundError(MediaErrorCode.NotFound, 'Media not found.');
}

export function mediaStaleRevisionError(currentRevision: number): StaleRevisionError {
  return new StaleRevisionError(
    MediaErrorCode.StaleRevision,
    'The media record changed before this command was applied.',
    { details: [{ code: 'media.revision', parameters: { currentRevision } }] },
  );
}

/** Raised by `CompleteMediaUpload` before it ever calls a raw domain lifecycle transition, so a client never sees `media-lifecycle.ts`'s own internal `media.media_record.upload_state_conflict` code. */
export function mediaUploadStateConflictError(currentUploadState: string): ConflictError {
  return new ConflictError(
    MediaErrorCode.UploadStateConflict,
    `Media cannot be verified from its current upload state ('${currentUploadState}').`,
    { details: [{ code: 'media.upload_state', parameters: { currentUploadState } }] },
  );
}

export function mediaNotAvailableError(): ConflictError {
  return new ConflictError(
    MediaErrorCode.NotAvailable,
    'This media record has not reached the available upload state yet.',
  );
}

/** Section 12: the operational viewer role may access ordinary accepted photos but not `restricted`-classified media unless explicitly allowed — no such override mechanism exists in this codebase's role model yet. */
export function mediaViewerAccessRestrictedError(): ForbiddenError {
  return new ForbiddenError(
    MediaErrorCode.ViewerAccessRestricted,
    'The viewer role cannot access this media.',
  );
}
