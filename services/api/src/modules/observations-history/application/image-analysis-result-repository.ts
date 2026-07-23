import type { ImageAnalysisResult } from '../domain/image-analysis-result.js';

/**
 * Port for `observations_history.image_analysis_result`.
 *
 * Insert-only, the same reasoning as `ObservationPhotoRepository`.
 */
export interface ImageAnalysisResultRepository {
  insert(result: ImageAnalysisResult): Promise<void>;
}
