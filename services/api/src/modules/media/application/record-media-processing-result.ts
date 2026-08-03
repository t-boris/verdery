/**
 * Records an authenticated out-of-process worker result. The API owns the
 * revision-guarded media and job transitions; the worker owns byte parsing.
 * A non-success result moves the media summary to `processing_failed`.
 * Duplicate terminal callbacks are no-ops, and repository revision guards
 * serialize concurrent deliveries.
 *
 * P6-WORKER-02 extends this with a second job kind
 * (`MEDIA_DERIVATIVE_GENERATION_JOB_KIND`), branched on `job.jobKind`:
 *
 * - A `MEDIA_VALIDATION_JOB_KIND` result (unchanged from P6-WORKER-01):
 *   drives the SOURCE media's `processingState`
 *   (`beginMediaProcessing`/`markMediaProcessed`/`markMediaProcessingFailed`),
 *   and — new this stage — a SUCCESSFUL result for a raster-eligible media
 *   class also appends a `media.derivative_generation_requested` outbox
 *   event in the SAME transaction (`requestDerivativeGenerationIfEligible`,
 *   backed by `application/derivative-eligibility.ts`), the natural
 *   continuation of the outbox-driven chain `CompleteMediaUpload` started.
 * - A `MEDIA_DERIVATIVE_GENERATION_JOB_KIND` result: registers each produced
 *   output object as its own new `media_record` row
 *   (`application/derivative-registration.ts`, idempotent — see that file's
 *   own header comment), and deliberately NEVER calls
 *   `beginMediaProcessing`/`markMediaProcessed`/`markMediaProcessingFailed`
 *   against the source media a second time: that source already reached
 *   `processingState = 'processed'` when its OWN validation job succeeded,
 *   and `beginMediaProcessing` requires `processingState === null` by
 *   design (`media-lifecycle.ts`) — calling it again here would be a
 *   guaranteed `DomainRuleViolatedError`, not a real second processing
 *   stage the source media itself needs to pass through.
 *
 * P6-RET-01 adds the third kind and the deletion-versus-processing race
 * guards (section 16's "Deletion is asynchronous and idempotent"):
 *
 * - A `MEDIA_DELETION_JOB_KIND` result: objects confirmed absent drives
 *   `deletion_scheduled -> deleted` plus the residual completion steps
 *   (`completeMediaDeletion` — derivative rows, quota release, audit); any
 *   other outcome records only the job, leaving the record
 *   `deletion_scheduled` ("recoverable provider failure is reported
 *   internally", section 16).
 * - BOTH processing kinds now guard on the source's `uploadState`: a
 *   deletion scheduled while a processing job was in flight (the job may
 *   have been created and even dispatched before the scheduling
 *   transaction cancelled its siblings) can no longer be corrupted by the
 *   late result — the job completes as `cancelled` instead, and a late
 *   DERIVATIVE result's already-written bytes are re-covered by re-emitting
 *   the standard deletion event (idempotent by design — the same prefixes,
 *   a fresh event id, and completion that converges on `deleted`).
 *
 * P6-OBS-01: `execute` returns a `MediaProcessingResultRecordedSummary` so
 * the callback route can log one structured line per delivery — see that
 * type's own doc comment.
 */

import {
  MEDIA_DERIVATIVE_GENERATION_REQUESTED_EVENT_TYPE,
  type MediaProcessingRequestedEventPayload,
  type MediaProcessingResult,
} from '@verdery/api-contracts';
import { DomainRuleViolatedError } from '../../../platform/errors/application-error.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { Clock } from '../../../shared/time/clock.js';
import {
  beginMediaProcessing,
  markMediaProcessed,
  markMediaProcessingFailed,
} from '../domain/media-lifecycle.js';
import type { MediaClass, MediaRecord } from '../domain/media-record.js';
import {
  MEDIA_DELETION_JOB_KIND,
  MEDIA_DERIVATIVE_GENERATION_JOB_KIND,
  markProcessingJobCancelled,
  markProcessingJobFailedTerminal,
  markProcessingJobPartial,
  markProcessingJobSucceeded,
} from '../domain/processing-job.js';
import type { ProcessingJob, ProcessingJobResultInput } from '../domain/processing-job.js';
import { deriveEligibleDerivativeSourceContentType } from './derivative-eligibility.js';
import { parseDerivativeOutput, registerDerivativeIfAbsent } from './derivative-registration.js';
import {
  appendMediaDeletionRequestedEvent,
  completeMediaDeletion,
} from './media-deletion-workflow.js';
import { processingJobNotFoundError } from './media-errors.js';
import type { MediaTransactionContext, MediaUnitOfWork } from './media-unit-of-work.js';

