import type { Kysely } from 'kysely';
import type { DatabaseSchema } from '../database/database-gateway.js';
import { generateUuidV7 } from '../../shared/identifiers/uuid.js';
import type { Clock } from '../../shared/time/clock.js';
import type { OutboxAppender, OutboxEventInput } from './outbox-appender.js';

/**
 * `services/workers`' own transactional-outbox relay (P6-ASYNC-01,
 * `src/relay/outbox-relay.ts` there) is the first, and so far only, reader
 * of this table — scoped to the `media.processing_requested` event type
 * this module's own `CompleteMediaUpload` appends. Every other event type
 * any module appends here (e.g. `garden.created`) still has no relay or
 * subscriber; this appender itself does not know or care which event types
 * are consumed downstream.
 */
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
