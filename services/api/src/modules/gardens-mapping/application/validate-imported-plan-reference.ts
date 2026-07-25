/**
 * "An imported background's `planMediaId` must reference an available,
 * processed `imported_plan` media record in the same garden" — the
 * P6-PLAN-01 sibling of `validate-gate-fence-reference.ts`'s gate -> fence
 * check, shared the same way by `CreateMapObject` and
 * `ChangeMapObjectProperties`, the two commands that can attach
 * `ImportedBackgroundDetails`.
 *
 * Reads the media module's `MediaRepository` port directly, the exact
 * cross-module precedent `plants-inventory`'s unit of work set for its own
 * `mediaId` reference checks (`attach-plant-photo.ts`) — not a new
 * parallel port. The garden check is explicit here (unlike
 * `MapObjectRepository.findById`, `MediaRepository.get` is not
 * garden-scoped), so a real media id in a *different* garden is rejected
 * identically to a nonexistent one.
 *
 * Availability gate: `uploadState === 'available'` AND
 * `processingState === 'processed'` — the same pair `GetMediaAccess`
 * requires before serving an original's bytes. A still-uploading,
 * rejected, or unvalidated plan has nothing safe to display as a map
 * background yet. This includes a PDF plan whose *validation* concluded
 * clean: it is creatable as a background even though no derivative can
 * render yet (P6-WORKER-02's documented PDF deferral) — the client shows
 * that state honestly rather than this check pretending the record is
 * unusable.
 *
 * Page-number rule: `sourcePageNumber > 1` is only accepted for a
 * PDF-classed source (`verifiedContentType`, falling back to the declared
 * type before verification writes one — in practice always verified, since
 * `available` requires completed verification). A raster plan has exactly
 * one page. The page is NOT validated against the PDF's real page count:
 * no PDF parser exists in `services/api` (the same native-dependency
 * boundary P6-WORKER-02 documents), so an out-of-range page surfaces when
 * PDF rendering lands, not here.
 */

import { SharedErrorCode } from '@verdery/api-contracts';
import type { GardenObjectDetails } from '@verdery/geometry-contracts';
import { ValidationError } from '../../../platform/errors/application-error.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { MediaRepository } from '../../media/public.js';

const PDF_CONTENT_TYPE = 'application/pdf';

function invalidReference(code: string, message: string, pointer: string): ValidationError {
  return new ValidationError(SharedErrorCode.RequestInvalid, message, {
    details: [{ code, pointer }],
  });
}

export async function requireImportedBackgroundPlanMedia(
  media: MediaRepository,
  gardenId: Uuid,
  details: GardenObjectDetails | undefined,
): Promise<void> {
  if (details === undefined || details.category !== 'importedBackground') {
    return;
  }

  const record = await media.get(details.details.planMediaId);
  if (record === null || record.gardenId !== gardenId || record.mediaClass !== 'imported_plan') {
    throw invalidReference(
      'map.imported_background.plan_media_not_found',
      "An imported background's planMediaId must reference an imported_plan media record in this garden.",
      '/categoryDetails/planMediaId',
    );
  }

  if (record.uploadState !== 'available' || record.processingState !== 'processed') {
    throw invalidReference(
      'map.imported_background.plan_media_not_ready',
      'The referenced plan document has not finished uploading and validating yet.',
      '/categoryDetails/planMediaId',
    );
  }

  const pageNumber = details.details.sourcePageNumber;
  const contentType = record.verifiedContentType ?? record.declaredContentType;
  if (pageNumber !== undefined && pageNumber > 1 && contentType !== PDF_CONTENT_TYPE) {
    throw invalidReference(
      'map.imported_background.page_number_not_applicable',
      'A raster plan has exactly one page; sourcePageNumber above 1 is only valid for a PDF source.',
      '/categoryDetails/sourcePageNumber',
    );
  }
}
