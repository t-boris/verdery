import type { Kysely } from 'kysely';
import type { DatabaseSchema } from '../database/database-gateway.js';
import type { SyncChangeInput, SyncChangeRecorder } from './sync-change-recorder.js';

/**
 * No injected `Clock` here, unlike `KyselyOutboxAppender`: `committed_at`
 * carries a database-side `DEFAULT now()` (see the migration), and this
 * table has no equivalent of the outbox's own `occurred_at` field that a
 * caller might need to control for a test — `sequence`, the column tests
 * actually assert ordering against, is the identity column, not this one.
 */
export class KyselySyncChangeRecorder implements SyncChangeRecorder {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  async record(input: SyncChangeInput): Promise<void> {
    await this.db
      .insertInto('platform.sync_change')
      .values({
        garden_id: input.gardenId,
        record_id: input.recordId,
        record_type: input.recordType,
        operation: input.operation,
        record_revision: input.recordRevision,
      })
      .execute();
  }
}
