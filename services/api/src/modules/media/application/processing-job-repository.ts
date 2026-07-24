import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { ProcessingJob } from '../domain/processing-job.js';

/**
 * Port for `media.processing_job`.
 *
 * `insert` exists in this API-owned port even though the API's own real
 * runtime path never calls it — the relay (`services/workers`) is what
 * creates a job row in production, through its own independent, narrowly
 * typed persistence (see that package's `src/relay/` for why it does not
 * import this file: the worker boundary forbids importing the running API
 * application, per architecture/backend-modular-monolith.md section
 * "19. Worker Boundary"). It is kept here anyway because
 * `record-media-processing-result.ts`'s own integration test legitimately
 * needs to seed a job row exactly the way the relay would, and doing that
 * through this module's own repository is more honest than duplicating
 * insert SQL in a test file — see `tests/integration/media-processing.test.ts`.
 *
 * `updateState` is revision-guarded like `MediaRepository.update`:
 * architecture/asynchronous-processing.md section "10. Job State Machine"
 * states "Transitions use expected attempt/revision checks. Late results
 * from superseded attempts cannot overwrite newer state" — `false` means the
 * expected revision no longer matched, not an exception.
 */
export interface ProcessingJobRepository {
  insert(job: ProcessingJob): Promise<void>;
  get(id: Uuid): Promise<ProcessingJob | null>;
  /** Writes `job` only if the stored row's current revision equals `expectedRevision`. Returns whether the write applied. */
  updateState(job: ProcessingJob, expectedRevision: number): Promise<boolean>;
}
