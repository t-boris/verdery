import type { Kysely } from 'kysely';
import type { DatabaseSchema } from '../../../platform/database/database-gateway.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { PlantIdentificationRepository } from '../application/plant-identification-repository.js';
import type { LifecycleStage } from '../domain/plant-lifecycle.js';
import type { PlantIdentification } from '../domain/plant-identification.js';

interface PlantIdentificationRowLike {
  id: string;
  plant_id: string;
  plant_photo_id: string;
  suggested_taxonomy_id: string | null;
  suggested_common_name: string | null;
  suggested_scientific_name: string | null;
  suggested_variety_label: string | null;
  suggested_lifecycle_stage: string | null;
  suggested_condition_note: string | null;
  suggested_care_guidance_note: string | null;
  suggested_acquisition_date: string | null;
  confidence_score: string;
  created_at: Date;
}

function toPlantIdentification(row: PlantIdentificationRowLike): PlantIdentification {
  return {
    id: row.id,
    plantId: row.plant_id,
    plantPhotoId: row.plant_photo_id,
    suggestedTaxonomyId: row.suggested_taxonomy_id,
    suggestedCommonName: row.suggested_common_name,
    suggestedScientificName: row.suggested_scientific_name,
    suggestedVarietyLabel: row.suggested_variety_label,
    // Already validated by `plant_identification_suggested_lifecycle_stage_check`
    // at write time — the same real `LifecycleStage` values, never a
    // caller-supplied one this read path needs to re-validate.
    suggestedLifecycleStage: row.suggested_lifecycle_stage as LifecycleStage | null,
    suggestedConditionNote: row.suggested_condition_note,
    suggestedCareGuidanceNote: row.suggested_care_guidance_note,
    suggestedAcquisitionDate: row.suggested_acquisition_date,
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

  async findByPlantId(plantId: Uuid): Promise<PlantIdentification | null> {
    const row = await this.db
      .selectFrom('plants_inventory.plant_identification')
      .selectAll()
      .where('plant_id', '=', plantId)
      .orderBy('created_at', 'desc')
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
        suggested_common_name: identification.suggestedCommonName,
        suggested_scientific_name: identification.suggestedScientificName,
        suggested_variety_label: identification.suggestedVarietyLabel,
        suggested_lifecycle_stage: identification.suggestedLifecycleStage,
        suggested_condition_note: identification.suggestedConditionNote,
        suggested_care_guidance_note: identification.suggestedCareGuidanceNote,
        suggested_acquisition_date: identification.suggestedAcquisitionDate,
        confidence_score: identification.confidenceScore,
        created_at: identification.createdAt,
      })
      .execute();
  }
}
