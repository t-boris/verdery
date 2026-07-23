import type { Kysely } from 'kysely';
import type { DatabaseSchema } from '../../../platform/database/database-gateway.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { PlantRepository } from '../application/plant-repository.js';
import type { AcquisitionDateType, GroupingKind, Plant } from '../domain/plant.js';
import type { LifecycleStage, PlantStatus } from '../domain/plant-lifecycle.js';
import { translateCheckViolation } from './translate-check-violation.js';

interface PlantRowLike {
  id: string;
  garden_id: string;
  garden_area_map_object_id: string | null;
  placement_map_object_id: string | null;
  display_name: string;
  taxonomy_reference_id: string | null;
  variety_label: string | null;
  accepted_identification_id: string | null;
  acquisition_date: string | null;
  acquisition_date_type: string | null;
  grouping_kind: string;
  quantity: number | null;
  lifecycle_stage: string;
  status: string;
  condition_note: string | null;
  care_guidance_note: string | null;
  revision: number;
  created_by_profile_id: string;
  created_at: Date;
  updated_at: Date;
}

function toPlant(row: PlantRowLike): Plant {
  return {
    id: row.id,
    gardenId: row.garden_id,
    gardenAreaMapObjectId: row.garden_area_map_object_id,
    placementMapObjectId: row.placement_map_object_id,
    displayName: row.display_name,
    taxonomyReferenceId: row.taxonomy_reference_id,
    varietyLabel: row.variety_label,
    acceptedIdentificationId: row.accepted_identification_id,
    acquisitionDate: row.acquisition_date,
    acquisitionDateType: row.acquisition_date_type as AcquisitionDateType | null,
    groupingKind: row.grouping_kind as GroupingKind,
    quantity: row.quantity,
    lifecycleStage: row.lifecycle_stage as LifecycleStage,
    status: row.status as PlantStatus,
    conditionNote: row.condition_note,
    careGuidanceNote: row.care_guidance_note,
    revision: row.revision,
    createdByProfileId: row.created_by_profile_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class KyselyPlantRepository implements PlantRepository {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  async findById(plantId: Uuid): Promise<Plant | null> {
    const row = await this.db
      .selectFrom('plants_inventory.plant')
      .selectAll()
      .where('id', '=', plantId)
      .executeTakeFirst();

    return row === undefined ? null : toPlant(row);
  }

  async insert(plant: Plant): Promise<void> {
    try {
      await this.db
        .insertInto('plants_inventory.plant')
        .values({
          id: plant.id,
          garden_id: plant.gardenId,
          garden_area_map_object_id: plant.gardenAreaMapObjectId,
          placement_map_object_id: plant.placementMapObjectId,
          display_name: plant.displayName,
          taxonomy_reference_id: plant.taxonomyReferenceId,
          variety_label: plant.varietyLabel,
          accepted_identification_id: plant.acceptedIdentificationId,
          acquisition_date: plant.acquisitionDate,
          acquisition_date_type: plant.acquisitionDateType,
          grouping_kind: plant.groupingKind,
          quantity: plant.quantity,
          lifecycle_stage: plant.lifecycleStage,
          status: plant.status,
          condition_note: plant.conditionNote,
          care_guidance_note: plant.careGuidanceNote,
          revision: plant.revision,
          created_by_profile_id: plant.createdByProfileId,
          created_at: plant.createdAt,
          updated_at: plant.updatedAt,
        })
        .execute();
    } catch (error) {
      const translated = translateCheckViolation(error, '/displayName');
      if (translated !== null) {
        throw translated;
      }
      throw error;
    }
  }

  async update(plant: Plant, expectedRevision: number): Promise<boolean> {
    try {
      const result = await this.db
        .updateTable('plants_inventory.plant')
        .set({
          garden_area_map_object_id: plant.gardenAreaMapObjectId,
          placement_map_object_id: plant.placementMapObjectId,
          display_name: plant.displayName,
          taxonomy_reference_id: plant.taxonomyReferenceId,
          variety_label: plant.varietyLabel,
          accepted_identification_id: plant.acceptedIdentificationId,
          acquisition_date: plant.acquisitionDate,
          acquisition_date_type: plant.acquisitionDateType,
          quantity: plant.quantity,
          lifecycle_stage: plant.lifecycleStage,
          status: plant.status,
          condition_note: plant.conditionNote,
          care_guidance_note: plant.careGuidanceNote,
          revision: plant.revision,
          updated_at: plant.updatedAt,
        })
        .where('id', '=', plant.id)
        .where('revision', '=', expectedRevision)
        .executeTakeFirst();

      return (result?.numUpdatedRows ?? 0n) === 1n;
    } catch (error) {
      const translated = translateCheckViolation(error, '/displayName');
      if (translated !== null) {
        throw translated;
      }
      throw error;
    }
  }
}
