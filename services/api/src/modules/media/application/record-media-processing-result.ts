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
import type { MediaRecord } from '../domain/media-record.js';
import {
  MEDIA_DERIVATIVE_GENERATION_JOB_KIND,
  markProcessingJobCancelled,
  markProcessingJobFailedTerminal,
  markProcessingJobPartial,
  markProcessingJobSucceeded,
} from '../domain/processing-job.js';
import type { ProcessingJob, ProcessingJobResultInput } from '../domain/processing-job.js';
import { deriveEligibleDerivativeSourceContentType } from './derivative-eligibility.js';
import { parseDerivativeOutput, registerDerivativeIfAbsent } from './derivative-registration.js';
import { processingJobNotFoundError } from './media-errors.js';
import type { MediaTransactionContext, MediaUnitOfWork } from './media-unit-of-work.js';

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
  ) {}

  async execute(jobId: Uuid, result: MediaProcessingResult): Promise<void> {
    await this.unitOfWork.run(async (context) => {
      const job = await context.processingJobs.get(jobId);
      if (job === null) {
        throw processingJobNotFoundError();
      }

      if (job.state !== 'queued' && job.state !== 'running') {
        // Duplicate delivery of an already-resolved job — see this file's
        // own header comment on idempotency.
        return;
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

      if (job.jobKind === MEDIA_DERIVATIVE_GENERATION_JOB_KIND) {
        await this.recordDerivativeGenerationResult(context, job, media, result, now);
        return;
      }

      await this.recordValidationResult(context, job, media, result, now);
    });
  }

  /** `MEDIA_VALIDATION_JOB_KIND` path — see this file's own header comment. */
  private async recordValidationResult(
    context: MediaTransactionContext,
    job: ProcessingJob,
    media: MediaRecord,
    result: MediaProcessingResult,
    now: Date,
  ): Promise<void> {
    const processing = beginMediaProcessing(media, now);
    const processed =
      result.outcome === 'succeeded'
        ? markMediaProcessed(processing, now)
        : markMediaProcessingFailed(processing, now);

    const mediaApplied = await context.media.update(processed, media.revision);
    if (!mediaApplied) {
      // Lost a concurrency race (or the media record moved under this job
      // some other way). Leave the job as-is; a later delivery or an
      // operator replay resolves it.
      return;
    }

    if (result.outcome === 'succeeded') {
      await this.requestDerivativeGenerationIfEligible(context, processed, result);
    }

    await context.processingJobs.updateState(completeJob(job, result, now), job.revision);
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
  ): Promise<void> {
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
  }
}
