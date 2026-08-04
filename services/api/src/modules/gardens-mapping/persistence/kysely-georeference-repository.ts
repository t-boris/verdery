import type { Position, ProvenanceKind } from '@verdery/geometry-contracts';
import type { Kysely } from 'kysely';
import type { DatabaseSchema } from '../../../platform/database/database-gateway.js';
import { generateUuidV7, type Uuid } from '../../../shared/identifiers/uuid.js';
import type {
  Georeference,
  GeoreferenceRepository,
  NewGeoreference,
} from '../application/georeference-repository.js';
import {
  geographicPointInsertExpression,
  geometryToGeoJsonInsertExpression,
  geometrySelectExpression,
  parseGeometryFromGeoJson,
} from './postgis-geometry.js';

function toPosition(geoJson: string): Position {
  const geometry = parseGeometryFromGeoJson(geoJson);
  if (geometry.type !== 'Point') {
    throw new Error('A georeference anchor must be a Point geometry.');
  }
  return geometry.coordinates;
}

export class KyselyGeoreferenceRepository implements GeoreferenceRepository {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  async findCurrentForGarden(gardenId: Uuid): Promise<Georeference | null> {
    const row = await this.db
      .selectFrom('gardens_mapping.georeference')
      .select([
        'id',
        'garden_id',
        'coordinate_space_id',
        geometrySelectExpression('local_anchor').as('local_anchor_geojson'),
        geometrySelectExpression('geographic_anchor').as('geographic_anchor_geojson'),
        'rotation_degrees',
        'scale_correction',
        'accuracy_metres',
        'provenance',
        'method',
        'revision',
      ])
      .where('garden_id', '=', gardenId)
      .where('valid_until', 'is', null)
      .executeTakeFirst();

    if (row === undefined) {
      return null;
    }

    return {
      id: row.id,
      gardenId: row.garden_id,
      coordinateSpaceId: row.coordinate_space_id,
      localAnchor: toPosition(row.local_anchor_geojson),
      geographicAnchor: toPosition(row.geographic_anchor_geojson),
      rotationDegrees: row.rotation_degrees,
      scaleCorrection: row.scale_correction,
      accuracyMetres: row.accuracy_metres,
      provenance: row.provenance as ProvenanceKind,
      method: row.method,
      revision: row.revision,
    };
  }

  async supersedeCurrent(next: NewGeoreference, now: Date): Promise<Georeference> {
    // Closing first is required, not stylistic: `georeference_garden_current_idx`
    // permits exactly one row per garden with `valid_until IS NULL`, so the
    // insert below would be rejected while the old row is still open. Both
    // statements run inside the caller's transaction — this repository is
    // bound to it through the unit of work — so a garden is never left with
    // no current georeference.
    await this.db
      .updateTable('gardens_mapping.georeference')
      .set({ valid_until: now })
      .where('garden_id', '=', next.gardenId)
      .where('valid_until', 'is', null)
      .execute();

    const id = generateUuidV7();

    await this.db
      .insertInto('gardens_mapping.georeference')
      .values({
        id,
        garden_id: next.gardenId,
        coordinate_space_id: next.coordinateSpaceId,
        local_anchor: geometryToGeoJsonInsertExpression({
          type: 'Point',
          coordinates: next.localAnchor,
        }),
        geographic_anchor: geographicPointInsertExpression(next.geographicAnchor),
        rotation_degrees: next.rotationDegrees,
        scale_correction: next.scaleCorrection,
        accuracy_metres: next.accuracyMetres,
        provenance: next.provenance,
        method: next.method,
        revision: next.revision,
        valid_from: now,
        valid_until: null,
        created_by_profile_id: next.createdByProfileId,
        created_at: now,
      })
      .execute();

    return { id, ...next };
  }
}
