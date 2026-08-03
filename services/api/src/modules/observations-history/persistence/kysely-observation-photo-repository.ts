import type { Kysely } from 'kysely';
import type { DatabaseSchema } from '../../../platform/database/database-gateway.js';
import type { ObservationPhotoPurpose } from '../domain/observation-photo.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type {
  ObservationPhotoRepository,
  PlantJournalFrame,
  PlantPhotoHistoryEntry,
} from '../application/observation-photo-repository.js';
import type { ObservationPhoto } from '../domain/observation-photo.js';

export class KyselyObservationPhotoRepository implements ObservationPhotoRepository {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  async insert(photo: ObservationPhoto): Promise<void> {
    await this.db
      .insertInto('observations_history.observation_photo')
      .values({
        id: photo.id,
        observation_id: photo.observationId,
        media_id: photo.mediaId,
        purpose: photo.purpose,
        created_at: photo.createdAt,
      })
      .execute();
  }

  async listJournalFramesForPlant(
    plantId: Uuid,
    purpose: ObservationPhotoPurpose | null,
    limit: number,
  ): Promise<readonly PlantJournalFrame[]> {
    let query = this.db
      .selectFrom('observations_history.observation_photo')
      .innerJoin(
        'observations_history.observation',
        'observations_history.observation.id',
        'observations_history.observation_photo.observation_id',
      )
      .select([
        'observations_history.observation_photo.observation_id as observation_id',
        'observations_history.observation_photo.media_id as media_id',
        'observations_history.observation_photo.purpose as purpose',
        'observations_history.observation.observed_at as observed_at',
      ])
      .where('observations_history.observation.plant_id', '=', plantId)
      // Oldest first: a growth sequence reads forward in time, and a client
      // that wants the newest frame takes the last one rather than reversing
      // a page it did not ask for.
      .orderBy('observations_history.observation.observed_at', 'asc')
      // Ties are real — several photographs of one observation share its
      // instant — so the id breaks them into a stable order rather than
      // letting the same request return two different sequences.
      .orderBy('observations_history.observation_photo.id', 'asc')
      .limit(limit);

    if (purpose !== null) {
      query = query.where('observations_history.observation_photo.purpose', '=', purpose);
    }

    const rows = await query.execute();

    return rows.map((row) => ({
      observationId: row.observation_id,
      mediaId: row.media_id,
      observedAt: row.observed_at,
      purpose: (row.purpose as ObservationPhotoPurpose | null) ?? null,
    }));
  }

  async listAnalysisHistoryForPlant(
    plantId: Uuid,
    excludingObservationId: Uuid,
    limit: number,
  ): Promise<readonly PlantPhotoHistoryEntry[]> {
    const rows = await this.db
      .selectFrom('observations_history.observation_photo')
      .innerJoin(
        'observations_history.observation',
        'observations_history.observation.id',
        'observations_history.observation_photo.observation_id',
      )
      .select([
        'observations_history.observation_photo.media_id as media_id',
        'observations_history.observation.observed_at as observed_at',
      ])
      .where('observations_history.observation.plant_id', '=', plantId)
      .where('observations_history.observation.id', '!=', excludingObservationId)
      .orderBy('observations_history.observation.observed_at', 'asc')
      .limit(limit)
      .execute();

    return rows.map((row) => ({ mediaId: row.media_id, observedAt: row.observed_at }));
  }
}
