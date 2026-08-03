import type { Kysely } from 'kysely';
import type { DatabaseSchema } from '../../../platform/database/database-gateway.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type {
  ProcessingJob,
  ProcessingJobOutputObject,
  ProcessingJobResourceMetrics,
  ProcessingJobState,
} from '../domain/processing-job.js';
import type { ProcessingJobRepository } from '../application/processing-job-repository.js';

interface ProcessingJobRowLike {
  id: string;
  media_id: string;
  job_kind: string;
  processor_config_version: string;
  state: string;
  attempt: number;
  input_checksums: unknown;
  output_objects: unknown;
  result_summary: unknown;
  quality_diagnostics: unknown;
  resource_metrics: unknown;
  outcome_code: string | null;
  trace_id: string | null;
  revision: number;
  created_at: Date;
  queued_at: Date | null;
  completed_at: Date | null;
  updated_at: Date;
}

/**
 * `input_checksums` is `jsonb`, and a blind `as string[]` on it turns bad data
 * into a `TypeError` three call frames away rather than a failure that names
 * itself. That is not hypothetical: a writer that bound a JS array instead of
 * serialized JSON made pg send the Postgres array literal, and the EMPTY case
 * `{}` parses as a perfectly valid JSON object — so one row was stored as an
 * object, read back as one, and blew up in a domain rule with
 * "inputChecksums.some is not a function".
 *
 * Narrowing here costs one check and makes the same corruption legible.
 * Anything that is not an array of strings is treated as no expected
 * checksums, which is the safe direction: it can only make the verification
 * in `requireSuccessfulInputChecksums` more permissive, never wrongly reject a
 * result that was actually correct.
 */
function toChecksumArray(value: unknown): readonly string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string') ? value : [];
}

function toProcessingJob(row: ProcessingJobRowLike): ProcessingJob {
  return {
    id: row.id,
    mediaId: row.media_id,
    jobKind: row.job_kind,
    processorConfigVersion: row.processor_config_version,
    state: row.state as ProcessingJobState,
    attempt: row.attempt,
    inputChecksums: toChecksumArray(row.input_checksums),
    outputObjects: row.output_objects as readonly ProcessingJobOutputObject[] | null,
    resultSummary: row.result_summary as Record<string, unknown> | null,
    qualityDiagnostics: row.quality_diagnostics as Record<string, unknown> | null,
    resourceMetrics: row.resource_metrics as ProcessingJobResourceMetrics | null,
    outcomeCode: row.outcome_code,
    traceId: row.trace_id,
    revision: row.revision,
    createdAt: row.created_at,
    queuedAt: row.queued_at,
    completedAt: row.completed_at,
    updatedAt: row.updated_at,
  };
}

export class KyselyProcessingJobRepository implements ProcessingJobRepository {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  async insert(job: ProcessingJob): Promise<void> {
    await this.db
      .insertInto('media.processing_job')
      .values({
        id: job.id,
        media_id: job.mediaId,
        job_kind: job.jobKind,
        processor_config_version: job.processorConfigVersion,
        state: job.state,
        attempt: job.attempt,
        input_checksums: JSON.stringify(job.inputChecksums),
        output_objects: job.outputObjects === null ? null : JSON.stringify(job.outputObjects),
        result_summary: job.resultSummary === null ? null : JSON.stringify(job.resultSummary),
        quality_diagnostics:
          job.qualityDiagnostics === null ? null : JSON.stringify(job.qualityDiagnostics),
        resource_metrics: job.resourceMetrics === null ? null : JSON.stringify(job.resourceMetrics),
        outcome_code: job.outcomeCode,
        trace_id: job.traceId,
        revision: job.revision,
        created_at: job.createdAt,
        queued_at: job.queuedAt,
        completed_at: job.completedAt,
        updated_at: job.updatedAt,
      })
      .execute();
  }

  async get(id: Uuid): Promise<ProcessingJob | null> {
    const row = await this.db
      .selectFrom('media.processing_job')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();

    return row === undefined ? null : toProcessingJob(row);
  }

  /** See the port's own doc comment — served by the migration's partial non-terminal-state index. */
  async listActiveForMedia(mediaId: Uuid): Promise<readonly ProcessingJob[]> {
    const rows = await this.db
      .selectFrom('media.processing_job')
      .selectAll()
      .where('media_id', '=', mediaId)
      .where('state', 'in', ['requested', 'queued', 'running'])
      .orderBy('created_at', 'asc')
      .execute();

    return rows.map(toProcessingJob);
  }

  async updateState(job: ProcessingJob, expectedRevision: number): Promise<boolean> {
    const result = await this.db
      .updateTable('media.processing_job')
      .set({
        state: job.state,
        attempt: job.attempt,
        output_objects: job.outputObjects === null ? null : JSON.stringify(job.outputObjects),
        result_summary: job.resultSummary === null ? null : JSON.stringify(job.resultSummary),
        quality_diagnostics:
          job.qualityDiagnostics === null ? null : JSON.stringify(job.qualityDiagnostics),
        resource_metrics: job.resourceMetrics === null ? null : JSON.stringify(job.resourceMetrics),
        outcome_code: job.outcomeCode,
        revision: job.revision,
        queued_at: job.queuedAt,
        completed_at: job.completedAt,
        updated_at: job.updatedAt,
      })
      .where('id', '=', job.id)
      .where('revision', '=', expectedRevision)
      .executeTakeFirst();

    return result.numUpdatedRows > 0n;
  }
}
