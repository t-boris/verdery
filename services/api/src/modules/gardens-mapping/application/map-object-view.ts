/**
 * Maps the domain `MapObject` to the exact shape
 * `packages/api-contracts/openapi.yaml`'s `GardenObject` schema declares.
 *
 * The resource type here is hand-written against `@verdery/geometry-contracts`
 * rather than imported from `@verdery/api-contracts`'s generated
 * `GardenObject` — see the doc comment on that package's map-schema exports
 * for why: the generated type's nested `oneOf` branches (`details`,
 * `geometryEnvelope.geometry`) carry the wrong discriminator literal for
 * narrowing against real wire JSON, where this hand-written type does not,
 * while still producing byte-identical JSON on the wire. Every command
 * handler returns this same shape, matching `toGardenResource`'s role for
 * garden commands: what a use case returns and what the client eventually
 * receives must be one value, not two shapes a transport-mapping step could
 * let drift apart (the idempotency store caches the literal response body).
 */

import type {
  CoordinateSpaceKind,
  GardenObjectCategory,
  GardenObjectDetails,
  Geometry,
  ProvenanceKind,
} from '@verdery/geometry-contracts';
import type { MapObject } from '../domain/map-object.js';

export interface GardenObjectResource {
  readonly id: string;
  readonly gardenId: string;
  readonly category: GardenObjectCategory;
  readonly geometryEnvelope: {
    readonly geometry: Geometry;
    readonly coordinateSpaceId: string;
    readonly coordinateSpaceKind: CoordinateSpaceKind;
    readonly provenance: ProvenanceKind;
    readonly confidence?: number;
  };
  readonly label?: string;
  readonly details?: GardenObjectDetails;
  readonly lifecycleState: 'active' | 'deleted';
  readonly revision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Matches `MapCommandResult` in the OpenAPI document exactly. */
export interface MapCommandResultResource {
  readonly affectedObjects: readonly GardenObjectResource[];
}

/** The only coordinate space kind this schema supports today — see `coordinate_space_kind_check` in the migration. */
const LOCAL_PLANAR_METRES: CoordinateSpaceKind = 'localPlanarMetres';

export function toGardenObjectResource(object: MapObject): GardenObjectResource {
  return {
    id: object.id,
    gardenId: object.gardenId,
    category: object.category,
    geometryEnvelope: {
      geometry: object.geometry,
      coordinateSpaceId: object.coordinateSpaceId,
      coordinateSpaceKind: LOCAL_PLANAR_METRES,
      provenance: object.provenance,
      ...(object.confidence === null ? {} : { confidence: object.confidence }),
    },
    ...(object.label === null ? {} : { label: object.label }),
    ...(object.details === undefined ? {} : { details: object.details }),
    lifecycleState: object.lifecycleState,
    revision: object.currentRevision,
    createdAt: object.createdAt.toISOString(),
    updatedAt: object.updatedAt.toISOString(),
  };
}
