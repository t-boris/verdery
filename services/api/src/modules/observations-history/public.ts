/**
 * Public interface of the observations-history module.
 *
 * Other modules and the composition root may import only from this file.
 *
 * Two different audiences use this file:
 *
 * - `tasks-recommendations` (built separately, immediately after this
 *   module) needs only the `Observation` domain type and `GetObservation`:
 *   the existence-check query it validates `task.origin_observation_id`
 *   against. Nothing else here is any of its concern.
 * - The composition root (`app.ts`) additionally needs the concrete classes
 *   below — `KyselyObservationRepository`,
 *   `KyselyObservationsHistoryUnitOfWork`, `RecordObservation`,
 *   `CorrectObservation`, `ListObservationsForGarden`,
 *   `ListObservationsForPlant` — to construct this module's dependency
 *   graph, the same way it already does for gardens-mapping and media.
 *
 * P4-CONTRACT-01 additionally lands this module's HTTP transport
 * (`registerObservationRoutes`, `ObservationRoutesDependencies`) against the
 * `Observations` tag `packages/api-contracts/openapi.yaml` now declares. No
 * new query or command was needed — every route maps onto a command or
 * query this module already had.
 *
 * Source: architecture/backend-modular-monolith.md, section "5.5 Public Interface".
 */

export type {
  Observation,
  ObservationActorType,
  ObservationCorrectionKind,
  ObservedContextSnapshot,
  ObservedDrainage,
  ObservedGrowingContext,
  ObservedPhenologicalStage,
  ObservedSunExposure,
} from './domain/observation.js';
export { OBSERVED_PHENOLOGICAL_STAGES } from './domain/observation.js';
export type { ObservationPhoto, ObservationPhotoPurpose } from './domain/observation-photo.js';
export { OBSERVATION_PHOTO_PURPOSES } from './domain/observation-photo.js';
export type {
  ObservationMeasurement,
  ObservationMeasurementKind,
} from './domain/observation-measurement.js';
export { OBSERVATION_MEASUREMENT_KINDS } from './domain/observation-measurement.js';
export type { ImageAnalysisKind, ImageAnalysisResult } from './domain/image-analysis-result.js';
export type {
  ObservationHistoryEntry,
  ObservationPhotoWithAnalysis,
  ObservationRepository,
} from './application/observation-repository.js';
export type { ObservationPhotoRepository } from './application/observation-photo-repository.js';
export type { ObservationMeasurementRepository } from './application/observation-measurement-repository.js';
export type { ImageAnalysisResultRepository } from './application/image-analysis-result-repository.js';
export type { PlantOwnershipRepository } from './application/plant-ownership-repository.js';
export type {
  ObservationsHistoryTransactionContext,
  ObservationsHistoryUnitOfWork,
} from './application/observations-history-unit-of-work.js';
export { ObservationErrorCode } from './application/observation-errors.js';
export type {
  ImageAnalysisResultResource,
  ObservationMeasurementResource,
  ObservationPhotoResource,
  ObservationResource,
} from './application/observation-view.js';
export type { ObservationPhotoAttachmentInput } from './application/attach-observation-photos.js';
export { RecordObservation } from './application/record-observation.js';
export type {
  ObservationMeasurementInput,
  RecordObservationInput,
} from './application/record-observation.js';
export { CorrectObservation } from './application/correct-observation.js';
export type { CorrectObservationInput } from './application/correct-observation.js';
export { ListObservationsForGarden } from './application/list-observations-for-garden.js';
export { ListObservationsForPlant } from './application/list-observations-for-plant.js';
export { GetObservation } from './application/get-observation.js';
export { GetObservationForSync } from './application/get-observation-for-sync.js';

export { registerObservationRoutes } from './transport/observation-routes.js';
export type { ObservationRoutesDependencies } from './transport/observation-routes.js';

export { KyselyImageAnalysisResultRepository } from './persistence/kysely-image-analysis-result-repository.js';
export { KyselyObservationMeasurementRepository } from './persistence/kysely-observation-measurement-repository.js';
export { KyselyObservationPhotoRepository } from './persistence/kysely-observation-photo-repository.js';
export { KyselyObservationRepository } from './persistence/kysely-observation-repository.js';
export { KyselyObservationsHistoryUnitOfWork } from './persistence/kysely-observations-history-unit-of-work.js';
export { KyselyPlantOwnershipRepository } from './persistence/kysely-plant-ownership-repository.js';
export type { ObservationsHistoryDatabaseSchema } from './persistence/schema.js';
