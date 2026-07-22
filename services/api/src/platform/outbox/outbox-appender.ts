/**
 * Port for appending domain events to the transactional outbox.
 *
 * Source: architecture/backend-modular-monolith.md, section "12. Transactions"
 * ("Domain state and its outbox events commit atomically");
 * architecture/data-and-geospatial-design.md, section "18. Transactional Outbox".
 */

import type { Uuid } from '../../shared/identifiers/uuid.js';

export interface OutboxEventInput {
  readonly eventType: string;
  readonly aggregateType: string;
  readonly aggregateId: Uuid;
  readonly payload: unknown;
  readonly traceId?: string;
}

export interface OutboxAppender {
  /**
   * Appends one event. Must be called with a transaction-scoped handle bound
   * to the same transaction as the aggregate's own write, so the two commit
   * or roll back together.
   */
  append(input: OutboxEventInput): Promise<void>;
}