/** The `outcomeCode` a processing job completed against an already-deletion-scheduled source carries. */
export const SOURCE_NOT_AVAILABLE_OUTCOME_CODE = 'media_not_available';

/**
 * What one callback delivery actually did (P6-OBS-01) — returned to the
 * transport layer so `media-processing-callback-route.ts` can emit one
 * structured `media.processing.result_recorded` log line per delivery, the
 * same "the application returns the data, the transport logs it" split
 * `sync-routes.ts`'s own header comment established for P5-OBS-01 (compare
 * `countSyncPushOutcomes`), rather than threading a `Logger` into this
 * class.
 */
export type MediaProcessingResultDisposition =
  /** This delivery drove the job (and, per kind, the media record) to its terminal state. */
  | 'recorded'
  /** The job was already terminal — a duplicate/late delivery, a no-op beyond late-derivative byte cleanup. */
  | 'duplicate'
  /** The source left `available` while the job was in flight; the job completed as `cancelled` (P6-RET-01 race guard). */
  | 'cancelled_source_unavailable'
  /** The media row moved concurrently; the job was left as-is for a later delivery or operator replay. */
  | 'lost_revision_race';

export interface MediaProcessingResultRecordedSummary {
  readonly disposition: MediaProcessingResultDisposition;
  readonly jobKind: string;
  readonly mediaId: Uuid;
  /** `null` on the duplicate path, which never fetches the media row. */
  readonly mediaClass: MediaClass | null;
  /** The worker-reported outcome of this delivery (not necessarily the job's recorded state — see `disposition`). */
  readonly outcome: MediaProcessingResult['outcome'];
  readonly outcomeCode: string | null;
  readonly attempt: number;
  /** The worker's own reported execution time, when it sent one. */
  readonly workerDurationMs: number | null;
  /**
   * Job creation (`requested`) to this terminal recording — the full
   * pipeline latency including relay pickup, Cloud Tasks queueing, and any
   * retries. `null` when this delivery did not complete the job
   * (`duplicate`/`lost_revision_race`).
   */
  readonly requestedToCompletedMs: number | null;
  /**
   * `media_deletion` succeeded only: `deletion_scheduled` -> `deleted`
   * (architecture/media-storage-and-processing.md section 19's "deletion
   * lag"). Computable from `media.updatedAt` because nothing updates the
   * ORIGINAL row between the scheduling transaction and this completion:
   * every other write path gates on `uploadState === 'available'`, replays
   * short-circuit, and derivative bulk transitions touch derivative rows
   * only.
   */
  readonly deletionLagMs: number | null;
}

function toDomainResult(result: MediaProcessingResult): ProcessingJobResultInput {
  return {
    outcomeCode:
      typeof result.resultSummary['validationCode'] === 'string'
        ? result.resultSummary['validationCode']
        : result.outcome,
    outputObjects: result.outputObjects,
    resultSummary: result.resultSummary,
    qualityDiagnostics: result.qualityDiagnostics,
    resourceMetrics: result.resourceMetrics,
  };
}

function completeJob(job: ProcessingJob, result: MediaProcessingResult, now: Date): ProcessingJob {
  const domainResult = toDomainResult(result);
  switch (result.outcome) {
    case 'succeeded':
      return markProcessingJobSucceeded(job, domainResult, now);
    case 'partial':
      return markProcessingJobPartial(job, domainResult, now);
    case 'failed_terminal':
      return markProcessingJobFailedTerminal(job, domainResult, now);
    case 'cancelled':
      return markProcessingJobCancelled(job, domainResult, now);
  }
}

