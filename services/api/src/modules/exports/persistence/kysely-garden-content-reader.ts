/**
 * Per-garden content reads for the export snapshot (P8-EXPORT-01) — the
 * cross-module SELECT-only posture `kysely-garden-recipient-source.ts`
 * documents, applied at export breadth: every read here is a typed SELECT
 * against another module's tables through the shared `DatabaseSchema`,
 * never a private repository import, and every read runs on the ONE
 * `REPEATABLE READ, READ ONLY` transaction `KyselyExportSnapshotReader`
 * opened — which is exactly what makes the assembled data one boundary's.
 *
 * Reads are bounded pages (`readAllPages`, 1000 rows per statement,
 * id-cursor) — section 6's "reads bounded pages" — inside the one
 * snapshot transaction.
 *
 * PRIVACY: membership rows export facts only (profile id, role, state);
 * media metadata covers user-uploaded originals (`garden_photo`,
 * `imported_plan`) — never `raw_capture` (separate sensitive-media
 * permission, not implemented), never rebuildable derived artifacts,
 * never other exports. Internal audit journals (`*_revision` tables) are
 * not user-facing data and are not read.
 */

import { sql, type Kysely } from 'kysely';
import type { DatabaseSchema } from '../../../platform/database/database-gateway.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type {
  ExportGardenData,
  ExportMapObjectData,
  ExportMediaFileEntry,
} from '../application/export-snapshot-reader.js';
import { readGardenRecommendations } from './kysely-garden-recommendations-reader.js';
import {
  EXPORTABLE_MEDIA_CLASSES,
  PAGE_SIZE,
  readAllPages,
  toJsonRecord,
  type Row,
} from './snapshot-read-helpers.js';

export class KyselyGardenContentReader {
  constructor(private readonly trx: Kysely<DatabaseSchema>) {}

