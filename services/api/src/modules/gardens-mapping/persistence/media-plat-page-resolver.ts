/**
 * Which stored object a plat is actually read from.
 *
 * A plan arrives as a PDF far more often than as a photograph, and no PDF
 * decoder exists in `services/api` (the native-dependency boundary
 * `validate-imported-plan-reference.ts` already documents). The worker
 * rasterises the first page into the ordinary display derivatives
 * (ADR-0017), so for a PDF the readable page is a derivative — never the PDF
 * itself. For a raster plan the original IS the page, and its derivatives are
 * merely smaller copies of it.
 *
 * One rule covers both: the LARGEST page image that fits under the provider's
 * limit. Detail is what a transcription depends on — a bearing is six printed
 * characters at the end of a hairline — so a downscaled preview is a last
 * resort rather than a saving.
 *
 * Reads the media module's `MediaRepository` port directly, the same
 * cross-module precedent `validate-imported-plan-reference.ts` set.
 *
 * `null` means "no page to read yet", which the use case turns into
 * `map.plan_page_not_ready` — the honest answer while a freshly uploaded PDF
 * is still being rendered.
 *
 * Source: docs/architecture/decisions/ADR-0018-plat-extraction-as-reviewable-proposals.md;
 * architecture/media-storage-and-processing.md, section "6. Derivatives".
 */

import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { MediaRecord, MediaRepository } from '../../media/public.js';
import type { PlatPageResolver, PlatReadingSource } from '../application/read-plat-from-plan.js';

const PDF_CONTENT_TYPE = 'application/pdf';

/**
 * Vertex reads a `gs://` reference rather than inline bytes, so this bounds
 * the decoded page rather than a request body: the rendered high-resolution
 * derivative of a plat sheet is a couple of megabytes, and an object far
 * above this is a sign the wrong one was picked.
 */
export const READABLE_PLAT_PAGE_MAX_BYTES = 20_000_000;
const PAGE_READY_POLL_ATTEMPTS = 5;
const PAGE_READY_POLL_INTERVAL_MS = 250;

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export class MediaPlatPageResolver implements PlatPageResolver {
  constructor(private readonly media: MediaRepository) {}

  async resolvePage(gardenId: Uuid, planMediaId: Uuid): Promise<PlatReadingSource | null> {
    const record = await this.media.get(planMediaId);

    // A plan in another garden is refused exactly as a nonexistent one is —
    // the same concealment `requireImportedBackgroundPlanMedia` applies.
    if (
      record === null ||
      record.gardenId !== gardenId ||
      record.mediaClass !== 'imported_plan' ||
      record.uploadState !== 'available'
    ) {
      return null;
    }

    const originalIsAPage = contentTypeOf(record) !== PDF_CONTENT_TYPE;
    if (originalIsAPage) {
      const derivatives = await this.media.listDisplayDerivatives(record.id);
      return largestReadablePage([record, ...derivatives]);
    }

    /*
     * A PDF becomes `processed` after validation, while its rendered page is
     * delivered by a following derivative callback. The web can therefore
     * legitimately see a processed plan a few hundred milliseconds before
     * `listDisplayDerivatives` can see the page. Polling only this narrow,
     * known transition closes that race without retrying a provider call or
     * hiding a genuinely missing derivative for more than one second.
     */
    for (let attempt = 0; attempt < PAGE_READY_POLL_ATTEMPTS; attempt += 1) {
      const derivatives = await this.media.listDisplayDerivatives(record.id);
      const page = largestReadablePage(derivatives);
      if (page !== null) {
        return page;
      }
      if (attempt + 1 < PAGE_READY_POLL_ATTEMPTS) {
        await wait(PAGE_READY_POLL_INTERVAL_MS);
      }
    }
    return null;
  }
}

function contentTypeOf(record: MediaRecord): string {
  return record.verifiedContentType ?? record.declaredContentType;
}

function largestReadablePage(candidates: readonly MediaRecord[]): PlatReadingSource | null {
  const readable = candidates
    .flatMap((record) => {
      if (record.bucketName === null || record.objectKey === null) {
        return [];
      }
      const source: PlatReadingSource = {
        bucketName: record.bucketName,
        objectKey: record.objectKey,
        mimeType: contentTypeOf(record),
        byteSize: record.verifiedByteSize ?? record.declaredByteSize,
      };
      return source.byteSize <= READABLE_PLAT_PAGE_MAX_BYTES ? [source] : [];
    })
    .sort((left, right) => right.byteSize - left.byteSize);

  return readable[0] ?? null;
}
