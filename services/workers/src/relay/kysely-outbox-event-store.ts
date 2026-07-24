import { MEDIA_PROCESSING_REQUESTED_EVENT_TYPE } from '@verdery/api-contracts';
import type { Kysely } from 'kysely';
import type { OutboxEventRecord, OutboxEventStore } from './outbox-event-store.js';
import type { RelayDatabaseSchema } from './relay-database-schema.js';

export class KyselyOutboxEventStore implements OutboxEventStore {
  constructor(private readonly db: Kysely<RelayDatabaseSchema>) {}

  async claimUnpublished(limit: number): Promise<readonly OutboxEventRecord[]> {
    const rows = await this.db
      .selectFrom('platform.outbox_event')
      .select(['id', 'aggregate_id', 'payload', 'trace_id'])
      .where('published_at', 'is', null)
      .where('event_type', '=', MEDIA_PROCESSING_REQUESTED_EVENT_TYPE)
      .orderBy('occurred_at', 'asc')
      .limit(limit)
      .execute();

    return rows.map((row) => ({
      id: row.id,
      aggregateId: row.aggregate_id,
      payload: row.payload,
      traceId: row.trace_id,
    }));
  }

  async markPublished(id: string, now: Date): Promise<void> {
    await this.db
      .updateTable('platform.outbox_event')
      .set((eb) => ({
        published_at: now,
        publish_attempts: eb('publish_attempts', '+', 1),
      }))
      .where('id', '=', id)
      .execute();
  }
}
