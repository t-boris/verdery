/**
 * Whether a just-succeeded `media_validation` job's own media class and
 * detected content type should trigger derivative generation, and which
 * content type to record on the new `media.derivative_generation_requested`
 * outbox event if so.
 *
 * Matches the accepted-type list
 * `services/workers/src/validation/validation-policy.ts` already enumerates
 * for `garden_photo`/`imported_plan` (JPEG, PNG, WebP, HEIC, HEIF), plus PDF
 * for plans — duplicated narrowly here for the same "services/api does not
 * import services/workers' src" boundary reason `relay-database-schema.ts`
 * already documents in the opposite direction (architecture/backend-modular-
 * monolith.md section "19. Worker Boundary").
 *
 * PDF belongs to PLANS ONLY, and only since ADR-0017: the worker renders a
 * plan's first page with `poppler` and the ordinary image pipeline continues
 * from there. Before that decision this list excluded `application/pdf`, and
 * a surveyor's plat therefore uploaded, validated, and produced nothing at
 * all — the defect that prompted the ADR. A PDF garden photo remains
 * ineligible because no such thing is accepted at upload.
 *
 * `raw_capture` is excluded by construction (never in
 * `DERIVATIVE_ELIGIBLE_MEDIA_CLASSES`) — video derivatives are out of scope
 * for this stage, the same boundary P6-WORKER-01 already drew for video
 * validation itself.
 *
 * Source: implementation-plan.md work package P6-WORKER-02;
 * architecture/media-storage-and-processing.md, section "9. Image
 * Derivatives"; docs/architecture/decisions/ADR-0017-pdf-plans-rendered-without-a-malware-scanner.md.
 */

const RASTER_CONTENT_TYPES: ReadonlySet<string> = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
]);

const PDF_CONTENT_TYPE = 'application/pdf';

/** Media classes whose successful validation triggers derivative generation, and what each accepts. */
const DERIVATIVE_ELIGIBLE_CONTENT_TYPES: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ['garden_photo', RASTER_CONTENT_TYPES],
  ['imported_plan', new Set([...RASTER_CONTENT_TYPES, PDF_CONTENT_TYPE])],
]);

/**
 * Reads a successful validation result's own `resultSummary.detectedContentType`
 * (`process-media-validation-job.ts`'s own field, `services/workers`) and
 * returns it only when this media class/content-type pairing is eligible for
 * derivative generation; `null` otherwise (never eligible, or the field is
 * missing/malformed — a defensive read against a loosely-typed
 * `Record<string, unknown>`, not an assumption that a real worker payload
 * ever omits it).
 */
export function deriveEligibleDerivativeSourceContentType(
  mediaClass: string,
  resultSummary: Record<string, unknown>,
): string | null {
  const eligibleTypes = DERIVATIVE_ELIGIBLE_CONTENT_TYPES.get(mediaClass);
  if (eligibleTypes === undefined) {
    return null;
  }

  const detectedContentType = resultSummary['detectedContentType'];
  if (typeof detectedContentType !== 'string' || !eligibleTypes.has(detectedContentType)) {
    return null;
  }

  return detectedContentType;
}
