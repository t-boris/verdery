import type { Position, ProvenanceKind } from '@verdery/geometry-contracts';
import type { Kysely } from 'kysely';
import type { DatabaseSchema } from '../../../platform/database/database-gateway.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type {
  Georeference,
  GeoreferenceRepository,
} from '../application/georeference-repository.js';
import { geometrySelectExpression, parseGeometryFromGeoJson } from './postgis-geometry.js';

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
}