function requireSuccessfulInputChecksums(job: ProcessingJob, result: MediaProcessingResult): void {
  if (
    result.outcome === 'succeeded' &&
    job.inputChecksums.some((expected) => !result.inputChecksums.includes(expected))
  ) {
    throw new DomainRuleViolatedError(
      'media.processing_result.input_checksum_mismatch',
      'A successful processing result must confirm every expected input checksum.',
    );
  }
}

export class RecordMediaProcessingResult {
  constructor(
    private readonly unitOfWork: MediaUnitOfWork,
    private readonly clock: Clock,
    /** The derived bucket name — needed to (re-)emit deletion events covering derivative bytes; see `media-deletion-workflow.ts`. */
    private readonly derivedBucketName: string,
  ) {}

  async execute(
    jobId: Uuid,
    result: MediaProcessingResult,
  ): Promise<MediaProcessingResultRecordedSummary> {
    return this.unitOfWork.run(async (context) => {
      const job = await context.processingJobs.get(jobId);
      if (job === null) {
        throw processingJobNotFoundError();
      }

      if (job.state !== 'queued' && job.state !== 'running') {
        // Duplicate delivery of an already-resolved job — including a job
        // the deletion workflow cancelled whose Cloud Tasks dispatch could
        // not be recalled. A cancelled DERIVATIVE job may still have
        // written real bytes before this callback arrived; re-cover them.
        await this.cleanUpLateDerivativeBytes(context, job, result);
        return this.summarize('duplicate', job, null, result, null, null);
      }
      requireSuccessfulInputChecksums(job, result);

      const media = await context.media.get(job.mediaId);
      if (media === null) {
        // The foreign key from media.processing_job to media.media_record
        // makes this unreachable in practice; guarded anyway rather than
        // trusting that invariant silently.
        throw processingJobNotFoundError();
      }

      const now = this.clock.now();

      if (job.jobKind === MEDIA_DELETION_JOB_KIND) {
        return this.recordDeletionResult(context, job, media, result, now);
      }

      // P6-RET-01 race guard, both processing kinds: the source moved out
      // of `available` (deletion scheduled, or already deleted) while this
      // job was in flight. Complete the job as cancelled — section 16 step
      // 3's cancellation, applied at the last possible moment — and never
      // touch the media row the deletion workflow now owns.
      if (media.uploadState !== 'available') {
        return this.cancelAgainstUnavailableSource(context, job, media, result, now);
      }

      if (job.jobKind === MEDIA_DERIVATIVE_GENERATION_JOB_KIND) {
        return this.recordDerivativeGenerationResult(context, job, media, result, now);
      }

      return this.recordValidationResult(context, job, media, result, now);
    });
  }

  /** Builds the summary the transport logs — one place, so every path reports the same shape. */
  private summarize(
    disposition: MediaProcessingResultDisposition,
    job: ProcessingJob,
    media: MediaRecord | null,
    result: MediaProcessingResult,
    completedAt: Date | null,
    deletionLagMs: number | null,
  ): MediaProcessingResultRecordedSummary {
    return {
      disposition,
      jobKind: job.jobKind,
      mediaId: job.mediaId,
      mediaClass: media?.mediaClass ?? null,
      outcome: result.outcome,
      outcomeCode:
        disposition === 'cancelled_source_unavailable'
          ? SOURCE_NOT_AVAILABLE_OUTCOME_CODE
          : toDomainResult(result).outcomeCode,
      attempt: job.attempt,
      workerDurationMs: result.resourceMetrics?.durationMs ?? null,
      requestedToCompletedMs:
        completedAt === null ? null : Math.max(0, completedAt.getTime() - job.createdAt.getTime()),
      deletionLagMs,
    };
  }

