import type { Kysely } from 'kysely';
import type { DatabaseSchema } from '../../../platform/database/database-gateway.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { PlantCandidatePhotoRepository } from '../application/plant-candidate-photo-repository.js';
import type { PlantCandidatePhoto } from '../domain/plant-candidate-photo.js';

interface PlantCandidatePhotoRowLike {
  id: string;
  candidate_id: string;
  media_id: string;
  is_primary: boolean;
  created_at: Date;
}

function toPlantCandidatePhoto(row: PlantCandidatePhotoRowLike): PlantCandidatePhoto {
  return {
    id: row.id,
    candidateId: row.candidate_id,
    mediaId: row.media_id,
    isPrimary: row.is_primary,
    createdAt: row.created_at,
  };
}

export class KyselyPlantCandidatePhotoRepository implements PlantCandidatePhotoRepository {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  async findAllForCandidate(candidateId: Uuid): Promise<PlantCandidatePhoto[]> {
    const rows = await this.db
      .selectFrom('plants_inventory.plant_candidate_photo')
      .selectAll()
      .where('candidate_id', '=', candidateId)
      .orderBy('is_primary', 'desc')
      .orderBy('created_at', 'asc')
      .execute();

    return rows.map(toPlantCandidatePhoto);
  }

  async insert(photo: PlantCandidatePhoto): Promise<void> {
    await this.db
      .insertInto('plants_inventory.plant_candidate_photo')
      .values({
        id: photo.id,
        candidate_id: photo.candidateId,
        media_id: photo.mediaId,
        is_primary: photo.isPrimary,
        created_at: photo.createdAt,
      })
      .execute();
  }
}
