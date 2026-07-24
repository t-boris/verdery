/**
 * Whether a just-succeeded `media_validation` job's own media class and
 * detected content type should trigger derivative generation, and which
 * content type to record on the new `media.derivative_generation_requested`
 * outbox event if so.
 *
 * Raster only (architecture/media-storage-and-processing.md section 9's
 * derivatives): matches the exact accepted-raster-type list
 * `services/workers/src/validation/validation-policy.ts` already enumerates
 * for `garden_photo`/`imported_plan` (JPEG, PNG, WebP, HEIC, HEIF),
 * duplicated narrowly here for the same "services/api does not import
 * services/workers' src" boundary reason `relay-database-schema.ts` already
 * documents in the opposite direction (architecture/backend-modular-
 * monolith.md section "19. Worker Boundary").
 *
 * `raw_capture` is excluded by construction (never in
 * `DERIVATIVE_ELIGIBLE_MEDIA_CLASSES`) — video derivatives are out of scope
 * for this stage, the same boundary P6-WORKER-01 already drew for video
 * validation itself. A PDF-classed `imported_plan` is excluded by its own
 * `detectedContentType` (`application/pdf`) never appearing in
 * `RASTER_CONTENT_TYPES` — PDF page-preview rendering is explicitly out of
 * scope for this stage (see this stage's own report and
 * docs/development/deferred-capabilities.md).
 *
 * Source: implementation-plan.md work package P6-WORKER-02;
 * architecture/media-storage-and-processing.md, section "9. Image Derivatives".
 */

const RASTER_CONTENT_TYPES: ReadonlySet<string> = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
]);

const DERIVATIVE_ELIGIBLE_MEDIA_CLASSES: ReadonlySet<string> = new Set([
  'garden_photo',
  'imported_plan',
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
  if (!DERIVATIVE_ELIGIBLE_MEDIA_CLASSES.has(mediaClass)) {
    return null;
  }

  const detectedContentType = resultSummary['detectedContentType'];
  if (typeof detectedContentType !== 'string' || !RASTER_CONTENT_TYPES.has(detectedContentType)) {
    return null;
  }

  return detectedContentType;
}