  /** `MEDIA_VALIDATION_JOB_KIND` path — see this file's own header comment. */
  private async recordValidationResult(
    context: MediaTransactionContext,
    job: ProcessingJob,
    media: MediaRecord,
    result: MediaProcessingResult,
    now: Date,
  ): Promise<MediaProcessingResultRecordedSummary> {
    const processing = beginMediaProcessing(media, now);
    const transitioned =
      result.outcome === 'succeeded'
        ? markMediaProcessed(processing, now)
        : markMediaProcessingFailed(processing, now);

    // The derivative job hashed the source's pixels while it had them
    // decoded; this is the only write path that sees that hash. A result
    // without one (a validation job, a non-image class, a decoder refusal)
    // leaves whatever is already stored alone rather than clearing it — a
    // later job re-reporting nothing must not erase a good hash.
    const processed =
      typeof result.sourcePerceptualHash === 'string'
        ? { ...transitioned, perceptualHash: result.sourcePerceptualHash }
        : transitioned;

    const mediaApplied = await context.media.update(processed, media.revision);
    if (!mediaApplied) {
      // Lost a concurrency race (or the media record moved under this job
      // some other way). Leave the job as-is; a later delivery or an
      // operator replay resolves it.
      return this.summarize('lost_revision_race', job, media, result, null, null);
    }

    if (result.outcome === 'succeeded') {
      await this.requestDerivativeGenerationIfEligible(context, processed, result);
    }

    await context.processingJobs.updateState(completeJob(job, result, now), job.revision);
    return this.summarize('recorded', job, media, result, now, null);
  }

  /**
   * Appends `media.derivative_generation_requested` in the same transaction
   * as the `processed` write above — the outbox-driven chain
   * `CompleteMediaUpload` started, extended by one more link. A no-op for
   * every ineligible case (media class, content type, or a missing real
   * checksum/byte-size fact the validation result should always carry for a
   * successful outcome) — see `derivative-eligibility.ts`'s own doc comment.
   */
  private async requestDerivativeGenerationIfEligible(
    context: MediaTransactionContext,
    media: MediaRecord,
    result: MediaProcessingResult,
  ): Promise<void> {
    const contentType = deriveEligibleDerivativeSourceContentType(
      media.mediaClass,
      result.resultSummary,
    );
    const [checksumSha256] = result.inputChecksums;
    const byteSize = result.resultSummary['byteSize'];

    if (contentType === null || checksumSha256 === undefined || typeof byteSize !== 'number') {
      return;
    }

    // `bucketName`/`objectKey` are always both set once `uploadState`
    // reached `authorized` — the same non-null reasoning
    // `complete-media-upload.ts`'s own outbox-append step already relies on
    // for this identical pair.
    const payload: MediaProcessingRequestedEventPayload = {
      mediaId: media.id,
      gardenId: media.gardenId,
      mediaClass: media.mediaClass,
      displayFilename: media.displayFilename,
      bucketName: media.bucketName as string,
      objectKey: media.objectKey as string,
      contentType,
      byteSize,
      checksumSha256,
    };
    await context.outbox.append({
      eventType: MEDIA_DERIVATIVE_GENERATION_REQUESTED_EVENT_TYPE,
      aggregateType: 'media_record',
      aggregateId: media.id,
      payload,
    });
  }

  /** `MEDIA_DERIVATIVE_GENERATION_JOB_KIND` path — see this file's own header comment. */
  private async recordDerivativeGenerationResult(
    context: MediaTransactionContext,
    job: ProcessingJob,
    media: MediaRecord,
    result: MediaProcessingResult,
    now: Date,
  ): Promise<MediaProcessingResultRecordedSummary> {
    if (result.outcome === 'succeeded' || result.outcome === 'partial') {
      for (const output of result.outputObjects) {
        const parsed = parseDerivativeOutput(output);
        if (parsed === null) {
          // Malformed output object — never registered. The job's own
          // `resultSummary`/`qualityDiagnostics` (recorded below regardless)
          // remain the record of what the worker actually reported.
          continue;
        }
        await registerDerivativeIfAbsent(context, media, parsed, now);
      }
    }

    await context.processingJobs.updateState(completeJob(job, result, now), job.revision);
    return this.summarize('recorded', job, media, result, now, null);
  }

