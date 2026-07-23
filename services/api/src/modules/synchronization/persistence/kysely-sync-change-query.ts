import type { ExpressionBuilder } from 'kysely';
import type { Kysely } from 'kysely';
import type { DatabaseSchema } from '../../../platform/database/database-gateway.js';
import type { SyncRecordType } from '../../../platform/sync/sync-record-type.js';
import type {
  SyncChangeQuery,
  SyncChangeQueryInput,
  SyncChangeRecord,
} from '../application/sync-change-query.js';

interface SyncChangeRowLike {
  sequence: number;
  garden_id: string | null;
  record_id: string;
  record_type: string;
  operation: 'upsert' | 'delete';
  record_revision: number;
  committed_at: Date;
}

function toSyncChangeRecord(row: SyncChangeRowLike): SyncChangeRecord {
  return {
    sequence: row.sequence,
    gardenId: row.garden_id,
    recordId: row.record_id,
    recordType: row.record_type as SyncRecordType,
    operation: row.operation,
    recordRevision: row.record_revision,
    committedAt: row.committed_at,
  };
}

export class KyselySyncChangeQuery implements SyncChangeQuery {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  async listAfter(input: SyncChangeQueryInput): Promise<SyncChangeRecord[]> {
    const { activeGardenIds, tombstoneOnlyGardenIds, afterSequence, limit } = input;

    if (activeGardenIds.length === 0 && tombstoneOnlyGardenIds.length === 0) {
      // No garden is visible at all — not even by way of a revocation
      // tombstone — so there is nothing this profile could see. Skipped as
      // its own early return rather than falling through to a query that
      // would build an always-false `OR` with no branches.
      return [];
    }

    const rows = await this.db
      .selectFrom('platform.sync_change')
      .selectAll()
      .where('sequence', '>', afterSequence)
      .where((eb) => this.visibilityCondition(eb, activeGardenIds, tombstoneOnlyGardenIds))
      .orderBy('sequence', 'asc')
      .limit(limit)
      .execute();

    return rows.map(toSyncChangeRecord);
  }

  /**
   * "Visible for the ordinary reason (active membership)" OR "visible for
   * the narrow tombstone-only reason (this row IS the garden's own removal
   * tombstone)" — see this module's `sync-change-query.ts`'s own header
   * comment. Either branch is omitted entirely when its own garden-id list is
   * empty, rather than emitting a `garden_id IN ()` Postgres would reject.
   */
  private visibilityCondition(
    eb: ExpressionBuilder<DatabaseSchema, 'platform.sync_change'>,
    activeGardenIds: readonly string[],
    tombstoneOnlyGardenIds: readonly string[],
  ) {
    const branches = [];

    if (activeGardenIds.length > 0) {
      branches.push(eb('garden_id', 'in', activeGardenIds));
    }

    if (tombstoneOnlyGardenIds.length > 0) {
      branches.push(
        eb.and([
          eb('garden_id', 'in', tombstoneOnlyGardenIds),
          eb('operation', '=', 'delete'),
          eb('record_type', '=', 'garden'),
        ]),
      );
    }

    return eb.or(branches);
  }
}
