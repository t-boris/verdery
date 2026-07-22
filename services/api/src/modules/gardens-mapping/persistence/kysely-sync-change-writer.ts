import type { Kysely } from 'kysely';
import type { DatabaseSchema } from '../../../platform/database/database-gateway.js';
import type { SyncChangeEntry, SyncChangeWriter } from '../application/sync-change-writer.js';

export class KyselySyncChangeWriter implements SyncChangeWriter {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  async record(entry: SyncChangeEntry): Promise<void> {
    await this.db
      .insertInto('platform.sync_change')
      .values({
        garden_id: entry.gardenId,
        record_id: entry.recordId,
        record_type: entry.recordType,
        operation: entry.operation,
        record_revision: entry.recordRevision,
      })
      .execute();
  }
}
