import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { ObservationPhoto } from '../domain/observation-photo.js';

/** One prior photo of a plant, for `AnalyzePlantCondition`'s own history comparison (P11-HEALTH-01) — just enough to resolve a media reference and order the history, not the full `ObservationPhoto` shape. */
export interface PlantPhotoHistoryEntry {
  readonly mediaId: Uuid;
  readonly observedAt: Date;
}

/**
 * Port for `observations_history.observation_photo`.
 *
 * Insert-only for writes, the same reasoning as `ObservationRepository`:
 * every attachment is written once, alongside the observation and its
 * image-analysis result, and never updated afterward.
 */
export interface ObservationPhotoRepository {
  insert(photo: ObservationPhoto): Promise<void>;
  /**
   * Every OTHER observation's photos for this plant, oldest observed
   * first, capped at `limit` — the plant's own condition-analysis HISTORY
   * `AnalyzePlantCondition.execute`'s `priorPhotos` compares a new photo
   * against (P11-HEALTH-01). `excludingObservationId` excludes the
   * observation currently being recorded/corrected: sibling photos
   * attached in the SAME observation event are not "prior," they are
   * concurrent.
   */
  listAnalysisHistoryForPlant(
    plantId: Uuid,
    excludingObservationId: Uuid,
    limit: number,
  ): Promise<readonly PlantPhotoHistoryEntry[]>;
}
