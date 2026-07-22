/**
 * Category-detail table access: one row per object of a detail-bearing
 * category, keyed by the object's own id — see the migration's comment on
 * the detail tables for why this is an existence check rather than a
 * nullable-foreign-key join.
 *
 * Split out of `kysely-map-object-repository.ts` because nine categories'
 * worth of column mapping does not fit comfortably alongside that
 * repository's own object-row and viewport-query logic within the file-size
 * limit.
 */

import type {
  AnnotationDetails,
  BedDetails,
  FenceDetails,
  GardenObjectCategory,
  GardenObjectDetails,
  GateDetails,
  MeasurementAcquisitionMethod,
  MeasurementUnit,
  PlantPlacementDetails,
  StructureDetails,
  TreeDetails,
  UtilityExclusionDetails,
  ZoneDetails,
} from '@verdery/geometry-contracts';
import type { Kysely } from 'kysely';
import type { DatabaseSchema } from '../../../platform/database/database-gateway.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import {
  geometryToGeoJsonInsertExpression,
  nullableGeometrySelectExpression,
  parseGeometryFromGeoJson,
} from './postgis-geometry.js';
import { translateCheckViolation } from './translate-check-violation.js';

/** Categories with a specialized detail table. The rest (lot, path, waterFeature, importedBackground) carry no `details`. */
const DETAIL_CATEGORIES: ReadonlySet<GardenObjectCategory> = new Set([
  'structure',
  'fence',
  'gate',
  'zone',
  'bed',
  'tree',
  'plant',
  'utilityExclusion',
  'annotation',
]);

export function categoryHasDetails(category: GardenObjectCategory): boolean {
  return DETAIL_CATEGORIES.has(category);
}

