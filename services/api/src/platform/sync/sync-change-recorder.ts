/**
 * Port for appending rows to `platform.sync_change` — the ordered,
 * per-garden change log the offline synchronization protocol's pull
 * endpoint (`GET /v1/sync/changes`, not yet built) will resume from.
 *
 * True platform-level, module-agnostic infrastructure, the same shape as
 * `OutboxAppender`: every garden-scoped module that mutates a record needs
 * this, so it lives once here rather than being reimplemented per module —
 * replacing the module-local, incomplete `gardens-mapping`-only
 * `SyncChangeWriter`/`KyselySyncChangeWriter` this stage retired.
 *
 * Source: architecture/backend-modular-monolith.md, section "12. Transactions"
 * ("Domain state and its outbox events commit atomically", the same rule
 * applied here to sync changes); architecture/data-and-geospatial-design.md,
 * section "16. Synchronization Change Log"; architecture/offline-synchronization.md.
 */

import type { Uuid } from '../../shared/identifiers/uuid.js';
import type { SyncRecordType } from './sync-record-type.js';

export type SyncChangeOperation = 'upsert' | 'delete';

export interface SyncChangeInput {
  /** `null` only for a record with no owning garden — every writer this codebase has today always supplies one, since every mutable record in this service is garden-scoped, but the column itself is nullable (see the migration's own comment on `platform.sync_change.garden_id`). */
  readonly gardenId: Uuid | null;
  readonly recordId: Uuid;
  readonly recordType: SyncRecordType;
  readonly operation: SyncChangeOperation;
  readonly recordRevision: number;
  /**
   * P8-DELETE-01: omit (or `null`) for an ordinary record change — every
   * profile the visibility rule admits receives it, the meaning every writer
   * before this had. Supply a profile id only for a change that concerns ONE
   * member and would be actively wrong for the others: membership revocation
   * and restoration, where the revoked collaborator must purge the garden
   * locally while the owner deciding whether to withdraw the request must
   * not. See the deletion baseline migration's own comment.
   */
  readonly targetProfileId?: Uuid | null;
}

export interface SyncChangeRecorder {
  /**
   * Appends one row. Must be called with a transaction-scoped handle bound
   * to the same transaction as the record's own write, so the two commit or
   * roll back together — the same rule `OutboxAppender.append` documents for
   * its own table.
   */
  record(input: SyncChangeInput): Promise<void>;
}
