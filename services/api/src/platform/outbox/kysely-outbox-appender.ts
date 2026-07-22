import type { Kysely } from 'kysely';
import type { DatabaseSchema } from '../database/database-gateway.js';
import { generateUuidV7 } from '../../shared/identifiers/uuid.js';
import type { Clock } from '../../shared/time/clock.js';
import type { OutboxAppender, OutboxEventInput } from './outbox-appender.js';

/** No relay publishes these events yet in Phase 2; see the migration's comment on this table. */
export class KyselyOutboxAppender implements OutboxAppender {
  constructor(
    private readonly db: Kysely<DatabaseSchema>,
    private readonly clock: Clock,
  ) {}

  async append(input: OutboxEventInput): Promise<void> {
    await this.db
      .insertInto('platform.outbox_event')
      .values({
        id: generateUuidV7(),
        event_type: input.eventType,
        event_version: 1,
        aggregate_type: input.aggregateType,
        aggregate_id: input.aggregateId,
        payload: JSON.stringify(input.payload),
        trace_id: input.traceId ?? null,
        occurred_at: this.clock.now(),
      })
      .execute();
  }
}
