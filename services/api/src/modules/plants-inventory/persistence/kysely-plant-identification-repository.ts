import type { Kysely } from 'kysely';
import type { DatabaseSchema } from '../../../platform/database/database-gateway.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { PlantIdentificationRepository } from '../application/plant-identification-repository.js';
import type { PlantIdentification } from '../domain/plant-identification.js';

interface PlantIdentificationRowLike {
  id: string;
  plant_id: string;
  plant_photo_id: string;
  suggested_taxonomy_id: string | null;
  confidence_score: string;
  created_at: Date;
}

function toPlantIdentification(row: PlantIdentificationRowLike): PlantIdentification {
  return {
    id: row.id,
    plantId: row.plant_id,
    plantPhotoId: row.plant_photo_id,
    suggestedTaxonomyId: row.suggested_taxonomy_id,
    // `numeric(4,3)` reads back as a string — see the row type's own doc
    // comment in persistence/schema.ts.
    confidenceScore: Number(row.confidence_score),
    createdAt: row.created_at,
  };
}

export class KyselyPlantIdentificationRepository implements PlantIdentificationRepository {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  async findById(identificationId: Uuid): Promise<PlantIdentification | null> {
    const row = await this.db
      .selectFrom('plants_inventory.plant_identification')
      .selectAll()
      .where('id', '=', identificationId)
      .executeTakeFirst();

    return row === undefined ? null : toPlantIdentification(row);
  }

  async insert(identification: PlantIdentification): Promise<void> {
    await this.db
      .insertInto('plants_inventory.plant_identification')
      .values({
        id: identification.id,
        plant_id: identification.plantId,
        plant_photo_id: identification.plantPhotoId,
        suggested_taxonomy_id: identification.suggestedTaxonomyId,
        confidence_score: identification.confidenceScore,
        created_at: identification.createdAt,
      })
      .execute();
  }
}
