import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { DeletionRecord, DeletionSubjectType } from '../domain/deletion-record.js';

/** One step's recorded outcome — the resume point and the evidence in one row. */
export interface PurgeCheckpoint {
  readonly stepName: string;
  readonly rowsDeleted: number;
  readonly completedAt: Date;
}

export interface DeletionRecordRepository {
  findBySubject(subjectType: DeletionSubjectType, subjectId: Uuid): Promise<DeletionRecord | null>;

  /**
   * Inserts the claim. Throws on a `(subject_type, subject_id)` conflict
   * rather than upserting: two sweep passes racing to claim the same subject
   * is exactly the case the unique index exists to decide, and the loser must
   * know it lost rather than silently overwrite the winner's progress.
   */
  insert(record: DeletionRecord): Promise<void>;

  /** Revision-guarded, returning `false` on a lost race — the `GardenRepository.update` contract. */
  update(record: DeletionRecord, expectedRevision: number): Promise<boolean>;

  /** Every purge still unfinished, oldest claim first — the sweep's resume set. */
  listUnfinished(limit: number): Promise<DeletionRecord[]>;

  /** The steps this purge has already completed, so a resumed pass skips them. */
  listCheckpoints(deletionId: Uuid): Promise<PurgeCheckpoint[]>;

  /**
   * Records one completed step. Idempotent under replay: a step recorded
   * twice keeps the FIRST count, because re-running a converged step deletes
   * zero rows and overwriting the real number with zero would turn the
   * evidence into a lie.
   */
  recordCheckpoint(deletionId: Uuid, checkpoint: PurgeCheckpoint): Promise<void>;
}