/** Batches the detail lookup for many objects of the same category into one query per category, so `listForGarden` never runs N+1 detail queries. */
export async function fetchDetailsForIds(
  db: Kysely<DatabaseSchema>,
  category: GardenObjectCategory,
  objectIds: readonly Uuid[],
): Promise<Map<Uuid, GardenObjectDetails>> {
  const result = new Map<Uuid, GardenObjectDetails>();
  if (objectIds.length === 0) {
    return result;
  }

  switch (category) {
    case 'structure': {
      const rows = await db
        .selectFrom('gardens_mapping.structure_details')
        .select(['garden_object_id', 'structure_kind', 'height_metres'])
        .where('garden_object_id', 'in', objectIds)
        .execute();
      for (const row of rows) {
        const details: StructureDetails = {
          structureKind: row.structure_kind as StructureDetails['structureKind'],
          ...(row.height_metres === null ? {} : { heightMetres: row.height_metres }),
        };
        result.set(row.garden_object_id, { category: 'structure', details });
      }
      break;
    }

    case 'fence': {
      const rows = await db
        .selectFrom('gardens_mapping.fence_details')
        .select(['garden_object_id', 'fence_kind', 'height_metres'])
        .where('garden_object_id', 'in', objectIds)
        .execute();
      for (const row of rows) {
        const details: FenceDetails = {
          fenceKind: row.fence_kind as FenceDetails['fenceKind'],
          ...(row.height_metres === null ? {} : { heightMetres: row.height_metres }),
        };
        result.set(row.garden_object_id, { category: 'fence', details });
      }
      break;
    }

    case 'gate': {
      const rows = await db
        .selectFrom('gardens_mapping.gate_details')
        .select(['garden_object_id', 'fence_object_id', 'width_metres'])
        .where('garden_object_id', 'in', objectIds)
        .execute();
      for (const row of rows) {
        const details: GateDetails = {
          fenceObjectId: row.fence_object_id,
          ...(row.width_metres === null ? {} : { widthMetres: row.width_metres }),
        };
        result.set(row.garden_object_id, { category: 'gate', details });
      }
      break;
    }

    case 'zone': {
      const rows = await db
        .selectFrom('gardens_mapping.zone_details')
        .select(['garden_object_id', 'zone_kind'])
        .where('garden_object_id', 'in', objectIds)
        .execute();
      for (const row of rows) {
        const details: ZoneDetails = { zoneKind: row.zone_kind as ZoneDetails['zoneKind'] };
        result.set(row.garden_object_id, { category: 'zone', details });
      }
      break;
    }

    case 'bed': {
      const rows = await db
        .selectFrom('gardens_mapping.bed_details')
        .select(['garden_object_id', 'bed_kind', 'soil_notes'])
        .where('garden_object_id', 'in', objectIds)
        .execute();
      for (const row of rows) {
        const details: BedDetails = {
          bedKind: row.bed_kind as BedDetails['bedKind'],
          ...(row.soil_notes === null ? {} : { soilNotes: row.soil_notes }),
        };
        result.set(row.garden_object_id, { category: 'bed', details });
      }
      break;
    }

    case 'tree': {
      const rows = await db
        .selectFrom('gardens_mapping.tree_details')
        .select([
          'garden_object_id',
          nullableGeometrySelectExpression('canopy_geometry').as('canopy_geometry_geojson'),
          'common_name',
          'estimated_height_metres',
          'estimated_spread_metres',
        ])
        .where('garden_object_id', 'in', objectIds)
        .execute();
      for (const row of rows) {
        const details: TreeDetails = {
          ...(row.canopy_geometry_geojson === null
            ? {}
            : { canopyGeometry: parseGeometryFromGeoJson(row.canopy_geometry_geojson) }),
          ...(row.common_name === null ? {} : { commonName: row.common_name }),
          ...(row.estimated_height_metres === null
            ? {}
            : { estimatedHeightMetres: row.estimated_height_metres }),
          ...(row.estimated_spread_metres === null
            ? {}
            : { estimatedSpreadMetres: row.estimated_spread_metres }),
        };
        result.set(row.garden_object_id, { category: 'tree', details });
      }
      break;
    }

    case 'plant': {
      const rows = await db
        .selectFrom('gardens_mapping.plant_placement_details')
        .select([
          'garden_object_id',
          'common_name',
          'quantity',
          'spacing_metres',
          'assigned_to_object_id',
        ])
        .where('garden_object_id', 'in', objectIds)
        .execute();
      for (const row of rows) {
        const details: PlantPlacementDetails = {
          commonName: row.common_name,
          quantity: row.quantity,
          ...(row.spacing_metres === null ? {} : { spacingMetres: row.spacing_metres }),
          ...(row.assigned_to_object_id === null
            ? {}
            : { assignedToObjectId: row.assigned_to_object_id }),
        };
        result.set(row.garden_object_id, { category: 'plant', details });
      }
      break;
    }

    case 'utilityExclusion': {
      const rows = await db
        .selectFrom('gardens_mapping.utility_exclusion_details')
        .select(['garden_object_id', 'utility_exclusion_kind', 'notes'])
        .where('garden_object_id', 'in', objectIds)
        .execute();
      for (const row of rows) {
        const details: UtilityExclusionDetails = {
          utilityExclusionKind:
            row.utility_exclusion_kind as UtilityExclusionDetails['utilityExclusionKind'],
          ...(row.notes === null ? {} : { notes: row.notes }),
        };
        result.set(row.garden_object_id, { category: 'utilityExclusion', details });
      }
      break;
    }

    case 'annotation': {
      const rows = await db
        .selectFrom('gardens_mapping.annotation_details')
        .select([
          'garden_object_id',
          'measurement_value',
          'measurement_unit',
          'acquisition_method',
          'original_entry',
          'uncertainty',
          'reference_object_id',
          'calibration_revision',
        ])
        .where('garden_object_id', 'in', objectIds)
        .execute();
      for (const row of rows) {
        const details: AnnotationDetails =
          row.measurement_value === null ||
          row.measurement_unit === null ||
          row.acquisition_method === null
            ? {}
            : {
                measurement: {
                  value: row.measurement_value,
                  unit: row.measurement_unit as MeasurementUnit,
                  acquisitionMethod: row.acquisition_method as MeasurementAcquisitionMethod,
                  ...(row.original_entry === null ? {} : { originalEntry: row.original_entry }),
                  ...(row.uncertainty === null ? {} : { uncertainty: row.uncertainty }),
                  ...(row.reference_object_id === null
                    ? {}
                    : { referenceObjectId: row.reference_object_id }),
                  ...(row.calibration_revision === null
                    ? {}
                    : { calibrationRevision: row.calibration_revision }),
                },
              };
        result.set(row.garden_object_id, { category: 'annotation', details });
      }
      break;
    }

    case 'lot':
    case 'path':
    case 'waterFeature':
    case 'importedBackground':
      // No detail table — nothing to fetch.
      break;
  }

  return result;
}

export async function fetchDetailsById(
  db: Kysely<DatabaseSchema>,
  category: GardenObjectCategory,
  objectId: Uuid,
): Promise<GardenObjectDetails | undefined> {
  const map = await fetchDetailsForIds(db, category, [objectId]);
  return map.get(objectId);
}

