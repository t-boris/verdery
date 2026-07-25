/**
 * The deletion module's transaction boundary (P8-DELETE-01).
 *
 * Every port here except `deletionRecords` and `purge` belongs to another
 * module and arrives through that module's PUBLIC interface, bound to this
 * transaction — the composition pattern `ExportsTransactionContext.media`
 * already established, applied at wider scope because deletion is inherently
 * the one workflow that spans modules: an account deletion has to move the
 * profile, its memberships, and the gardens it solely owns in ONE transaction
 * or leave the three disagreeing about whether a deletion happened.
 *
 * `purge` is deliberately part of the transaction rather than a side channel:
 * a step's deletes and the checkpoint that records them commit together, so
 * the evidence can never claim a step that did not happen, and a crash
 * between the two is impossible rather than merely unlikely.
 */

import type { AuditLogger } from '../../../platform/audit/audit-logger.js';
import type { IdempotencyStore } from '../../../platform/idempotency/idempotency-store.js';
import type { OutboxAppender } from '../../../platform/outbox/outbox-appender.js';
import type { SyncChangeRecorder } from '../../../platform/sync/sync-change-recorder.js';
import type { GardenRepository, MembershipRepository } from '../../gardens-mapping/public.js';
import type { ProfileRepository } from '../../identity-access/public.js';
import type { DeletionRecordRepository } from './deletion-record-repository.js';
import type { PurgeExecutor } from './purge-executor.js';

export interface DeletionTransactionContext {
  readonly deletionRecords: DeletionRecordRepository;
  readonly gardens: GardenRepository;
  readonly profiles: ProfileRepository;
  readonly memberships: MembershipRepository;
  readonly purge: PurgeExecutor;
  readonly syncChanges: SyncChangeRecorder;
  readonly outbox: OutboxAppender;
  readonly auditLogger: AuditLogger;
  readonly idempotency: IdempotencyStore;
}

export interface DeletionUnitOfWork {
  run<T>(work: (context: DeletionTransactionContext) => Promise<T>): Promise<T>;
}