  async readGarden(gardenId: Uuid): Promise<ExportGardenData> {
    const garden = await this.trx
      .selectFrom('gardens_mapping.garden')
      .select(['id', 'name', 'lifecycle_state', 'revision', 'created_at', 'updated_at'])
      .where('id', '=', gardenId)
      .executeTakeFirstOrThrow();

    const memberships = await readAllPages((afterId) => {
      let query = this.trx
        .selectFrom('collaboration.membership')
        .select(['id', 'profile_id', 'role', 'state', 'created_at'])
        .where('garden_id', '=', gardenId)
        .orderBy('id')
        .limit(PAGE_SIZE);
      if (afterId !== null) query = query.where('id', '>', afterId);
      return query.execute();
    });

    const coordinateSpaces = await this.trx
      .selectFrom('gardens_mapping.coordinate_space')
      .select(['id', 'kind', 'axis_convention', 'origin_description', 'created_at'])
      .where('garden_id', '=', gardenId)
      .orderBy('id')
      .execute();

    const georeferences = await this.trx
      .selectFrom('gardens_mapping.georeference')
      .select([
        'id',
        'coordinate_space_id',
        sql<string>`ST_AsGeoJSON(local_anchor)`.as('local_anchor'),
        sql<string>`ST_AsGeoJSON(geographic_anchor)`.as('geographic_anchor'),
        'rotation_degrees',
        'scale_correction',
        'accuracy_metres',
        'provenance',
        'method',
        'revision',
        'valid_from',
        'valid_until',
        'created_at',
      ])
      .where('garden_id', '=', gardenId)
      .orderBy('id')
      .execute();

    const mapObjects = await this.readMapObjects(gardenId);
    const objectIds = mapObjects.map((object) => object.id);

    const calibrations =
      objectIds.length === 0
        ? []
        : await this.trx
            .selectFrom('gardens_mapping.calibration')
            .select([
              'id',
              'background_object_id',
              'revision',
              'reference_points',
              'known_distance',
              'page_aspect_ratio',
              'manual_adjustment',
              'metres_per_plan_unit',
              'rotation_radians',
              'translation_x_metres',
              'translation_y_metres',
              'point_residuals_metres',
              'residual_error_metres',
              'created_at',
            ])
            .where('background_object_id', 'in', objectIds)
            .orderBy('id')
            .execute();

    const plants = await readAllPages((afterId) => {
      let query = this.trx
        .selectFrom('plants_inventory.plant')
        .selectAll()
        .where('garden_id', '=', gardenId)
        .orderBy('id')
        .limit(PAGE_SIZE);
      if (afterId !== null) query = query.where('id', '>', afterId);
      return query.execute();
    });

    const plantPhotos = await readAllPages((afterId) => {
      let query = this.trx
        .selectFrom('plants_inventory.plant_photo')
        .innerJoin(
          'plants_inventory.plant',
          'plants_inventory.plant.id',
          'plants_inventory.plant_photo.plant_id',
        )
        .select([
          'plants_inventory.plant_photo.id as id',
          'plants_inventory.plant_photo.plant_id as plant_id',
          'plants_inventory.plant_photo.media_id as media_id',
          'plants_inventory.plant_photo.is_primary as is_primary',
          'plants_inventory.plant_photo.created_at as created_at',
        ])
        .where('plants_inventory.plant.garden_id', '=', gardenId)
        .orderBy('plants_inventory.plant_photo.id')
        .limit(PAGE_SIZE);
      if (afterId !== null) query = query.where('plants_inventory.plant_photo.id', '>', afterId);
      return query.execute();
    });

    const plantIdentifications = await readAllPages((afterId) => {
      let query = this.trx
        .selectFrom('plants_inventory.plant_identification')
        .innerJoin(
          'plants_inventory.plant',
          'plants_inventory.plant.id',
          'plants_inventory.plant_identification.plant_id',
        )
        .select([
          'plants_inventory.plant_identification.id as id',
          'plants_inventory.plant_identification.plant_id as plant_id',
          'plants_inventory.plant_identification.plant_photo_id as plant_photo_id',
          'plants_inventory.plant_identification.suggested_taxonomy_id as suggested_taxonomy_id',
          'plants_inventory.plant_identification.suggested_common_name as suggested_common_name',
          'plants_inventory.plant_identification.suggested_scientific_name as suggested_scientific_name',
          'plants_inventory.plant_identification.confidence_score as confidence_score',
          'plants_inventory.plant_identification.created_at as created_at',
        ])
        .where('plants_inventory.plant.garden_id', '=', gardenId)
        .orderBy('plants_inventory.plant_identification.id')
        .limit(PAGE_SIZE);
      if (afterId !== null) {
        query = query.where('plants_inventory.plant_identification.id', '>', afterId);
      }
      return query.execute();
    });

    const observations = await readAllPages((afterId) => {
      let query = this.trx
        .selectFrom('observations_history.observation')
        .selectAll()
        .where('garden_id', '=', gardenId)
        .orderBy('id')
        .limit(PAGE_SIZE);
      if (afterId !== null) query = query.where('id', '>', afterId);
      return query.execute();
    });

    const observationPhotos = await readAllPages((afterId) => {
      let query = this.trx
        .selectFrom('observations_history.observation_photo')
        .innerJoin(
          'observations_history.observation',
          'observations_history.observation.id',
          'observations_history.observation_photo.observation_id',
        )
        .select([
          'observations_history.observation_photo.id as id',
          'observations_history.observation_photo.observation_id as observation_id',
          'observations_history.observation_photo.media_id as media_id',
          'observations_history.observation_photo.created_at as created_at',
        ])
        .where('observations_history.observation.garden_id', '=', gardenId)
        .orderBy('observations_history.observation_photo.id')
        .limit(PAGE_SIZE);
      if (afterId !== null) {
        query = query.where('observations_history.observation_photo.id', '>', afterId);
      }
      return query.execute();
    });

    const imageAnalysisResults = await readAllPages((afterId) => {
      let query = this.trx
        .selectFrom('observations_history.image_analysis_result')
        .innerJoin(
          'observations_history.observation_photo',
          'observations_history.observation_photo.id',
          'observations_history.image_analysis_result.observation_photo_id',
        )
        .innerJoin(
          'observations_history.observation',
          'observations_history.observation.id',
          'observations_history.observation_photo.observation_id',
        )
        .select([
          'observations_history.image_analysis_result.id as id',
          'observations_history.image_analysis_result.observation_photo_id as observation_photo_id',
          'observations_history.image_analysis_result.analysis_kind as analysis_kind',
          'observations_history.image_analysis_result.suggested_label as suggested_label',
          'observations_history.image_analysis_result.confidence_score as confidence_score',
          'observations_history.image_analysis_result.requires_confirmation as requires_confirmation',
          'observations_history.image_analysis_result.requested_additional_evidence as requested_additional_evidence',
          'observations_history.image_analysis_result.created_at as created_at',
        ])
        .where('observations_history.observation.garden_id', '=', gardenId)
        .orderBy('observations_history.image_analysis_result.id')
        .limit(PAGE_SIZE);
      if (afterId !== null) {
        query = query.where('observations_history.image_analysis_result.id', '>', afterId);
      }
      return query.execute();
    });

    const tasks = await readAllPages((afterId) => {
      let query = this.trx
        .selectFrom('tasks_recommendations.task')
        .selectAll()
        .where('garden_id', '=', gardenId)
        .orderBy('id')
        .limit(PAGE_SIZE);
      if (afterId !== null) query = query.where('id', '>', afterId);
      return query.execute();
    });

    const taskAttachments = await readAllPages((afterId) => {
      let query = this.trx
        .selectFrom('tasks_recommendations.task_attachment')
        .innerJoin(
          'tasks_recommendations.task',
          'tasks_recommendations.task.id',
          'tasks_recommendations.task_attachment.task_id',
        )
        .select([
          'tasks_recommendations.task_attachment.id as id',
          'tasks_recommendations.task_attachment.task_id as task_id',
          'tasks_recommendations.task_attachment.media_id as media_id',
          'tasks_recommendations.task_attachment.created_at as created_at',
        ])
        .where('tasks_recommendations.task.garden_id', '=', gardenId)
        .orderBy('tasks_recommendations.task_attachment.id')
        .limit(PAGE_SIZE);
      if (afterId !== null) {
        query = query.where('tasks_recommendations.task_attachment.id', '>', afterId);
      }
      return query.execute();
    });

    const recommendationData = await readGardenRecommendations(this.trx, gardenId);
    const mediaRecords = await this.readMediaRecords(gardenId);

    return {
      garden: {
        id: garden.id,
        name: garden.name,
        lifecycleState: garden.lifecycle_state,
        revision: garden.revision,
        createdAt: garden.created_at.toISOString(),
        updatedAt: garden.updated_at.toISOString(),
      },
      memberships: memberships.map((membership) => ({
        profileId: membership.profile_id,
        role: membership.role,
        state: membership.state,
        createdAt: membership.created_at.toISOString(),
      })),
      coordinateSpaces: coordinateSpaces.map(toJsonRecord),
      georeferences: georeferences.map((row) =>
        toJsonRecord({
          ...row,
          local_anchor: JSON.parse(row.local_anchor) as unknown,
          geographic_anchor: JSON.parse(row.geographic_anchor) as unknown,
        }),
      ),
      calibrations: calibrations.map(toJsonRecord),
      mapObjects,
      plants: plants.map(toJsonRecord),
      plantPhotos: plantPhotos.map(toJsonRecord),
      plantIdentifications: plantIdentifications.map(toJsonRecord),
      observations: observations.map(toJsonRecord),
      observationPhotos: observationPhotos.map(toJsonRecord),
      imageAnalysisResults: imageAnalysisResults.map(toJsonRecord),
      tasks: tasks.map(toJsonRecord),
      taskAttachments: taskAttachments.map(toJsonRecord),
      ...recommendationData,
      mediaRecords: mediaRecords.map(toJsonRecord),
    };
  }

