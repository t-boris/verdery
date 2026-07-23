import type { Kysely } from 'kysely';
import type { DatabaseSchema } from '../../../platform/database/database-gateway.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { PlantPhotoRepository } from '../application/plant-photo-repository.js';
import type { PlantPhoto } from '../domain/plant-photo.js';

interface PlantPhotoRowLike {
  id: string;
  plant_id: string;
  media_id: string;
  is_primary: boolean;
  created_at: Date;
}

function toPlantPhoto(row: PlantPhotoRowLike): PlantPhoto {
  return {
    id: row.id,
    plantId: row.plant_id,
    mediaId: row.media_id,
    isPrimary: row.is_primary,
    createdAt: row.created_at,
  };
}

export class KyselyPlantPhotoRepository implements PlantPhotoRepository {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  async findById(plantId: Uuid, plantPhotoId: Uuid): Promise<PlantPhoto | null> {
    const row = await this.db
      .selectFrom('plants_inventory.plant_photo')
      .selectAll()
      .where('id', '=', plantPhotoId)
      .where('plant_id', '=', plantId)
      .executeTakeFirst();

    return row === undefined ? null : toPlantPhoto(row);
  }

  async insert(photo: PlantPhoto): Promise<void> {
    await this.db
      .insertInto('plants_inventory.plant_photo')
      .values({
        id: photo.id,
        plant_id: photo.plantId,
        media_id: photo.mediaId,
        is_primary: photo.isPrimary,
        created_at: photo.createdAt,
      })
      .execute();
  }

  async clearPrimaryForPlant(plantId: Uuid): Promise<void> {
    await this.db
      .updateTable('plants_inventory.plant_photo')
      .set({ is_primary: false })
      .where('plant_id', '=', plantId)
      .where('is_primary', '=', true)
      .execute();
  }

  async setPrimary(plantPhotoId: Uuid): Promise<void> {
    await this.db
      .updateTable('plants_inventory.plant_photo')
      .set({ is_primary: true })
      .where('id', '=', plantPhotoId)
      .execute();
  }
}
