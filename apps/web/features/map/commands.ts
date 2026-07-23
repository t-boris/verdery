/**
 * Pure builders for every map editor command this feature constructs.
 *
 * Three command types remain deliberately unbuilt here, each deferred to a
 * later phase rather than cut for scope reasons within Phase 3:
 *
 * - `upsertCalibration` needs an existing `importedBackground` object (a
 *   raster/PDF property-plan asset) to calibrate against, and nothing in
 *   this app can create one yet — plan import is Phase 6 scope
 *   (`docs/implementation-plan.md`, Phase 6 "Media, Photos, and
 *   Property-Plan Import").
 * - `decideProposal` needs a generated proposal (AI/ML-produced candidate
 *   geometry) to review, and nothing in this app produces proposals yet —
 *   assisted capture and plan recognition is Phase 10 scope, gated behind an
 *   explicit research decision the plan has not yet made.
 * - Creating `importedBackground` objects themselves is the same Phase 6 gap
 *   as `upsertCalibration` above — there is no image/plan upload flow yet.
 *
 * Every other command type — `createObject`, `moveObject`,
 * `replaceGeometry`, `editVertex`, `splitLinework`, `joinLinework`,
 * `changeProperties`, `assignPlant`, `deleteObject`, `duplicateObject` — is
 * built here and wired end to end through `use-map-editor-actions.ts` and
 * its sibling action hooks. `restoreObject` is the one exception a user
 * never builds directly; only `deriveInverseCommand` produces it, as the
 * inverse of `deleteObject`.
 */

import type {
  AssignPlantPayload,
  ChangePropertiesPayload,
  CreateObjectPayload,
  DeleteObjectPayload,
  DuplicateObjectPayload,
  EditVertexPayload,
  GardenObjectDetails,
  GateDetails,
  Geometry,
  JoinLineworkPayload,
  MoveObjectPayload,
  ReplaceGeometryPayload,
  SplitLineworkPayload,
  VertexOperation,
} from '@verdery/geometry-contracts';
import { v7 } from 'uuid';

import type { CreatableCategory } from './types';

/** New object or command identifier. UUIDv7, matching the contract's `Uuid` pattern. */
export function generateMapId(): string {
  return v7();
}

/**
 * Sensible, schema-valid starting details for a freshly created object, so
 * the property panel always has something real to show and edit rather than
 * an empty state immediately after creation.
 *
 * `lot`, `path`, and `waterFeature` have no details schema at all (see
 * `object-category.ts`'s `GardenObjectDetails` union comment), so they carry
 * no `categoryDetails`. `gate` has a schema but no valid default —
 * `GateDetails.fenceObjectId` is required and only meaningful as a real,
 * user-picked fence id, so `gate` is never created through this generic
 * path; see `buildCreateGateObjectCommand` below.
 */
export function defaultCategoryDetails(
  category: CreatableCategory,
): GardenObjectDetails | undefined {
  switch (category) {
    case 'lot':
      return undefined;
    case 'structure':
      return { category: 'structure', details: { structureKind: 'other' } };
    case 'fence':
      return { category: 'fence', details: { fenceKind: 'other' } };
    case 'gate':
      return undefined;
    case 'path':
      return undefined;
    case 'zone':
      return { category: 'zone', details: { zoneKind: 'other' } };
    case 'bed':
      return { category: 'bed', details: { bedKind: 'inGround' } };
    case 'waterFeature':
      return undefined;
    case 'utilityExclusion':
      return { category: 'utilityExclusion', details: { utilityExclusionKind: 'other' } };
    case 'tree':
      return { category: 'tree', details: {} };
    case 'plant':
      return { category: 'plant', details: { commonName: '', quantity: 1 } };
    case 'annotation':
      return { category: 'annotation', details: {} };
  }
}

/**
 * Builds a `createObject` command for every creatable category except
 * `gate`, whose required `fenceObjectId` has no default — see
 * `buildCreateGateObjectCommand`.
 */
export function buildCreateObjectCommand(
  objectId: string,
  category: Exclude<CreatableCategory, 'gate'>,
  geometry: Geometry,
): CreateObjectPayload {
  const categoryDetails = defaultCategoryDetails(category);
  return {
    type: 'createObject',
    objectId,
    category,
    geometry,
    ...(categoryDetails === undefined ? {} : { categoryDetails }),
  };
}