  /** `MEDIA_DELETION_JOB_KIND` path — see this file's own header comment. */
  private async recordDeletionResult(
    context: MediaTransactionContext,
    job: ProcessingJob,
    media: MediaRecord,
    result: MediaProcessingResult,
    now: Date,
  ): Promise<MediaProcessingResultRecordedSummary> {
    // Section 19's "deletion lag", measured at the only moment both ends
    // are known — see `MediaProcessingResultRecordedSummary.deletionLagMs`'s
    // own doc comment for why `media.updatedAt` IS the scheduling instant.
    const deletionLagMs =
      result.outcome === 'succeeded' && media.uploadState === 'deletion_scheduled'
        ? Math.max(0, now.getTime() - media.updatedAt.getTime())
        : null;

    if (result.outcome === 'succeeded') {
      await completeMediaDeletion(context, media, now);
    }
    // Any other outcome: the job row itself is section 16 step 6's
    // "record provider retry state" — the record stays
    // `deletion_scheduled` and user-visible deletion remains pending.
    await context.processingJobs.updateState(completeJob(job, result, now), job.revision);
    return this.summarize('recorded', job, media, result, now, deletionLagMs);
  }

  /** The in-flight half of the deletion race guard — see this file's own header comment. */
  private async cancelAgainstUnavailableSource(
    context: MediaTransactionContext,
    job: ProcessingJob,
    media: MediaRecord,
    result: MediaProcessingResult,
    now: Date,
  ): Promise<MediaProcessingResultRecordedSummary> {
    const cancelled = markProcessingJobCancelled(
      job,
      {
        outcomeCode: SOURCE_NOT_AVAILABLE_OUTCOME_CODE,
        resultSummary: result.resultSummary,
        resourceMetrics: result.resourceMetrics,
      },
      now,
    );
    await context.processingJobs.updateState(cancelled, job.revision);

    if (this.hasDerivativeBytesToCleanUp(job, media, result)) {
      await appendMediaDeletionRequestedEvent(context, media, this.derivedBucketName);
    }
    return this.summarize('cancelled_source_unavailable', job, media, result, now, null);
  }

  /** The already-terminal half of the same guard (a cancelled job's undeliverable-to-recall Cloud Tasks dispatch still ran) — see `execute`. */
  private async cleanUpLateDerivativeBytes(
    context: MediaTransactionContext,
    job: ProcessingJob,
    result: MediaProcessingResult,
  ): Promise<void> {
    if (job.jobKind !== MEDIA_DERIVATIVE_GENERATION_JOB_KIND || result.outputObjects.length === 0) {
      return;
    }
    const media = await context.media.get(job.mediaId);
    if (media === null || this.hasDerivativeBytesToCleanUp(job, media, result) === false) {
      return;
    }
    await appendMediaDeletionRequestedEvent(context, media, this.derivedBucketName);
  }

  /**
   * A late DERIVATIVE result with real outputs against a source in the
   * deletion pipeline means bytes were written to the derived bucket that
   * no deletion job is guaranteed to have covered (the main deletion may
   * already have run before this job wrote them). Re-emitting the standard
   * deletion event re-deletes the same prefixes idempotently and its
   * completion converges on `deleted` — see the workflow's own comments.
   * Requires the record to still carry its storage target (always true
   * past `authorized`).
   */
  private hasDerivativeBytesToCleanUp(
    job: ProcessingJob,
    media: MediaRecord,
    result: MediaProcessingResult,
  ): boolean {
    return (
      job.jobKind === MEDIA_DERIVATIVE_GENERATION_JOB_KIND &&
      result.outputObjects.length > 0 &&
      (media.uploadState === 'deletion_scheduled' || media.uploadState === 'deleted') &&
      media.bucketName !== null
    );
  }
}
