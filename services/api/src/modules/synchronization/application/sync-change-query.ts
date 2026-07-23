/**
 * Read port over `platform.sync_change` for `GetSyncChanges` (P5-BE-02).
 *
 * The write side (`platform/sync/sync-change-recorder.ts`) is true
 * platform-level infrastructure every mutating module depends on — this read
 * side is not: only this module ever needs to page through the change log,
 * so it lives here, not under `platform/sync/`, mirroring how a repository
 * lives inside the one module that reads its table rather than in shared
 * infrastructure just because the table itself is platform-owned.
 *
 * `listAfter`'s garden-visibility split (`activeGardenIds` versus
 * `tombstoneOnlyGardenIds`) is what makes a revoked garden's own tombstone
 * survive the authorization filter that hides everything else about that
 * garden — see `get-sync-changes.ts`'s own header comment for the full
 * reasoning; this port only needs to know the two lists are different, not
 * why.
 */

import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { SyncRecordType } from '../../../platform/sync/sync-record-type.js';

export interface SyncChangeQueryInput {
  /** Gardens the caller currently has active membership on — every change for these is visible. */
  readonly activeGardenIds: readonly Uuid[];
  /** Gardens the caller has some (non-active) membership history for but no longer active access to — only that garden's own `record: 'garden'`, `operation: 'delete'` tombstone is visible from these. */
  readonly tombstoneOnlyGardenIds: readonly Uuid[];
  /** Resume strictly after this `sequence` — `0` for a first-ever pull. */
  readonly afterSequence: number;
  readonly limit: number;
}

export interface SyncChangeRecord {
  readonly sequence: number;
  readonly gardenId: Uuid | null;
  readonly recordId: Uuid;
  readonly recordType: SyncRecordType;
  readonly operation: 'upsert' | 'delete';
  readonly recordRevision: number;
  readonly committedAt: Date;
}

export interface SyncChangeQuery {
  /** Deterministic sequence-ascending order, bounded by `limit`. */
  listAfter(input: SyncChangeQueryInput): Promise<SyncChangeRecord[]>;
}
