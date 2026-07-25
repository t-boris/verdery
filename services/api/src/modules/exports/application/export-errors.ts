/**
 * Contract-level errors the exports module raises (P8-EXPORT-01) — the
 * `media-errors.ts` shape: one constructor per `ExportErrorCode`, so the
 * transport layer only ever sees clean contract codes.
 */

import { ExportErrorCode } from '@verdery/api-contracts';
import { ConflictError, NotFoundError } from '../../../platform/errors/application-error.js';

/** Unknown id and someone else's id are indistinguishable — the concealment posture. */
export function exportNotFoundError(): NotFoundError {
  return new NotFoundError(ExportErrorCode.NotFound, 'Export request not found.');
}

export function activeExportExistsError(): ConflictError {
  return new ConflictError(
    ExportErrorCode.ActiveExportExists,
    'An export is already in progress for this account. Wait for it to finish before requesting another.',
  );
}

export function exportNotDownloadableError(): ConflictError {
  return new ConflictError(
    ExportErrorCode.NotDownloadable,
    'This export is not downloadable — it has not completed, or its package has expired.',
  );
}
