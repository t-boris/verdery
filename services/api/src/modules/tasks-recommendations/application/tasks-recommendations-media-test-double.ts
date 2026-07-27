/**
 * `FakeMediaRepository`, split out of `tasks-recommendations-test-doubles.ts`
 * purely to keep that file under the repository's 600-line source limit —
 * the same "factor out, keep the seam small" discipline this module's own
 * `recommendation-test-doubles.ts` split already established. Backs
 * `context.media` (`TasksRecommendationsTransactionContext`), the port
 * `AttachTaskFile` validates a `mediaId` against — see that context
 * interface's own header for the full "bound here even though this module
 * does not own the table" reasoning.
 */

import type { MediaRecord, MediaRepository } from '../../media/public.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';

export class FakeMediaRepository implements MediaRepository {
  readonly records = new Map<Uuid, MediaRecord>();

  insert(record: MediaRecord): Promise<void> {
    this.records.set(record.id, record);
    return Promise.resolve();
  }

  get(id: Uuid): Promise<MediaRecord | null> {
    return Promise.resolve(this.records.get(id) ?? null);
  }

  /** No real lock in memory — same read as `get`, matching the media module's own fake. */
  getForShare(id: Uuid): Promise<MediaRecord | null> {
    return this.get(id);
  }

  update(): Promise<boolean> {
    throw new Error('not used by this test');
  }

  findDerivative(): Promise<MediaRecord | null> {
    throw new Error('not used by this test');
  }

  listForGarden(): ReturnType<MediaRepository['listForGarden']> {
    throw new Error('not used by this test');
  }

  listDisplayDerivatives(): Promise<readonly MediaRecord[]> {
    throw new Error('not used by this test');
  }

  listPurgeCandidates(): Promise<readonly MediaRecord[]> {
    throw new Error('not used by this test');
  }

  countUndeletedForPurge(): Promise<number> {
    throw new Error('not used by this test');
  }

  scheduleDerivativesForDeletion(): Promise<number> {
    throw new Error('not used by this test');
  }

  markScheduledDerivativesDeleted(): Promise<number> {
    throw new Error('not used by this test');
  }

  listRetentionExpired(): Promise<readonly MediaRecord[]> {
    throw new Error('not used by this test');
  }

  listStaleUploads(): Promise<readonly MediaRecord[]> {
    throw new Error('not used by this test');
  }
}
