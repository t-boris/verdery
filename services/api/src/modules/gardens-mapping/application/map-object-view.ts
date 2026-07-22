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

/**
 * Flattens `GardenObjectDetails`'s `{category, details}` domain shape (kept
 * nested so the discriminated union is ergonomic in application code) into
 * the wire shape `openapi.yaml`'s `*Details` schemas declare: `category`
 * alongside that category's own fields, flat, matching every
 * `PointGeometry`/`PolygonGeometry`-style branch of `Geometry` and the
 * request-side parsing `transport/parse-garden-object-details.ts` already
 * does in reverse. Lives here, not in `transport/`, because this module —
 * not a separate transport-mapping step — already owns constructing the one
 * resource shape a command handler returns and a client receives (see this
 * file's own header comment); a transport-layer helper cannot be imported
 * from `application/` without inverting this codebase's layering.
 *
 * Found necessary when a real client (built independently against both this
 * contract and `@verdery/geometry-contracts`) sent a request the parser
 * correctly rejected as malformed, then received a response nested the same
 * wrong way this function now prevents — this module was serializing the
 * domain shape directly instead of flattening it back.
 */
function toWireGardenObjectDetails(value: GardenObjectDetails): Record<string, unknown> {
  return { category: value.category, ...value.details };
}

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
  /** Flat wire shape — see `toWireGardenObjectDetails`'s doc comment. */
  readonly details?: Record<string, unknown>;
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
    ...(object.details === undefined ? {} : { details: toWireGardenObjectDetails(object.details) }),
    lifecycleState: object.lifecycleState,
    revision: object.currentRevision,
    createdAt: object.createdAt.toISOString(),
    updatedAt: object.updatedAt.toISOString(),
  };
}
