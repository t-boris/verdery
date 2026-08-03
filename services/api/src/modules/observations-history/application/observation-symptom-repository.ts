import type { ObservationSymptom } from '../domain/observation-symptom.js';

/**
 * Port for `observations_history.observation_symptom`.
 *
 * Insert-only, the same reasoning as `ObservationMeasurementRepository`: a
 * symptom seen differently later is a new observation, never an edit of the
 * statement already recorded.
 */
export interface ObservationSymptomRepository {
  insert(symptom: ObservationSymptom): Promise<void>;
}
