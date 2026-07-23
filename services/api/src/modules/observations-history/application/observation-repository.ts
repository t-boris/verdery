import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { ImageAnalysisResult } from '../domain/image-analysis-result.js';
import type { Observation } from '../domain/observation.js';
import type { ObservationPhoto } from '../domain/observation-photo.js';

export interface ObservationPhotoWithAnalysis {
  readonly photo: ObservationPhoto;
  readonly analysisResults: readonly ImageAnalysisResult[];
}

export interface ObservationHistoryEntry {
  readonly observation: Observation;
  /**
   * Whether a later row exists pointing back at this one through
   * `correctsObservationId` — computed via an `EXISTS`-style query over
   * later rows, never read off a column on this row itself. The migration's
   * own doc comment on `observation` is explicit that no such column exists
   * or ever will: a correction is discovered by looking forward from the
   * original, not backward from a flag on it.
   */
  readonly isCorrected: boolean;
  readonly photos: readonly ObservationPhotoWithAnalysis[];
}

/**
 * Port for `observations_history.observation`.
 *
 * `insert` and read methods only — no `update` anywhere on this interface.
 * The migration's own doc comment on `observation` says "no UPDATE path
 * exists anywhere for this table": a correction is always a new row
 * (`domain/observation.ts`'s `createCorrectionObservation`), never a
 * mutation of an existing one, so there is nothing for an `update` method to
 * do.
 */
export interface ObservationRepository {
  insert(observation: Observation): Promise<void>;
  get(id: Uuid): Promise<Observation | null>;
  /** Every observation in the garden, most recently observed first, each with its corrected status and attached photos/analysis results. */
  listForGarden(gardenId: Uuid): Promise<ObservationHistoryEntry[]>;
  /** Every observation for the plant, most recently observed first, same shape as `listForGarden`. `gardenId` is redundant with `plantId` alone but kept explicit — every other cross-entity read in this codebase (`MapObjectRepository.findById(gardenId, objectId)`) is scoped by garden the same way. */
  listForPlant(gardenId: Uuid, plantId: Uuid): Promise<ObservationHistoryEntry[]>;
  /**
   * `get`'s own shape (single, by id) but with the same corrected-status and
   * photo/analysis enrichment `listForGarden`/`listForPlant` already attach —
   * added for `GetObservationForSync` (P5-BE-02), which needs one full
   * `ObservationResource` per pull row, not the whole garden's or plant's
   * history.
   */
  getWithHistory(id: Uuid): Promise<ObservationHistoryEntry | null>;
}
