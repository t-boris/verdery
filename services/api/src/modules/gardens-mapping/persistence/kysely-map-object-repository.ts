import type { GardenObjectCategory, ProvenanceKind } from '@verdery/geometry-contracts';
import { type Kysely, sql } from 'kysely';
import type { DatabaseSchema } from '../../../platform/database/database-gateway.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { MapObject, MapObjectLifecycleState, MapObjectSummary } from '../domain/map-object.js';
import type {
  MapObjectRepository,
  ViewportBoundingBox,
} from '../application/map-object-repository.js';
import {
  categoryHasDetails,
  fetchDetailsById,
  fetchDetailsForIds,
  writeDetails,
} from './map-object-details.js';
import {
  geometrySelectExpression,
  geometryToGeoJsonInsertExpression,
  parseGeometryFromGeoJson,
} from './postgis-geometry.js';
import { translateCheckViolation } from './translate-check-violation.js';

const OBJECT_COLUMNS = [
  'id',
  'garden_id',
  'coordinate_space_id',
  'category',
  'label',
  'provenance',
  'confidence',
  'lifecycle_state',
  'current_revision',
  'created_by_profile_id',
  'created_at',
  'updated_at',
] as const;

interface ObjectRowWithGeometry {
  id: string;
  garden_id: string;
  coordinate_space_id: string;
  category: string;
  geometry_geojson: string;
  label: string | null;
  provenance: string;
  confidence: number | null;
  lifecycle_state: string;
  current_revision: number;
  created_by_profile_id: string;
  created_at: Date;
  updated_at: Date;
}

function toMapObjectWithoutDetails(row: ObjectRowWithGeometry): MapObject {
  return {
    id: row.id,
    gardenId: row.garden_id,
    coordinateSpaceId: row.coordinate_space_id,
    category: row.category as GardenObjectCategory,
    geometry: parseGeometryFromGeoJson(row.geometry_geojson),
    label: row.label,
    provenance: row.provenance as ProvenanceKind,
    confidence: row.confidence,
    lifecycleState: row.lifecycle_state as MapObjectLifecycleState,
    currentRevision: row.current_revision,
    details: undefined,
    createdByProfileId: row.created_by_profile_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class KyselyMapObjectRepository implements MapObjectRepository {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  async findById(gardenId: Uuid, objectId: Uuid): Promise<MapObjectSummary | null> {
    const row = await this.db
      .selectFrom('gardens_mapping.garden_object')
      .select(['id', 'garden_id', 'category', 'lifecycle_state', 'current_revision'])
      .where('id', '=', objectId)
      .where('garden_id', '=', gardenId)
      .executeTakeFirst();

    if (row === undefined) {
      return null;
    }

    return {
      id: row.id,
      gardenId: row.garden_id,
      category: row.category as GardenObjectCategory,
      lifecycleState: row.lifecycle_state as MapObjectLifecycleState,
      currentRevision: row.current_revision,
    };
  }

  async findByIdWithDetails(gardenId: Uuid, objectId: Uuid): Promise<MapObject | null> {
    const row = await this.db
      .selectFrom('gardens_mapping.garden_object')
      .select([...OBJECT_COLUMNS, geometrySelectExpression('geometry').as('geometry_geojson')])
      .where('id', '=', objectId)
      .where('garden_id', '=', gardenId)
      .executeTakeFirst();

    if (row === undefined) {
      return null;
    }

    const object = toMapObjectWithoutDetails(row);
    if (!categoryHasDetails(object.category)) {
      return object;
    }

    const details = await fetchDetailsById(this.db, object.category, object.id);
    return { ...object, details };
  }

  async insert(object: MapObject): Promise<void> {
    try {
      await this.db
        .insertInto('gardens_mapping.garden_object')
        .values({
          id: object.id,
          garden_id: object.gardenId,
          coordinate_space_id: object.coordinateSpaceId,
          category: object.category,
          geometry: geometryToGeoJsonInsertExpression(object.geometry),
          label: object.label,
          provenance: object.provenance,
          confidence: object.confidence,
          lifecycle_state: object.lifecycleState,
          current_revision: object.currentRevision,
          created_by_profile_id: object.createdByProfileId,
          created_at: object.createdAt,
          updated_at: object.updatedAt,
        })
        .execute();
    } catch (error) {
      const translated = translateCheckViolation(error, '/geometry');
      if (translated !== null) {
        throw translated;
      }
      throw error;
    }

    if (object.details !== undefined) {
      await writeDetails(this.db, object.id, object.details);
    }
  }

  async update(object: MapObject, expectedRevision: number): Promise<boolean> {
    let result;
    try {
      result = await this.db
        .updateTable('gardens_mapping.garden_object')
        .set({
          geometry: geometryToGeoJsonInsertExpression(object.geometry),
          label: object.label,
          provenance: object.provenance,
          confidence: object.confidence,
          lifecycle_state: object.lifecycleState,
          current_revision: object.currentRevision,
          updated_at: object.updatedAt,
        })
        .where('id', '=', object.id)
        .where('garden_id', '=', object.gardenId)
        .where('current_revision', '=', expectedRevision)
        .executeTakeFirst();
    } catch (error) {
      const translated = translateCheckViolation(error, '/geometry');
      if (translated !== null) {
        throw translated;
      }
      throw error;
    }

    const applied = (result.numUpdatedRows ?? 0n) === 1n;
    if (!applied) {
      return false;
    }

    if (object.details !== undefined) {
      await writeDetails(this.db, object.id, object.details);
    }

    return true;
  }

  async listForGarden(gardenId: Uuid, viewport: ViewportBoundingBox | null): Promise<MapObject[]> {
    let query = this.db
      .selectFrom('gardens_mapping.garden_object')
      .select([...OBJECT_COLUMNS, geometrySelectExpression('geometry').as('geometry_geojson')])
      .where('garden_id', '=', gardenId)
      .where('lifecycle_state', '=', 'active');

    if (viewport !== null) {
      query = query.where(
        sql<boolean>`ST_Intersects(geometry, ST_MakeEnvelope(${viewport.minX}, ${viewport.minY}, ${viewport.maxX}, ${viewport.maxY}, 0))`,
      );
    }

    const rows = await query.execute();
    const objects = rows.map(toMapObjectWithoutDetails);

    const byCategory = new Map<GardenObjectCategory, Uuid[]>();
    for (const object of objects) {
      if (!categoryHasDetails(object.category)) {
        continue;
      }
      const ids = byCategory.get(object.category) ?? [];
      ids.push(object.id);
      byCategory.set(object.category, ids);
    }

    const detailMaps = await Promise.all(
      [...byCategory.entries()].map(async ([category, ids]) => ({
        category,
        details: await fetchDetailsForIds(this.db, category, ids),
      })),
    );

    const detailsByObjectId = new Map(detailMaps.flatMap(({ details }) => [...details.entries()]));

    return objects.map((object) => ({
      ...object,
      details: detailsByObjectId.get(object.id),
    }));
  }
}
