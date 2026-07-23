import type { ObservationPhoto } from '../domain/observation-photo.js';

/**
 * Port for `observations_history.observation_photo`.
 *
 * Insert-only, the same reasoning as `ObservationRepository`: every
 * attachment is written once, alongside the observation and its stubbed
 * image-analysis result, and never updated afterward.
 */
export interface ObservationPhotoRepository {
  insert(photo: ObservationPhoto): Promise<void>;
}
