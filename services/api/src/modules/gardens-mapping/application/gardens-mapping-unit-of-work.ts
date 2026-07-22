/**
 * Transaction boundary for gardens-mapping commands.
 *
 * Every port a command handler needs is bound to the same transaction, so a
 * garden's new state, its owner membership (creation only), its outbox
 * event, its audit record, and its idempotency record commit or roll back
 * together — "domain state and its outbox events commit atomically" is not
 * optional here the way the profile-provisioning audit shortcut is.
 *
 * Source: architecture/backend-modular-monolith.md, section "12. Transactions".
 */

import type { AuditLogger } from '../../../platform/audit/audit-logger.js';
import type { IdempotencyStore } from '../../../platform/idempotency/idempotency-store.js';
import type { OutboxAppender } from '../../../platform/outbox/outbox-appender.js';
import type { GardenRepository } from './garden-repository.js';
import type { MembershipRepository } from './membership-repository.js';

export interface GardensMappingTransactionContext {
  readonly gardens: GardenRepository;
  readonly memberships: MembershipRepository;
  readonly idempotency: IdempotencyStore;
  readonly outbox: OutboxAppender;
  readonly auditLogger: AuditLogger;
}

export interface GardensMappingUnitOfWork {
  run<T>(work: (context: GardensMappingTransactionContext) => Promise<T>): Promise<T>;
}
