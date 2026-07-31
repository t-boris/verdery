/**
 * Transaction boundary for observations-history commands.
 *
 * `RecordObservation` and `CorrectObservation` are the only commands this
 * module has this pass, and both need their observation row, its photo rows,
 * their stubbed image-analysis-result rows, their measurement rows, their
 * sync-change entry, and the idempotency record to commit or roll back
 * together. `media` (the read-only check against `media.media_record`),
 * `plants` (the read-only check against `plants_inventory.plant`), and
 * `gardenContextFacts` (the read-only resolve of the garden's current
 * context snapshot, P11-MEDIA-01 — see
 * `resolve-observed-context-snapshot.ts`) are bound to the same transaction
 * too, purely so every read observes the same snapshot the writes commit
 * into — not because any of the three is ever written to from here.
 * `syncChanges` is the platform-level `SyncChangeRecorder` (see
 * `platform/sync/sync-change-recorder.ts`), not a module-local port.
 *
 * Unlike `gardens-mapping`'s own unit of work, there is no outbox appender
 * and no audit logger here: this module mirrors `media`'s deliberately
 * minimal transactional shape (see `media/application/media-unit-of-work.ts`)
 * rather than gardens-mapping's fuller one — neither eventing nor an audit
 * trail is specified for this module this pass. `syncChanges` is the one
 * exception to that minimalism: every garden-scoped mutation needs it, per
 * this stage's own scope, regardless of a module's outbox/audit posture.
 *
 * Source: architecture/backend-modular-monolith.md, section "12. Transactions".
 */

import type { IdempotencyStore } from '../../../platform/idempotency/idempotency-store.js';
import type { SyncChangeRecorder } from '../../../platform/sync/sync-change-recorder.js';
import type { GardenContextFactRepository } from '../../gardens-mapping/public.js';
import type { MediaRepository } from '../../media/public.js';
import type { ImageAnalysisResultRepository } from './image-analysis-result-repository.js';
import type { ObservationMeasurementRepository } from './observation-measurement-repository.js';
import type { ObservationPhotoRepository } from './observation-photo-repository.js';
import type { ObservationRepository } from './observation-repository.js';
import type { PlantOwnershipRepository } from './plant-ownership-repository.js';

export interface ObservationsHistoryTransactionContext {
  readonly observations: ObservationRepository;
  readonly observationPhotos: ObservationPhotoRepository;
  readonly imageAnalysisResults: ImageAnalysisResultRepository;
  readonly observationMeasurements: ObservationMeasurementRepository;
  readonly plants: PlantOwnershipRepository;
  readonly media: MediaRepository;
  readonly gardenContextFacts: GardenContextFactRepository;
  readonly idempotency: IdempotencyStore;
  readonly syncChanges: SyncChangeRecorder;
}

export interface ObservationsHistoryUnitOfWork {
  run<T>(work: (context: ObservationsHistoryTransactionContext) => Promise<T>): Promise<T>;
}
