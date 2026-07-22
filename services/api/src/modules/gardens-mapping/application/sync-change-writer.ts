import type { Uuid } from '../../../shared/identifiers/uuid.js';

export type SyncChangeOperation = 'upsert' | 'delete';

export interface SyncChangeEntry {
  readonly gardenId: Uuid;
  readonly recordId: Uuid;
  readonly recordType: string;
  readonly operation: SyncChangeOperation;
  readonly recordRevision: number;
}

/**
 * Appends one row to `platform.sync_change` per accepted map command — the
 * ordered change log the offline synchronization protocol resumes from.
 * Garden lifecycle commands do not populate this table yet (see the
 * migration's comment on the table); map commands are where this work
 * package first makes it a real write path, per its own title ("...
 * validation, history, sync change, and outbox event").
 *
 * Source: architecture/data-and-geospatial-design.md, section
 * "16. Synchronization Change Log"; architecture/offline-synchronization.md.
 */
export interface SyncChangeWriter {
  record(entry: SyncChangeEntry): Promise<void>;
}