/** Upserts the one detail row a category-bearing object owns. No-op for categories without a detail table. */
export async function writeDetails(
  db: Kysely<DatabaseSchema>,
  objectId: Uuid,
  details: GardenObjectDetails,
): Promise<void> {
  try {
    switch (details.category) {
      case 'structure':
        await db
          .insertInto('gardens_mapping.structure_details')
          .values({
            garden_object_id: objectId,
            structure_kind: details.details.structureKind,
            height_metres: details.details.heightMetres ?? null,
          })
          .onConflict((oc) =>
            oc.column('garden_object_id').doUpdateSet({
              structure_kind: details.details.structureKind,
              height_metres: details.details.heightMetres ?? null,
            }),
          )
          .execute();
        return;

      case 'fence':
        await db
          .insertInto('gardens_mapping.fence_details')
          .values({
            garden_object_id: objectId,
            fence_kind: details.details.fenceKind,
            height_metres: details.details.heightMetres ?? null,
          })
          .onConflict((oc) =>
            oc.column('garden_object_id').doUpdateSet({
              fence_kind: details.details.fenceKind,
              height_metres: details.details.heightMetres ?? null,
            }),
          )
          .execute();
        return;

      case 'gate':
        await db
          .insertInto('gardens_mapping.gate_details')
          .values({
            garden_object_id: objectId,
            fence_object_id: details.details.fenceObjectId,
            width_metres: details.details.widthMetres ?? null,
          })
          .onConflict((oc) =>
            oc.column('garden_object_id').doUpdateSet({
              fence_object_id: details.details.fenceObjectId,
              width_metres: details.details.widthMetres ?? null,
            }),
          )
          .execute();
        return;

      case 'zone':
        await db
          .insertInto('gardens_mapping.zone_details')
          .values({ garden_object_id: objectId, zone_kind: details.details.zoneKind })
          .onConflict((oc) =>
            oc.column('garden_object_id').doUpdateSet({ zone_kind: details.details.zoneKind }),
          )
          .execute();
        return;

      case 'bed':
        await db
          .insertInto('gardens_mapping.bed_details')
          .values({
            garden_object_id: objectId,
            bed_kind: details.details.bedKind,
            soil_notes: details.details.soilNotes ?? null,
          })
          .onConflict((oc) =>
            oc.column('garden_object_id').doUpdateSet({
              bed_kind: details.details.bedKind,
              soil_notes: details.details.soilNotes ?? null,
            }),
          )
          .execute();
        return;

      case 'tree': {
        const canopy =
          details.details.canopyGeometry === undefined
            ? null
            : geometryToGeoJsonInsertExpression(details.details.canopyGeometry);
        await db
          .insertInto('gardens_mapping.tree_details')
          .values({
            garden_object_id: objectId,
            canopy_geometry: canopy,
            common_name: details.details.commonName ?? null,
            estimated_height_metres: details.details.estimatedHeightMetres ?? null,
            estimated_spread_metres: details.details.estimatedSpreadMetres ?? null,
          })
          .onConflict((oc) =>
            oc.column('garden_object_id').doUpdateSet({
              canopy_geometry: canopy,
              common_name: details.details.commonName ?? null,
              estimated_height_metres: details.details.estimatedHeightMetres ?? null,
              estimated_spread_metres: details.details.estimatedSpreadMetres ?? null,
            }),
          )
          .execute();
        return;
      }

      case 'plant':
        await db
          .insertInto('gardens_mapping.plant_placement_details')
          .values({
            garden_object_id: objectId,
            common_name: details.details.commonName,
            quantity: details.details.quantity,
            spacing_metres: details.details.spacingMetres ?? null,
            assigned_to_object_id: details.details.assignedToObjectId ?? null,
          })
          .onConflict((oc) =>
            oc.column('garden_object_id').doUpdateSet({
              common_name: details.details.commonName,
              quantity: details.details.quantity,
              spacing_metres: details.details.spacingMetres ?? null,
              assigned_to_object_id: details.details.assignedToObjectId ?? null,
            }),
          )
          .execute();
        return;

      case 'utilityExclusion':
        await db
          .insertInto('gardens_mapping.utility_exclusion_details')
          .values({
            garden_object_id: objectId,
            utility_exclusion_kind: details.details.utilityExclusionKind,
            notes: details.details.notes ?? null,
          })
          .onConflict((oc) =>
            oc.column('garden_object_id').doUpdateSet({
              utility_exclusion_kind: details.details.utilityExclusionKind,
              notes: details.details.notes ?? null,
            }),
          )
          .execute();
        return;

      case 'annotation': {
        const measurement = details.details.measurement;
        await db
          .insertInto('gardens_mapping.annotation_details')
          .values({
            garden_object_id: objectId,
            measurement_value: measurement?.value ?? null,
            measurement_unit: measurement?.unit ?? null,
            acquisition_method: measurement?.acquisitionMethod ?? null,
            original_entry: measurement?.originalEntry ?? null,
            uncertainty: measurement?.uncertainty ?? null,
            reference_object_id: measurement?.referenceObjectId ?? null,
            calibration_revision: measurement?.calibrationRevision ?? null,
          })
          .onConflict((oc) =>
            oc.column('garden_object_id').doUpdateSet({
              measurement_value: measurement?.value ?? null,
              measurement_unit: measurement?.unit ?? null,
              acquisition_method: measurement?.acquisitionMethod ?? null,
              original_entry: measurement?.originalEntry ?? null,
              uncertainty: measurement?.uncertainty ?? null,
              reference_object_id: measurement?.referenceObjectId ?? null,
              calibration_revision: measurement?.calibrationRevision ?? null,
            }),
          )
          .execute();
        return;
      }
    }
  } catch (error) {
    const translated = translateCheckViolation(error, '/categoryDetails');
    if (translated !== null) {
      throw translated;
    }
    throw error;
  }
}
