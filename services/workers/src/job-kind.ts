/**
 * The two `media.processing_job.job_kind` values this worker recognizes.
 *
 * Duplicated narrowly from `services/api`'s own `domain/processing-job.ts`
 * constants (`MEDIA_VALIDATION_JOB_KIND`/`MEDIA_DERIVATIVE_GENERATION_JOB_KIND`)
 * — this package does not import `services/api`'s `src/` at all
 * (architecture/backend-modular-monolith.md section "19. Worker Boundary"),
 * the same duplication precedent `relay/relay-database-schema.ts` already
 * documents for its own narrow slice of column shape. Kept as plain string
 * constants (not re-declared enum types) at the package root, not inside
 * `relay/` or `validation/`, because both directories — plus the new
 * `derivatives/` and the shared HTTP dispatch — need them equally; no single
 * existing directory is the "right" owner.
 *
 * Source: services/api/src/modules/media/domain/processing-job.ts;
 * migrations/1785200000000_media-processing-jobs.sql.
 */

export const MEDIA_VALIDATION_JOB_KIND = 'media_validation';
export const MEDIA_DERIVATIVE_GENERATION_JOB_KIND = 'derivative_generation';