  /** The entitled media FILES for one garden — available user-uploaded originals with a durably stored object. */
  async readMediaFileEntries(gardenId: Uuid): Promise<ExportMediaFileEntry[]> {
    const rows = await readAllPages((afterId) => {
      let query = this.trx
        .selectFrom('media.media_record')
        .select([
          'id',
          'garden_id',
          'display_filename',
          'media_class',
          'verified_content_type',
          'declared_content_type',
          'verified_byte_size',
          'declared_byte_size',
          'checksum_sha256',
          'bucket_name',
          'object_key',
        ])
        .where('garden_id', '=', gardenId)
        .where('media_class', 'in', EXPORTABLE_MEDIA_CLASSES)
        .where('upload_state', '=', 'available')
        .orderBy('id')
        .limit(PAGE_SIZE);
      if (afterId !== null) query = query.where('id', '>', afterId);
      return query.execute();
    });

    return rows
      .filter((row) => row.bucket_name !== null && row.object_key !== null)
      .map((row) => ({
        mediaId: row.id,
        gardenId: row.garden_id as string,
        entryPath: `media/${row.garden_id as string}/${row.id}-${row.display_filename}`,
        displayFilename: row.display_filename,
        mediaClass: row.media_class,
        contentType: row.verified_content_type ?? row.declared_content_type,
        byteSize: row.verified_byte_size ?? row.declared_byte_size,
        checksumSha256: row.checksum_sha256,
        bucketName: row.bucket_name as string,
        objectKey: row.object_key as string,
      }));
  }

