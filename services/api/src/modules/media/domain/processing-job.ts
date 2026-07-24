/**
 * `media.processing_job` — durable, per-attempt processing job state.
 *
 * Distinct from `media-lifecycle.ts`'s `MediaProcessingState`
 * (`processing`/`processed`/`processing_failed`, a coarse three-value
 * summary on `media_record` itself): this is one row per job, matching
 * architecture/asynchronous-processing.md section "10. Job State Machine"
 * exactly —
 *
 * ```text
 * requested → queued → running → succeeded
 *                  │        ├──→ partial
 *                  │        ├──→ failed_retryable → queued
 *                  │        ├──→ failed_terminal
 *                  │        └──→ cancelled
 *                  └────────────→ expired
 * ```
 *
 * The validation worker now drives success and terminal-failure transitions
 * through `record-media-processing-result.ts`. Other transitions below
 * (`markProcessingJobRunning`, `markProcessingJobPartial`,
 * `markProcessingJobFailedRetryable`, `retryProcessingJob`,
 * `markProcessingJobFailedTerminal`, `markProcessingJobCancelled`,
 * `markProcessingJobExpired`) is real, tested domain logic with no live
 * caller yet — the same posture `beginMediaProcessing`/`markMediaProcessed`/
 * `markMediaProcessingFailed` themselves held from P6-DATA-01 until this
 * stage gave them one, now applied one level down for the job states a real
 * P6-WORKER-01/02 processor will eventually reach.
 *
 * Source: migrations/1785200000000_media-processing-jobs.sql;
 * architecture/media-storage-and-processing.md, sections
 * "13. Processing Manifest", "14. Processing Result";
 * architecture/asynchronous-processing.md, section "10. Job State Machine".
 */

import { DomainRuleViolatedError } from '../../../platform/errors/application-error.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';

export type ProcessingJobState =
  | 'requested'
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'partial'
  | 'failed_retryable'
  | 'failed_terminal'
  | 'cancelled'
  | 'expired';

const TERMINAL_STATES: ReadonlySet<ProcessingJobState> = new Set([
  'succeeded',
  'partial',
  'failed_terminal',
  'cancelled',
  'expired',
]);

export interface ProcessingJobOutputObject {
  readonly bucketName: string;
  readonly objectKey: string;
  readonly checksumSha256: string;
}

export interface ProcessingJobResourceMetrics {
  readonly durationMs: number;
}

export interface ProcessingJob {
  readonly id: Uuid;
  readonly mediaId: Uuid;
  readonly jobKind: string;
  readonly processorConfigVersion: string;
  readonly state: ProcessingJobState;
  readonly attempt: number;
  readonly inputChecksums: readonly string[];
  readonly outputObjects: readonly ProcessingJobOutputObject[] | null;
  readonly resultSummary: Record<string, unknown> | null;
  readonly qualityDiagnostics: Record<string, unknown> | null;
  readonly resourceMetrics: ProcessingJobResourceMetrics | null;
  readonly outcomeCode: string | null;
  readonly traceId: string | null;
  readonly revision: number;
  readonly createdAt: Date;
  readonly queuedAt: Date | null;
  readonly completedAt: Date | null;
  readonly updatedAt: Date;
}

/** This stage's own single job kind — see this file's header comment on why the vocabulary stops at one entry today. */
export const MEDIA_VALIDATION_JOB_KIND = 'media_validation';

function requireState(
  job: ProcessingJob,
  expected: readonly ProcessingJobState[],
  action: string,
): void {
  if (!expected.includes(job.state)) {
    throw new DomainRuleViolatedError(
      'media.processing_job.state_conflict',
      `${action} requires job '${job.id}' to be in one of [${expected.join(', ')}], but it is '${job.state}'.`,
    );
  }
}

export interface CreateProcessingJobInput {
  readonly id: Uuid;
  readonly mediaId: Uuid;
  readonly processorConfigVersion: string;
  readonly inputChecksums: readonly string[];
  readonly traceId?: string | null;
  readonly jobKind?: string;
}

/** `requested`: a job's initial durable state, written before the relay attempts to enqueue it — see `services/workers`' own relay for why this is a separate, persisted step rather than jumping straight to `queued`. */
export function createProcessingJob(input: CreateProcessingJobInput, now: Date): ProcessingJob {
  return {
    id: input.id,
    mediaId: input.mediaId,
    jobKind: input.jobKind ?? MEDIA_VALIDATION_JOB_KIND,
    processorConfigVersion: input.processorConfigVersion,
    state: 'requested',
    attempt: 1,
    inputChecksums: input.inputChecksums,
    outputObjects: null,
    resultSummary: null,
    qualityDiagnostics: null,
    resourceMetrics: null,
    outcomeCode: null,
    traceId: input.traceId ?? null,
    revision: 1,
    createdAt: now,
    queuedAt: null,
    completedAt: null,
    updatedAt: now,
  };
}

