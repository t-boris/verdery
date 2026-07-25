import type { Kysely, Selectable } from 'kysely';
import type { DatabaseSchema } from '../../../platform/database/database-gateway.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type {
  DeletionRecordRepository,
  PurgeCheckpoint,
} from '../application/deletion-record-repository.js';
import type {
  DeletionRecord,
  DeletionRecordState,
  DeletionSubjectType,
} from '../domain/deletion-record.js';
import type { DeletionRecordRow } from './schema.js';

function toDeletionRecord(row: Selectable<DeletionRecordRow>): DeletionRecord {
  return {
    id: row.id,
    subjectType: row.subject_type as DeletionSubjectType,
    subjectId: row.subject_id,
    requestedByProfileId: row.requested_by_profile_id,
    state: row.state as DeletionRecordState,
    requestedAt: row.requested_at,
    recoveryDeadlineAt: row.recovery_deadline_at,
    purgeStartedAt: row.purge_started_at,
    completedAt: row.completed_at,
    attemptCount: row.attempt_count,
    deferredReason: row.deferred_reason,
    mediaRecordsScheduled: row.media_records_scheduled,
    identityProviderDeletedAt: row.identity_provider_deleted_at,
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class KyselyDeletionRecordRepository implements DeletionRecordRepository {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  async findBySubject(
    subjectType: DeletionSubjectType,
    subjectId: Uuid,
  ): Promise<DeletionRecord | null> {
    const row = await this.db
      .selectFrom('deletion.deletion_record')
      .selectAll()
      .where('subject_type', '=', subjectType)
      .where('subject_id', '=', subjectId)
      .executeTakeFirst();

    return row === undefined ? null : toDeletionRecord(row);
  }

  async insert(record: DeletionRecord): Promise<void> {
    await this.db
      .insertInto('deletion.deletion_record')
      .values({
        id: record.id,
        subject_type: record.subjectType,
        subject_id: record.subjectId,
        requested_by_profile_id: record.requestedByProfileId,
        state: record.state,
        requested_at: record.requestedAt,
        recovery_deadline_at: record.recoveryDeadlineAt,
        purge_started_at: record.purgeStartedAt,
        completed_at: record.completedAt,
        attempt_count: record.attemptCount,
        deferred_reason: record.deferredReason,
        media_records_scheduled: record.mediaRecordsScheduled,
        identity_provider_deleted_at: record.identityProviderDeletedAt,
        revision: record.revision,
        created_at: record.createdAt,
        updated_at: record.updatedAt,
      })
      .execute();
  }

  async update(record: DeletionRecord, expectedRevision: number): Promise<boolean> {
    const result = await this.db
      .updateTable('deletion.deletion_record')
      .set({
        state: record.state,
        completed_at: record.completedAt,
        attempt_count: record.attemptCount,
        deferred_reason: record.deferredReason,
        media_records_scheduled: record.mediaRecordsScheduled,
        identity_provider_deleted_at: record.identityProviderDeletedAt,
        revision: record.revision,
        updated_at: record.updatedAt,
      })
      .where('id', '=', record.id)
      .where('revision', '=', expectedRevision)
      .executeTakeFirst();

    return (result?.numUpdatedRows ?? 0n) === 1n;
  }

  async listUnfinished(limit: number): Promise<DeletionRecord[]> {
    const rows = await this.db
      .selectFrom('deletion.deletion_record')
      .selectAll()
      .where('state', '=', 'purging')
      .orderBy('purge_started_at', 'asc')
      .limit(limit)
      .execute();

    return rows.map(toDeletionRecord);
  }

  async listCheckpoints(deletionId: Uuid): Promise<PurgeCheckpoint[]> {
    const rows = await this.db
      .selectFrom('deletion.purge_checkpoint')
      .select(['step_name', 'rows_deleted', 'completed_at'])
      .where('deletion_id', '=', deletionId)
      .execute();

    return rows.map((row) => ({
      stepName: row.step_name,
      rowsDeleted: row.rows_deleted,
      completedAt: row.completed_at,
    }));
  }

  async recordCheckpoint(deletionId: Uuid, checkpoint: PurgeCheckpoint): Promise<void> {
    await this.db
      .insertInto('deletion.purge_checkpoint')
      .values({
        deletion_id: deletionId,
        step_name: checkpoint.stepName,
        rows_deleted: checkpoint.rowsDeleted,
        completed_at: checkpoint.completedAt,
      })
      // See the port's own comment: the first recorded count is the real one.
      .onConflict((conflict) => conflict.columns(['deletion_id', 'step_name']).doNothing())
      .execute();
  }
}
