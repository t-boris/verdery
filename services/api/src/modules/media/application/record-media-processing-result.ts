/**
 * The processing-callback contract's real handler (P6-ASYNC-01) — an honest
 * placeholder, matching this session's own established precedent
 * (`plants-inventory/application/identify-plant-from-photo.ts`,
 * `observations-history/domain/image-analysis-result.ts`'s
 * `analyzeObservationPhoto`): no real validator (P6-WORKER-01) or derivative
 * generator (P6-WORKER-02) exists yet, so this always records a fixed,
 * clearly-fake successful result rather than fabricating a plausible-looking
 * one.
 *
 * WHY THIS RUNS IN `services/api`, NOT `services/workers`: the domain
 * transitions this needs — `beginMediaProcessing`/`markMediaProcessed`/
 * `markMediaProcessingFailed` — already existed, unused, in `domain/
 * media-lifecycle.ts` since P6-DATA-01. Reusing them here means the media
 * record's own `processingState` is driven by the exact same revision-guarded,
 * invariant-checked domain code every other transition in this module uses,
 * instead of a duplicated raw-SQL update the worker boundary would otherwise
 * force (`services/workers` cannot import this module — see architecture/
 * backend-modular-monolith.md section "19. Worker Boundary"). Section 14 of
 * architecture/media-storage-and-processing.md ("Processing Result") also
 * names this directly: "The backend validates result ownership and expected
 * job attempt before making derivatives visible" — the BACKEND, i.e. this
 * process, not the relay.
 *
 * Concretely, this is the callback Cloud Tasks' HTTP task target invokes
 * (see `transport/media-processing-callback-route.ts`), carrying the
 * `MediaProcessingManifest` the relay enqueued as its body. Because no real
 * worker exists yet to run a job "in between" receiving that manifest and
 * reporting a result, this one handler honestly plays both roles this stage:
 * it stands in for the not-yet-built P6-WORKER-02 processor (ignoring the
 * manifest's content — a real processor will consume `inputObjects`/
 * `expectedChecksums`, this placeholder cannot) and it is the "backend"
 * section 14 describes recording that processor's result. A future stage
 * that builds a real out-of-process worker splits these into two hops
 * (Cloud Tasks -> real worker -> this same recording step) without changing
 * this command's own contract: `jobId` in, void out.
 *
 * IDEMPOTENCY: a job not in `queued`/`running` is a duplicate delivery of an
 * already-resolved callback (or a callback for a job some other concurrent
 * delivery just resolved) and is silently ignored — never re-verified, never
 * an error, matching architecture/asynchronous-processing.md section
 * "11. Idempotency" and this stage's own "Duplicate delivery" completion
 * evidence. The `media.update`/`processingJobs.updateState` revision guards
 * below additionally serialize a genuine concurrent double-delivery: whichever
 * request loses the race gets `applied = false` and returns without error,
 * the same "false means the expected revision no longer matched, not an
 * exception" contract every other revision-guarded repository in this module
 * already uses.
 */

import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { Clock } from '../../../shared/time/clock.js';
import { beginMediaProcessing, markMediaProcessed } from '../domain/media-lifecycle.js';
import { markProcessingJobSucceeded } from '../domain/processing-job.js';
import type { ProcessingJob, ProcessingJobResultInput } from '../domain/processing-job.js';
import { processingJobNotFoundError } from './media-errors.js';
import type { MediaUnitOfWork } from './media-unit-of-work.js';

const PLACEHOLDER_OUTCOME_CODE = 'placeholder_derivative_generation';

/**
 * The fixed, honest placeholder result every job this stage resolves
 * records — see this file's own header comment for why nothing here reflects
 * real processing.
 */
function buildPlaceholderResult(job: ProcessingJob): ProcessingJobResultInput {
  return {
    outcomeCode: PLACEHOLDER_OUTCOME_CODE,
    outputObjects: [],
    resultSummary: {
      note:
        'No real derivative generation exists yet (P6-WORKER-02). This is an ' +
        'honest placeholder result recorded to prove the processing pipeline ' +
        'end to end.',
      jobKind: job.jobKind,
      processorConfigVersion: job.processorConfigVersion,
    },
    qualityDiagnostics: null,
    resourceMetrics: null,
  };
}

export class RecordMediaProcessingResult {
  constructor(
    private readonly unitOfWork: MediaUnitOfWork,
    private readonly clock: Clock,
  ) {}

  async execute(jobId: Uuid): Promise<void> {
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

      const media = await context.media.get(job.mediaId);
      if (media === null) {
        // The foreign key from media.processing_job to media.media_record
        // makes this unreachable in practice; guarded anyway rather than
        // trusting that invariant silently.
        throw processingJobNotFoundError();
      }

      const now = this.clock.now();
      const processing = beginMediaProcessing(media, now);
      const processed = markMediaProcessed(processing, now);

      const mediaApplied = await context.media.update(processed, media.revision);
      if (!mediaApplied) {
        // Lost a concurrency race (or the media record moved under this job
        // some other way). Leave the job as-is; a later delivery or an
        // operator replay resolves it.
        return;
      }

      const succeededJob = markProcessingJobSucceeded(job, buildPlaceholderResult(job), now);
      await context.processingJobs.updateState(succeededJob, job.revision);
    });
  }
}