/** `requested` -> `queued`. Written only after the Cloud Tasks enqueue call itself has already succeeded — never before, so a job never claims to be queued when it is not. */
export function markProcessingJobQueued(job: ProcessingJob, now: Date): ProcessingJob {
  requireState(job, ['requested'], 'markProcessingJobQueued');

  return {
    ...job,
    state: 'queued',
    queuedAt: now,
    revision: job.revision + 1,
    updatedAt: now,
  };
}

/** `queued` -> `running`. Reserved for a worker that reports start separately from its terminal result. */
export function markProcessingJobRunning(job: ProcessingJob, now: Date): ProcessingJob {
  requireState(job, ['queued'], 'markProcessingJobRunning');

  return { ...job, state: 'running', revision: job.revision + 1, updatedAt: now };
}

export interface ProcessingJobResultInput {
  readonly outcomeCode: string;
  readonly outputObjects?: readonly ProcessingJobOutputObject[];
  readonly resultSummary?: Record<string, unknown>;
  readonly qualityDiagnostics?: Record<string, unknown> | null;
  readonly resourceMetrics?: ProcessingJobResourceMetrics | null;
}

function completeJob(
  job: ProcessingJob,
  state: ProcessingJobState,
  result: ProcessingJobResultInput,
  now: Date,
): ProcessingJob {
  return {
    ...job,
    state,
    outputObjects: result.outputObjects ?? job.outputObjects,
    resultSummary: result.resultSummary ?? job.resultSummary,
    qualityDiagnostics: result.qualityDiagnostics ?? job.qualityDiagnostics,
    resourceMetrics: result.resourceMetrics ?? job.resourceMetrics,
    outcomeCode: result.outcomeCode,
    completedAt: now,
    revision: job.revision + 1,
    updatedAt: now,
  };
}

/** `queued`/`running` -> `succeeded`. This stage's own real terminal transition — see this file's header comment. */
export function markProcessingJobSucceeded(
  job: ProcessingJob,
  result: ProcessingJobResultInput,
  now: Date,
): ProcessingJob {
  requireState(job, ['queued', 'running'], 'markProcessingJobSucceeded');
  return completeJob(job, 'succeeded', result, now);
}

/** `queued`/`running` -> `partial`. */
export function markProcessingJobPartial(
  job: ProcessingJob,
  result: ProcessingJobResultInput,
  now: Date,
): ProcessingJob {
  requireState(job, ['queued', 'running'], 'markProcessingJobPartial');
  return completeJob(job, 'partial', result, now);
}

/** `queued`/`running` -> `failed_retryable`. Records a retryable failure without yet retrying it — `retryProcessingJob` performs the diagram's own `failed_retryable -> queued` edge as a separate step. No live caller this stage. */
export function markProcessingJobFailedRetryable(
  job: ProcessingJob,
  result: ProcessingJobResultInput,
  now: Date,
): ProcessingJob {
  requireState(job, ['queued', 'running'], 'markProcessingJobFailedRetryable');
  return completeJob(job, 'failed_retryable', result, now);
}

/** `failed_retryable` -> `queued`. The diagram's own retry edge; increments `attempt` per section 13's own field and asynchronous-processing.md section 10's "Transitions use expected attempt/revision checks." No live caller this stage. */
export function retryProcessingJob(job: ProcessingJob, now: Date): ProcessingJob {
  requireState(job, ['failed_retryable'], 'retryProcessingJob');

  return {
    ...job,
    state: 'queued',
    attempt: job.attempt + 1,
    outcomeCode: null,
    queuedAt: now,
    completedAt: null,
    revision: job.revision + 1,
    updatedAt: now,
  };
}

/** `queued`/`running` -> `failed_terminal`. Used for invalid or malicious media. */
export function markProcessingJobFailedTerminal(
  job: ProcessingJob,
  result: ProcessingJobResultInput,
  now: Date,
): ProcessingJob {
  requireState(job, ['queued', 'running'], 'markProcessingJobFailedTerminal');
  return completeJob(job, 'failed_terminal', result, now);
}

/** `queued`/`running` -> `cancelled`. */
export function markProcessingJobCancelled(
  job: ProcessingJob,
  result: ProcessingJobResultInput,
  now: Date,
): ProcessingJob {
  requireState(job, ['queued', 'running'], 'markProcessingJobCancelled');
  return completeJob(job, 'cancelled', result, now);
}

/** `queued` -> `expired`. The diagram draws this edge only from `queued`, never from `running`. No live caller this stage. */
export function markProcessingJobExpired(job: ProcessingJob, now: Date): ProcessingJob {
  requireState(job, ['queued'], 'markProcessingJobExpired');

  return {
    ...job,
    state: 'expired',
    outcomeCode: 'expired',
    completedAt: now,
    revision: job.revision + 1,
    updatedAt: now,
  };
}

/** `true` once a job has reached any state the diagram draws with no outgoing edge. */
export function isProcessingJobTerminal(job: ProcessingJob): boolean {
  return TERMINAL_STATES.has(job.state);
}
