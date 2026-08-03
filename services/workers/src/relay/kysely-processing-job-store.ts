import type { Kysely } from 'kysely';
import type {
  EnsureRequestedInput,
  ProcessingJobStore,
  RelayProcessingJob,
  RelayProcessingJobState,
} from './processing-job-store.js';
import type { RelayDatabaseSchema } from './relay-database-schema.js';

function toRelayProcessingJob(row: {
  id: string;
  media_id: string;
  processor_config_version: string;
  state: string;
  job_kind: string;
}): RelayProcessingJob {
  return {
    id: row.id,
    mediaId: row.media_id,
    processorConfigVersion: row.processor_config_version,
    state: row.state as RelayProcessingJobState,
    jobKind: row.job_kind,
  };
}

export class KyselyProcessingJobStore implements ProcessingJobStore {
  constructor(private readonly db: Kysely<RelayDatabaseSchema>) {}

  async ensureRequested(input: EnsureRequestedInput, now: Date): Promise<RelayProcessingJob> {
    // `ON CONFLICT (id) DO NOTHING RETURNING *`: the concrete mechanism
    // behind "a relay run twice must not enqueue the same event twice" — see
    // `outbox-relay.ts`'s own header comment and `processing-job-store.ts`'s
    // own doc comment on this method.
    const inserted = await this.db
      .insertInto('media.processing_job')
      .values({
        id: input.id,
        media_id: input.mediaId,
        job_kind: input.jobKind,
        processor_config_version: input.processorConfigVersion,
        // `jsonb`, not a Postgres array: binding a JS array here makes pg
        // send the array literal `{}`, which Postgres then rejects with
        // `invalid input syntax for type json ... Expected ":", but found
        // "}"` — every outbox event failing at the same point, which reads
        // as a queue or permission fault rather than a serialization one.
        // `services/api`'s own repository for this same column already
        // stringifies; this side did not.
        input_checksums: JSON.stringify([...input.inputChecksums]),
        trace_id: input.traceId,
        updated_at: now,
      })
      .onConflict((oc) => oc.column('id').doNothing())
      .returning(['id', 'media_id', 'processor_config_version', 'state', 'job_kind'])
      .executeTakeFirst();

    if (inserted !== undefined) {
      return toRelayProcessingJob(inserted);
    }

    // A row already existed at this id (a previous tick, possibly one that
    // crashed before marking the triggering outbox row published) — read
    // its current state instead of assuming it is still `requested`.
    const existing = await this.db
      .selectFrom('media.processing_job')
      .select(['id', 'media_id', 'processor_config_version', 'state', 'job_kind'])
      .where('id', '=', input.id)
      .executeTakeFirstOrThrow();

    return toRelayProcessingJob(existing);
  }

  async markQueued(id: string, now: Date): Promise<void> {
    await this.db
      .updateTable('media.processing_job')
      .set((eb) => ({
        state: 'queued',
        queued_at: now,
        updated_at: now,
        revision: eb('revision', '+', 1),
      }))
      .where('id', '=', id)
      .where('state', '=', 'requested')
      .execute();
  }
}
