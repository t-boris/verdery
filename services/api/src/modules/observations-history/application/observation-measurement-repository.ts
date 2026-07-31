import type { ObservationMeasurement } from '../domain/observation-measurement.js';

/**
 * Port for `observations_history.observation_measurement`.
 *
 * Insert-only, the same reasoning as `ObservationPhotoRepository`: a revised
 * measurement is a new observation (and therefore a fresh set of
 * measurement rows), never an update to an existing one.
 */
export interface ObservationMeasurementRepository {
  insert(measurement: ObservationMeasurement): Promise<void>;
}
