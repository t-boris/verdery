/**
 * Transaction boundary for observations-history commands.
 *
 * `RecordObservation` and `CorrectObservation` are the only commands this
 * module has this pass, and both need their observation row, its photo rows,
 * their stubbed image-analysis-result rows, and the idempotency record to
 * commit or roll back together. `media` (the read-only check against
 * `media.media_record`) and `plants` (the read-only check against
 * `plants_inventory.plant`) are bound to the same transaction too, purely so
 * both reads observe the same snapshot the writes commit into — not because
 * either is ever written to from here.
 *
 * Unlike `gardens-mapping`'s own unit of work, there is no outbox appender
 * and no audit logger here: this module mirrors `media`'s deliberately
 * minimal transactional shape (see `media/application/media-unit-of-work.ts`)
 * rather than gardens-mapping's fuller one — neither eventing nor an audit
 * trail is specified for this module this pass.
 *
 * Source: architecture/backend-modular-monolith.md, section "12. Transactions".
 */

import type { IdempotencyStore } from '../../../platform/idempotency/idempotency-store.js';
import type { MediaRepository } from '../../media/public.js';
import type { ImageAnalysisResultRepository } from './image-analysis-result-repository.js';
import type { ObservationPhotoRepository } from './observation-photo-repository.js';
import type { ObservationRepository } from './observation-repository.js';
import type { PlantOwnershipRepository } from './plant-ownership-repository.js';

export interface ObservationsHistoryTransactionContext {
  readonly observations: ObservationRepository;
  readonly observationPhotos: ObservationPhotoRepository;
  readonly imageAnalysisResults: ImageAnalysisResultRepository;
  readonly plants: PlantOwnershipRepository;
  readonly media: MediaRepository;
  readonly idempotency: IdempotencyStore;
}

export interface ObservationsHistoryUnitOfWork {
  run<T>(work: (context: ObservationsHistoryTransactionContext) => Promise<T>): Promise<T>;
}
