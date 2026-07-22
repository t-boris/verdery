import type { Geometry, MapCommandType } from '@verdery/geometry-contracts';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { MapObjectLifecycleState } from '../domain/map-object.js';

export interface RevisionJournalEntry {
  readonly gardenObjectId: Uuid;
  readonly revision: number;
  readonly commandType: MapCommandType;
  /** `null` when this command did not change geometry (a label rename, for example). */
  readonly geometry: Geometry | null;
  readonly label: string | null;
  readonly lifecycleState: MapObjectLifecycleState;
  readonly actorProfileId: Uuid;
}

/**
 * Writes one immutable row to `gardens_mapping.garden_object_revision` per
 * accepted command — what P3-DATA-01's "immutable revision journal" is for.
 * Every command handler calls this once, in the same transaction as its own
 * object write, alongside (never instead of) updating `garden_object`'s
 * current row.
 *
 * Source: migrations/1784800000000_garden-map-baseline.sql, comment on
 * `gardens_mapping.garden_object_revision`.
 */
export interface RevisionJournalWriter {
  record(entry: RevisionJournalEntry): Promise<void>;
}
