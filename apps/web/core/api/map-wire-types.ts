/**
 * Wire shapes for the garden map endpoints, exactly as the real server sends
 * and expects them.
 *
 * `packages/api-contracts/openapi.yaml` declares `StructureDetails` and its
 * eight siblings as *flat* objects (`{ category: 'structure', structureKind,
 * heightMetres }`) — in both directions. `@verdery/geometry-contracts`'s
 * `GardenObjectDetails` (`{ category, details: { structureKind,
 * heightMetres } }`) is the *domain* shape this feature and
 * `deriveInverseCommand` work with internally, kept nested because that is
 * ergonomic for a discriminated union in application code — it is never the
 * wire shape, on either the request or the response side.
 *
 * `toWireCategoryDetails`/`fromWireCategoryDetails` below are the one place
 * that boundary is crossed: every command carrying `categoryDetails` is
 * flattened immediately before it is sent (`map-gateway.ts#submitCommand`),
 * and every `GardenObject.details` a response carries is un-flattened back
 * into the domain shape immediately after it is received
 * (`object-mapper.ts#toMapObjectRecord`). A real asymmetry between the two
 * directions was found and fixed in `services/api` during this work
 * package — `application/map-object-view.ts` was serializing the nested
 * domain shape directly onto the wire instead of flattening it back,
 * confirmed by a live `400`/response-body round trip against the real
 * server before either side of that fix landed.
 *
 * `Geometry`/`Position` have no such asymmetry — both packages agree on a
 * flat GeoJSON shape in both directions — so they are used here only because
 * `MapCommandPayload` and `deriveInverseCommand` (this module's other
 * consumers) already require `@verdery/geometry-contracts`'s versions, and
 * keeping one Geometry type throughout the map feature avoids a needless
 * conversion layer.
 */

import type {
  GardenObjectCategory,
  GardenObjectDetails,
  Geometry,
  MapCommandPayload,
  Position,
  ProvenanceKind,
} from '@verdery/geometry-contracts';

/** The flat wire shape `openapi.yaml`'s `*Details` schemas declare, in both directions — see the module doc comment. */
export type WireCategoryDetails = { readonly category: string } & Record<string, unknown>;

export type WireCoordinateSpaceKind = 'localPlanarMetres' | 'geographicWgs84';

export interface WireGeometryEnvelope {
  readonly geometry: Geometry;
  readonly coordinateSpaceId: string;
  readonly coordinateSpaceKind: WireCoordinateSpaceKind;
  readonly provenance: ProvenanceKind;
  readonly confidence?: number;
}

export type WireObjectLifecycleState = 'active' | 'deleted';

/** Matches `GardenObjectResource` in `services/api/.../application/map-object-view.ts`. */
export interface WireGardenObject {
  readonly id: string;
  readonly gardenId: string;
  readonly category: GardenObjectCategory;
  readonly geometryEnvelope: WireGeometryEnvelope;
  readonly label?: string;
  readonly details?: WireCategoryDetails;
  readonly lifecycleState: WireObjectLifecycleState;
  readonly revision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface WireGeoreference {
  readonly localAnchor: Position;
  readonly geographicAnchor: Position;
  readonly rotationDegrees: number;
  readonly scaleCorrection: number;
  readonly accuracyMetres?: number;
  readonly provenance: ProvenanceKind;
  readonly method: string;
  readonly revision: number;
}

export type WireValidationSeverity = 'error' | 'warning';

export interface WireValidationIssue {
  readonly code: string;
  readonly severity: WireValidationSeverity;
  readonly affectedObjectIds?: readonly string[];
  readonly geometry?: Geometry;
}

/** Matches `GardenMapDocumentResource`; this is the `getGardenMap` response body. */
export interface WireGardenMapDocument {
  readonly coordinateSpaceId: string;
  readonly georeference?: WireGeoreference;
  readonly objects: readonly WireGardenObject[];
  readonly validationSummary: readonly WireValidationIssue[];
}

/** Matches `MapCommandResultResource`; this is the `submitMapCommand` response body. */
export interface WireMapCommandResult {
  readonly affectedObjects: readonly WireGardenObject[];
}

/** `{ category, details: { ...fields } }` → `{ category, ...fields }`, for a command about to be sent. */
function toWireCategoryDetails(details: GardenObjectDetails): WireCategoryDetails {
  return { category: details.category, ...details.details };
}

/**
 * `{ category, ...fields }` → `{ category, details: { ...fields } }`, for a
 * `GardenObject.details` just received. The cast is unavoidable: a generic
 * `Record` spread cannot prove which `GardenObjectDetails` branch a runtime
 * `category` string selects the way a real discriminant check could — the
 * server already validated this shape (`translateCheckViolation`'s CHECK
 * constraints), so this trusts it the same way every other response-parsing
 * boundary in this codebase trusts a contract-conformant server.
 */
export function fromWireCategoryDetails(wire: WireCategoryDetails): GardenObjectDetails {
  const { category, ...details } = wire;
  return { category, details } as GardenObjectDetails;
}

/**
 * Converts a command built with `@verdery/geometry-contracts`'s nested
 * `categoryDetails` (every command builder in `features/map/commands.ts`,
 * and every inverse `deriveInverseCommand` derives, produce this shape) into
 * the flat shape the live server's request parser requires. A structural
 * clone via `JSON.parse(JSON.stringify(...))`-equivalent spread would work
 * too, but naming the two command types (`createObject`, `changeProperties`)
 * explicitly keeps this exhaustive against `MapCommandPayload` — a future
 * command type that adds its own `categoryDetails` field without updating
 * this switch fails to compile instead of silently shipping the wrong shape.
 */
export function toWireCommandPayload(command: MapCommandPayload): unknown {
  switch (command.type) {
    case 'createObject':
      return command.categoryDetails === undefined
        ? command
        : { ...command, categoryDetails: toWireCategoryDetails(command.categoryDetails) };
    case 'changeProperties':
      return command.categoryDetails === undefined
        ? command
        : { ...command, categoryDetails: toWireCategoryDetails(command.categoryDetails) };
    case 'moveObject':
    case 'replaceGeometry':
    case 'editVertex':
    case 'splitLinework':
    case 'joinLinework':
    case 'assignPlant':
    case 'upsertCalibration':
    case 'decideProposal':
    case 'deleteObject':
    case 'restoreObject':
    case 'duplicateObject':
      return command;
  }
}
