import type { Kysely } from 'kysely';
import type { DatabaseSchema } from '../../../platform/database/database-gateway.js';
import type { ObservationPhotoRepository } from '../application/observation-photo-repository.js';
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
        created_at: photo.createdAt,
      })
      .execute();
  }
}
