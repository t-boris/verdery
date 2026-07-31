import type { Kysely } from 'kysely';
import type { DatabaseSchema } from '../../../platform/database/database-gateway.js';
import type { ObservationMeasurementRepository } from '../application/observation-measurement-repository.js';
import type { ObservationMeasurement } from '../domain/observation-measurement.js';

export class KyselyObservationMeasurementRepository implements ObservationMeasurementRepository {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  async insert(measurement: ObservationMeasurement): Promise<void> {
    await this.db
      .insertInto('observations_history.observation_measurement')
      .values({
        id: measurement.id,
        observation_id: measurement.observationId,
        kind: measurement.kind,
        // `numeric(10,2)` — see persistence/schema.ts's doc comment on
        // ObservationMeasurementRow for why this is stringified explicitly.
        value: String(measurement.value),
        unit: measurement.unit,
        created_at: measurement.createdAt,
      })
      .execute();
  }
}
