import type { ObservationPhotoPurpose } from '../domain/observation-photo.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { ObservationPhoto } from '../domain/observation-photo.js';

/** One prior photo of a plant, for `AnalyzePlantCondition`'s own history comparison (P11-HEALTH-01) — just enough to resolve a media reference and order the history, not the full `ObservationPhoto` shape. */
export interface PlantPhotoHistoryEntry {
  readonly mediaId: Uuid;
  readonly observedAt: Date;
}

/**
 * One frame of a plant's journal sequence (P11-MEDIA-01, comparison sets).
 *
 * Carries the observation id and the purpose that `PlantPhotoHistoryEntry`
 * deliberately omits: a reader comparing growth needs to know WHICH shot a
 * frame is, and needs a way back to the observation that recorded it. Frames
 * are a read of what already exists — nothing is generated, and no derivative
 * is produced.
 */
export interface PlantJournalFrame {
  readonly observationId: Uuid;
  readonly mediaId: Uuid;
  readonly observedAt: Date;
  readonly purpose: ObservationPhotoPurpose | null;
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

  /**
   * A plant's photographs oldest-first, optionally narrowed to one shot
   * purpose.
   *
   * NARROWING IS THE POINT, not a convenience. A sequence mixing whole-plant
   * shots with leaf close-ups is not a comparison of anything; asking for one
   * purpose is what makes consecutive frames comparable. Unlabeled photos
   * (attached before purposes existed, or by a photographer who skipped the
   * label) are returned only when no purpose is requested — guessing which
   * sequence they belong to would be inventing data.
   */
  listJournalFramesForPlant(
    plantId: Uuid,
    purpose: ObservationPhotoPurpose | null,
    limit: number,
  ): Promise<readonly PlantJournalFrame[]>;
}
