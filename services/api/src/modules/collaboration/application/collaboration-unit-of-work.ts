/**
 * Transaction boundary for collaboration commands (P9B-API-01).
 *
 * Every port a command handler needs is bound to the same transaction, so an
 * organization's new membership row, a garden assignment, a client
 * engagement, its outbox event, its audit record, and its idempotency record
 * commit or roll back together — the same "domain state and its outbox
 * events commit atomically" requirement
 * `GardensMappingTransactionContext`'s own header names.
 *
 * NO `gardens` REPOSITORY BOUND HERE. `CreateGardenAssignment` and
 * `CreateClientEngagement` both need to check that a referenced
 * `gardenId` actually exists, but that check is a plain, non-transactional
 * read against `gardens-mapping`'s own `GardenRepository` — the same
 * "read paths use the pooled connection directly" posture
 * `compose-gardens-mapping.ts`'s own comment documents for every read in
 * that module. Those commands take `GardenRepository` as a separate
 * constructor dependency instead, exactly like `GetGardenMap` takes its own
 * read repositories directly rather than through a unit of work.
 *
 * Source: architecture/backend-modular-monolith.md, section "12. Transactions".
 */

import type { AuditLogger } from '../../../platform/audit/audit-logger.js';
import type { IdempotencyStore } from '../../../platform/idempotency/idempotency-store.js';
import type { OutboxAppender } from '../../../platform/outbox/outbox-appender.js';
import type { ClientEngagementRepository } from './client-engagement-repository.js';
import type { ClientUpdateItemRepository } from './client-update-item-repository.js';
import type { ClientUpdateRepository } from './client-update-repository.js';
import type { GardenAssignmentRepository } from './garden-assignment-repository.js';
import type { OrganizationMembershipRepository } from './organization-membership-repository.js';
import type { OrganizationRepository } from './organization-repository.js';
import type { PublicationRepository } from './publication-repository.js';
import type { PublisherGrantRepository } from './publisher-grant-repository.js';
import type { WorkLogRepository } from './work-log-repository.js';

export interface CollaborationTransactionContext {
  readonly organizations: OrganizationRepository;
  readonly organizationMemberships: OrganizationMembershipRepository;
  readonly gardenAssignments: GardenAssignmentRepository;
  readonly clientEngagements: ClientEngagementRepository;
  /** P9C-PUBLISH-01: the separate publisher capability, the client-update draft/staging tables, and the immutable publication writer — bound to the same transaction as every P9B repository above. */
  readonly publisherGrants: PublisherGrantRepository;
  readonly clientUpdates: ClientUpdateRepository;
  readonly clientUpdateItems: ClientUpdateItemRepository;
  readonly workLogs: WorkLogRepository;
  readonly publications: PublicationRepository;
  readonly idempotency: IdempotencyStore;
  readonly outbox: OutboxAppender;
  readonly auditLogger: AuditLogger;
}

export interface CollaborationUnitOfWork {
  run<T>(work: (context: CollaborationTransactionContext) => Promise<T>): Promise<T>;
}
