/**
 * Records an authenticated out-of-process worker result. The API owns the
 * revision-guarded media and job transitions; the worker owns byte parsing.
 * A non-success result moves the media summary to `processing_failed`.
 * Duplicate terminal callbacks are no-ops, and repository revision guards
 * serialize concurrent deliveries.
 */

import type { MediaProcessingResult } from '@verdery/api-contracts';
import { DomainRuleViolatedError } from '../../../platform/errors/application-error.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { Clock } from '../../../shared/time/clock.js';
import {
  beginMediaProcessing,
  markMediaProcessed,
  markMediaProcessingFailed,
} from '../domain/media-lifecycle.js';
import {
  markProcessingJobCancelled,
  markProcessingJobFailedTerminal,
  markProcessingJobPartial,
  markProcessingJobSucceeded,
} from '../domain/processing-job.js';
import type { ProcessingJob, ProcessingJobResultInput } from '../domain/processing-job.js';
import { processingJobNotFoundError } from './media-errors.js';
import type { MediaUnitOfWork } from './media-unit-of-work.js';

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

      await context.processingJobs.updateState(completeJob(job, result, now), job.revision);
    });
  }
}
