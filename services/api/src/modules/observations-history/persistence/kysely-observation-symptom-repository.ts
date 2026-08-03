import type { Kysely } from 'kysely';
import type { DatabaseSchema } from '../../../platform/database/database-gateway.js';
import type { ObservationSymptomRepository } from '../application/observation-symptom-repository.js';
import type { ObservationSymptom } from '../domain/observation-symptom.js';

export class KyselyObservationSymptomRepository implements ObservationSymptomRepository {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  async insert(symptom: ObservationSymptom): Promise<void> {
    await this.db
      .insertInto('observations_history.observation_symptom')
      .values({
        id: symptom.id,
        observation_id: symptom.observationId,
        symptom_kind: symptom.kind,
        severity: symptom.severity,
        created_at: symptom.createdAt,
      })
      .execute();
  }
}
