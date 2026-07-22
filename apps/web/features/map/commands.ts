/**
 * Pure builders for the five command types this pass wires end to end:
 * create, move, change properties, delete — plus restore, which a user never
 * builds directly, only `deriveInverseCommand` does, as the inverse of delete.
 *
 * `replaceGeometry`, `editVertex`, `splitLinework`, `joinLinework`,
 * `assignPlant`, `upsertCalibration`, and `decideProposal` are left
 * unimplemented on purpose — see this work package's final report for why
 * each one is out of scope this pass (freehand vertex reshaping, split/join
 * linework UI, and calibration are explicitly out of scope; plant assignment
 * and proposal review need UI this pass does not build).
 */

import type {
  ChangePropertiesPayload,
  CreateObjectPayload,
  DeleteObjectPayload,
  GardenObjectDetails,
  Geometry,
  MoveObjectPayload,
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
 * an empty state immediately after creation. `lot` has no details schema.
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
    case 'tree':
      return { category: 'tree', details: {} };
    case 'plant':
      return { category: 'plant', details: { commonName: '', quantity: 1 } };
  }
}

export function buildCreateObjectCommand(
  objectId: string,
  category: CreatableCategory,
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

export function buildDeleteObjectCommand(
  objectId: string,
  expectedRevision: number,
): DeleteObjectPayload {
  return { type: 'deleteObject', objectId, expectedRevision };
}