/**
 * Builds a `createObject` command for a `gate`, the one category whose
 * details cannot be defaulted: `fenceObjectId` must be a real fence the user
 * picked, never a placeholder. `widthMetres` is optional and normally left
 * unset at creation time, editable afterward through the property panel.
 */
export function buildCreateGateObjectCommand(
  objectId: string,
  geometry: Geometry,
  fenceObjectId: string,
  widthMetres?: number,
): CreateObjectPayload {
  const details: GateDetails =
    widthMetres === undefined ? { fenceObjectId } : { fenceObjectId, widthMetres };
  return {
    type: 'createObject',
    objectId,
    category: 'gate',
    geometry,
    categoryDetails: { category: 'gate', details },
  };
}

export function buildMoveObjectCommand(
  objectId: string,
  expectedRevision: number,
  dx: number,
  dy: number,
): MoveObjectPayload {
  return {
    type: 'moveObject',
    objectId,
    expectedRevision,
    translationMetres: { dx, dy },
  };
}

/**
 * Builds a `replaceGeometry` command — the commit shape for whole-shape
 * resize, rotate, and freehand reshape gestures alike, per `command.ts`'s
 * module doc comment: the domain only cares what the new shape is, not how a
 * client derived it.
 */
export function buildReplaceGeometryCommand(
  objectId: string,
  expectedRevision: number,
  geometry: Geometry,
): ReplaceGeometryPayload {
  return { type: 'replaceGeometry', objectId, expectedRevision, geometry };
}

/**
 * Builds an `editVertex` command. `position` is required for `insert` and
 * `move`, and omitted for `remove` — enforced by the call sites in
 * `use-map-editor-geometry-actions.ts`, not by this builder's signature,
 * since the contract itself expresses this as an optional field rather than
 * a discriminated union.
 */
export function buildEditVertexCommand(
  objectId: string,
  expectedRevision: number,
  operation: VertexOperation,
  ringIndex: number,
  vertexIndex: number,
  position?: readonly [number, number],
): EditVertexPayload {
  return {
    type: 'editVertex',
    objectId,
    expectedRevision,
    operation,
    ringIndex,
    vertexIndex,
    ...(position === undefined ? {} : { position }),
  };
}

export function buildChangePropertiesCommand(
  objectId: string,
  expectedRevision: number,
  label: string | undefined,
  categoryDetails: GardenObjectDetails | undefined,
): ChangePropertiesPayload {
  return {
    type: 'changeProperties',
    objectId,
    expectedRevision,
    ...(label === undefined ? {} : { label }),
    ...(categoryDetails === undefined ? {} : { categoryDetails }),
  };
}

/** `targetObjectId` is `null`, not omitted, to unassign a plant from its current zone or bed. */
export function buildAssignPlantCommand(
  plantObjectId: string,
  expectedRevision: number,
  targetObjectId: string | null,
): AssignPlantPayload {
  return {
    type: 'assignPlant',
    plantObjectId,
    expectedRevision,
    targetObjectId,
  };
}

export function buildDeleteObjectCommand(
  objectId: string,
  expectedRevision: number,
): DeleteObjectPayload {
  return { type: 'deleteObject', objectId, expectedRevision };
}

export function buildDuplicateObjectCommand(
  sourceObjectId: string,
  newObjectId: string,
  dx: number,
  dy: number,
): DuplicateObjectPayload {
  return {
    type: 'duplicateObject',
    sourceObjectId,
    newObjectId,
    offsetMetres: { dx, dy },
  };
}

export function buildSplitLineworkCommand(
  objectId: string,
  expectedRevision: number,
  resultObjectIds: readonly [string, string],
  atVertexIndex: number,
): SplitLineworkPayload {
  return { type: 'splitLinework', objectId, expectedRevision, resultObjectIds, atVertexIndex };
}

export function buildJoinLineworkCommand(
  firstObjectId: string,
  firstExpectedRevision: number,
  secondObjectId: string,
  secondExpectedRevision: number,
  resultObjectId: string,
): JoinLineworkPayload {
  return {
    type: 'joinLinework',
    firstObjectId,
    firstExpectedRevision,
    secondObjectId,
    secondExpectedRevision,
    resultObjectId,
  };
}
