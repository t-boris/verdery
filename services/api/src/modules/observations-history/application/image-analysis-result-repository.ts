import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { ImageAnalysisResult } from '../domain/image-analysis-result.js';

/** An analysis result together with the garden its observation belongs to — resolved via `observation_photo` -> `observation`, since `image_analysis_result` carries no `garden_id` column of its own. What `SetHealthSuggestionDisposition` needs to authorize the caller before mutating. */
export interface ImageAnalysisResultWithGardenContext {
  readonly result: ImageAnalysisResult;
  readonly gardenId: Uuid;
}

/**
 * Port for `observations_history.image_analysis_result`.
 *
 * Insert-only for the analysis itself — a suggestion is never re-analyzed
 * or edited in place. `update` (P11-HEALTH-01) exists for exactly one
 * purpose: persisting a changed `disposition` (plus its linkage fields),
 * the one part of this row the design doc's own health-suggestion shape
 * describes as user-settable after the fact. Every other field stays
 * write-once.
 */
export interface ImageAnalysisResultRepository {
  insert(result: ImageAnalysisResult): Promise<void>;
  /** Null when no analysis result with this id exists. */
  getWithGardenContext(id: Uuid): Promise<ImageAnalysisResultWithGardenContext | null>;
  update(result: ImageAnalysisResult): Promise<void>;
}
