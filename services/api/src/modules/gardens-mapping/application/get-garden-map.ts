/**
 * `GET /gardens/{gardenId}/map` — the read side of the garden map.
 *
 * `validationSummary` is honestly empty this pass, not a fabricated
 * placeholder: cross-object validation (unexpected overlaps, a plant placed
 * inside a blocked structure, a detached gate) needs real geometry/topology
 * queries this work package does not implement — see the `// TODO` on
 * `DeleteMapObject` and `AssignPlantToTarget` for the specific rules deferred.
 *
 * Source: packages/api-contracts/openapi.yaml, operation `getGardenMap`;
 * architecture/map-rendering-and-editing.md, section "6. Hybrid Data Model".
 */

import type { Position, ProvenanceKind } from '@verdery/geometry-contracts';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { Clock } from '../../../shared/time/clock.js';
import type { CoordinateSpaceRepository } from './coordinate-space-repository.js';
import type { Georeference, GeoreferenceRepository } from './georeference-repository.js';
import type { GardenAuthorization } from './garden-authorization.js';
import type { MapObjectRepository, ViewportBoundingBox } from './map-object-repository.js';
import { toGardenObjectResource, type GardenObjectResource } from './map-object-view.js';

export interface GeoreferenceResource {
  readonly localAnchor: Position;
  readonly geographicAnchor: Position;
  readonly rotationDegrees: number;
  readonly scaleCorrection: number;
  readonly accuracyMetres?: number;
  readonly provenance: ProvenanceKind;
  readonly method: string;
  readonly revision: number;
}

export interface ValidationIssueResource {
  readonly code: string;
  readonly severity: 'error' | 'warning';
  readonly affectedObjectIds?: readonly string[];
}

export interface GardenMapDocumentResource {
  readonly coordinateSpaceId: string;
  readonly georeference?: GeoreferenceResource;
  readonly objects: readonly GardenObjectResource[];
  readonly validationSummary: readonly ValidationIssueResource[];
}

function toGeoreferenceResource(georeference: Georeference): GeoreferenceResource {
  return {
    localAnchor: georeference.localAnchor,
    geographicAnchor: georeference.geographicAnchor,
    rotationDegrees: georeference.rotationDegrees,
    scaleCorrection: georeference.scaleCorrection,
    ...(georeference.accuracyMetres === null
      ? {}
      : { accuracyMetres: georeference.accuracyMetres }),
    provenance: georeference.provenance,
    method: georeference.method,
    revision: georeference.revision,
  };
}

export class GetGardenMap {
  constructor(
    private readonly authorization: GardenAuthorization,
    private readonly coordinateSpaces: CoordinateSpaceRepository,
    private readonly georeferences: GeoreferenceRepository,
    private readonly mapObjects: MapObjectRepository,
    private readonly clock: Clock,
  ) {}

  async execute(
    gardenId: Uuid,
    profileId: Uuid,
    viewport: ViewportBoundingBox | null,
  ): Promise<GardenMapDocumentResource> {
    await this.authorization.requireCapability(gardenId, profileId, 'viewGarden');

    // See `KyselyCoordinateSpaceRepository.findOrCreateForGarden`'s doc
    // comment for why a read endpoint is allowed to lazily create this row.
    const coordinateSpace = await this.coordinateSpaces.findOrCreateForGarden(
      gardenId,
      this.clock.now(),
    );
    const georeference = await this.georeferences.findCurrentForGarden(gardenId);
    const objects = await this.mapObjects.listForGarden(gardenId, viewport);

    return {
      coordinateSpaceId: coordinateSpace.id,
      ...(georeference === null ? {} : { georeference: toGeoreferenceResource(georeference) }),
      objects: objects.map(toGardenObjectResource),
      validationSummary: [],
    };
  }
}