  private async readMapObjects(gardenId: Uuid): Promise<ExportMapObjectData[]> {
    const objects = await readAllPages((afterId) => {
      let query = this.trx
        .selectFrom('gardens_mapping.garden_object')
        .select([
          'id',
          'coordinate_space_id',
          'category',
          sql<string>`ST_AsGeoJSON(geometry)`.as('geometry'),
          'label',
          'provenance',
          'confidence',
          'lifecycle_state',
          'current_revision',
          'created_at',
          'updated_at',
        ])
        .where('garden_id', '=', gardenId)
        .orderBy('id')
        .limit(PAGE_SIZE);
      if (afterId !== null) query = query.where('id', '>', afterId);
      return query.execute();
    });

    const detailsByObjectId = await this.readObjectDetails(objects.map((object) => object.id));

    return objects.map((object) => ({
      id: object.id,
      coordinateSpaceId: object.coordinate_space_id,
      category: object.category,
      geometry: JSON.parse(object.geometry) as unknown,
      label: object.label,
      provenance: object.provenance,
      confidence: object.confidence,
      lifecycleState: object.lifecycle_state,
      revision: object.current_revision,
      createdAt: object.created_at.toISOString(),
      updatedAt: object.updated_at.toISOString(),
      details: detailsByObjectId.get(object.id) ?? null,
    }));
  }

  /** Merges every category-detail table's row (if any) for the given objects — one map, keyed by object id. `tree_details.canopy_geometry` gets the same GeoJSON conversion as any geometry column. */
  private async readObjectDetails(
    objectIds: readonly string[],
  ): Promise<Map<string, Record<string, unknown>>> {
    const details = new Map<string, Record<string, unknown>>();
    if (objectIds.length === 0) {
      return details;
    }

    const record = (objectId: string, row: Row): void => {
      const { garden_object_id: _ignored, ...rest } = row;
      details.set(objectId, toJsonRecord(rest));
    };

    const plainTables = [
      'gardens_mapping.structure_details',
      'gardens_mapping.fence_details',
      'gardens_mapping.gate_details',
      'gardens_mapping.zone_details',
      'gardens_mapping.bed_details',
      'gardens_mapping.plant_placement_details',
      'gardens_mapping.utility_exclusion_details',
      'gardens_mapping.annotation_details',
      'gardens_mapping.imported_background_details',
    ] as const;

    for (const table of plainTables) {
      const rows = await this.trx
        .selectFrom(table)
        .selectAll()
        .where('garden_object_id', 'in', objectIds)
        .execute();
      for (const row of rows) {
        record(row.garden_object_id, row);
      }
    }

    const treeRows = await this.trx
      .selectFrom('gardens_mapping.tree_details')
      .select([
        'garden_object_id',
        sql<string | null>`ST_AsGeoJSON(canopy_geometry)`.as('canopy_geometry'),
        'common_name',
        'estimated_height_metres',
        'estimated_spread_metres',
      ])
      .where('garden_object_id', 'in', objectIds)
      .execute();
    for (const row of treeRows) {
      record(row.garden_object_id, {
        ...row,
        canopy_geometry:
          row.canopy_geometry === null ? null : (JSON.parse(row.canopy_geometry) as unknown),
      });
    }

    return details;
  }

  /** Media METADATA rows for the garden's user-uploaded originals — any upload state (the state itself is a recorded fact). */
  private async readMediaRecords(gardenId: Uuid): Promise<Row[]> {
    return readAllPages((afterId) => {
      let query = this.trx
        .selectFrom('media.media_record')
        .select([
          'id',
          'media_class',
          'display_filename',
          'declared_content_type',
          'verified_content_type',
          'declared_byte_size',
          'verified_byte_size',
          'checksum_sha256',
          'upload_state',
          'processing_state',
          'sensitivity_classification',
          'retention_deadline_at',
          'revision',
          'created_at',
          'updated_at',
        ])
        .where('garden_id', '=', gardenId)
        .where('media_class', 'in', EXPORTABLE_MEDIA_CLASSES)
        .orderBy('id')
        .limit(PAGE_SIZE);
      if (afterId !== null) query = query.where('id', '>', afterId);
      return query.execute();
    });
  }
}
