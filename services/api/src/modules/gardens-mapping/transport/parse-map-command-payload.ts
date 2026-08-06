/**
 * Hand-written, per-type parsing of the thirteen `MapCommandPayload`
 * variants, matching `packages/api-contracts/openapi.yaml`'s
 * `MapCommandPayload` `oneOf` (discriminated on `type`) and returning values
 * shaped exactly like `@verdery/geometry-contracts`'s own payload
 * interfaces — the two were designed together, so every field name here
 * matches both.
 *
 * Same hand-written-validation convention as the rest of this transport
 * layer; see `garden-routes.ts`'s header comment for why no generated
 * Fastify JSON-schema bridge exists yet.
 */

import type {
  CreateObjectSource,
  MapCommandPayload,
  VertexOperation,
} from '@verdery/geometry-contracts';
import { invalid } from './garden-routes.js';
import { parseAerialObjectSourceMetadata } from './parse-aerial-object-source.js';
import { requireGeometry } from './parse-geometry.js';
import { requireOptionalGardenObjectDetails } from './parse-garden-object-details.js';
import {
  requireEnum,
  requireInteger,
  requireNumber,
  requireOptionalString,
  requireRecord,
  requireString,
  requireUuid,
  requireUuidOrNull,
} from './parse-primitives.js';

const GARDEN_OBJECT_CATEGORIES = [
  'lot',
  'structure',
  'fence',
  'gate',
  'path',
  'zone',
  'bed',
  'waterFeature',
  'utilityExclusion',
  'tree',
  'plant',
  'annotation',
  'importedBackground',
] as const;

const PROVENANCE_KINDS = [
  'manualDrawing',
  'userMeasurement',
  'importedPlan',
  'importedMapImagery',
  'arMeasurement',
  'imageExtraction',
  'depthCapture',
  'externalProvider',
  'processor',
] as const;

const VERTEX_OPERATIONS: readonly VertexOperation[] = ['insert', 'move', 'remove'];
const PROPOSAL_DECISIONS = ['accept', 'modifyAndAccept', 'reject'] as const;

/** `undefined` when the client claimed nothing, which is the ordinary hand-drawn case. */
function parseCreateObjectSource(value: unknown, pointer: string): CreateObjectSource | undefined {
  if (value === undefined) {
    return undefined;
  }
  const record = requireRecord(value, pointer);
  const provenance = requireEnum(record['provenance'], PROVENANCE_KINDS, `${pointer}/provenance`);
  const rawConfidence = record['confidence'];
  const rawMetadata = record['metadata'];
  const metadata =
    rawMetadata === undefined
      ? undefined
      : parseAerialObjectSourceMetadata(rawMetadata, `${pointer}/metadata`);
  if (metadata !== undefined && provenance !== 'imageExtraction') {
    throw invalid(
      `${pointer}/metadata requires imageExtraction provenance.`,
      'request.invalid',
      `${pointer}/metadata`,
    );
  }
  if (rawConfidence === undefined) {
    return { provenance, ...(metadata === undefined ? {} : { metadata }) };
  }
  const confidence = requireNumber(rawConfidence, `${pointer}/confidence`);
  if (confidence < 0 || confidence > 1) {
    throw invalid(
      `${pointer}/confidence must be between 0 and 1.`,
      'request.confidence.invalid',
      `${pointer}/confidence`,
    );
  }
  return { provenance, confidence, ...(metadata === undefined ? {} : { metadata }) };
}

function requireOffset(value: unknown, pointer: string): { dx: number; dy: number } {
  const record = requireRecord(value, pointer);
  return {
    dx: requireNumber(record['dx'], `${pointer}/dx`),
    dy: requireNumber(record['dy'], `${pointer}/dy`),
  };
}

function requirePosition(value: unknown, pointer: string): readonly [number, number] {
  if (!Array.isArray(value) || value.length !== 2) {
    throw invalid(`${pointer} must be a [x, y] pair.`, 'request.position.invalid', pointer);
  }
  return [requireNumber(value[0], `${pointer}/0`), requireNumber(value[1], `${pointer}/1`)];
}

export function parseMapCommandPayload(value: unknown, pointer: string): MapCommandPayload {
  const record = requireRecord(value, pointer);
  const type = requireString(record['type'], `${pointer}/type`);

  switch (type) {
    case 'createObject': {
      const category = requireEnum(
        record['category'],
        GARDEN_OBJECT_CATEGORIES,
        `${pointer}/category`,
      );
      const geometry = requireGeometry(record['geometry'], `${pointer}/geometry`);
      const label = requireOptionalString(record['label'], `${pointer}/label`);
      const categoryDetails = requireOptionalGardenObjectDetails(
        record['categoryDetails'],
        `${pointer}/categoryDetails`,
      );
      const source = parseCreateObjectSource(record['source'], `${pointer}/source`);
      return {
        type: 'createObject',
        objectId: requireUuid(record['objectId'], `${pointer}/objectId`),
        category,
        geometry,
        ...(label === undefined ? {} : { label }),
        ...(categoryDetails === undefined ? {} : { categoryDetails }),
        ...(source === undefined ? {} : { source }),
      };
    }

    case 'moveObject':
      return {
        type: 'moveObject',
        objectId: requireUuid(record['objectId'], `${pointer}/objectId`),
        expectedRevision: requireInteger(
          record['expectedRevision'],
          `${pointer}/expectedRevision`,
          1,
        ),
        translationMetres: requireOffset(
          record['translationMetres'],
          `${pointer}/translationMetres`,
        ),
      };

    case 'replaceGeometry':
      return {
        type: 'replaceGeometry',
        objectId: requireUuid(record['objectId'], `${pointer}/objectId`),
        expectedRevision: requireInteger(
          record['expectedRevision'],
          `${pointer}/expectedRevision`,
          1,
        ),
        geometry: requireGeometry(record['geometry'], `${pointer}/geometry`),
      };

    case 'editVertex': {
      const operation = requireEnum(record['operation'], VERTEX_OPERATIONS, `${pointer}/operation`);
      const rawPosition = record['position'];
      const position =
        rawPosition === undefined ? undefined : requirePosition(rawPosition, `${pointer}/position`);
      return {
        type: 'editVertex',
        objectId: requireUuid(record['objectId'], `${pointer}/objectId`),
        expectedRevision: requireInteger(
          record['expectedRevision'],
          `${pointer}/expectedRevision`,
          1,
        ),
        operation,
        ringIndex: requireInteger(record['ringIndex'], `${pointer}/ringIndex`, 0),
        vertexIndex: requireInteger(record['vertexIndex'], `${pointer}/vertexIndex`, 0),
        ...(position === undefined ? {} : { position }),
      };
    }

    case 'splitLinework': {
      const resultObjectIds = record['resultObjectIds'];
      if (!Array.isArray(resultObjectIds) || resultObjectIds.length !== 2) {
        throw invalid(
          `${pointer}/resultObjectIds must contain exactly two UUIDs.`,
          'request.invalid',
          `${pointer}/resultObjectIds`,
        );
      }
      const resultObjectIdsArray: readonly unknown[] = resultObjectIds;
      return {
        type: 'splitLinework',
        objectId: requireUuid(record['objectId'], `${pointer}/objectId`),
        expectedRevision: requireInteger(
          record['expectedRevision'],
          `${pointer}/expectedRevision`,
          1,
        ),
        resultObjectIds: [
          requireUuid(resultObjectIdsArray[0], `${pointer}/resultObjectIds/0`),
          requireUuid(resultObjectIdsArray[1], `${pointer}/resultObjectIds/1`),
        ],
        atVertexIndex: requireInteger(record['atVertexIndex'], `${pointer}/atVertexIndex`, 0),
      };
    }

    case 'joinLinework':
      return {
        type: 'joinLinework',
        firstObjectId: requireUuid(record['firstObjectId'], `${pointer}/firstObjectId`),
        firstExpectedRevision: requireInteger(
          record['firstExpectedRevision'],
          `${pointer}/firstExpectedRevision`,
          1,
        ),
        secondObjectId: requireUuid(record['secondObjectId'], `${pointer}/secondObjectId`),
        secondExpectedRevision: requireInteger(
          record['secondExpectedRevision'],
          `${pointer}/secondExpectedRevision`,
          1,
        ),
        resultObjectId: requireUuid(record['resultObjectId'], `${pointer}/resultObjectId`),
      };

    case 'changeProperties': {
      const label = requireOptionalString(record['label'], `${pointer}/label`);
      const categoryDetails = requireOptionalGardenObjectDetails(
        record['categoryDetails'],
        `${pointer}/categoryDetails`,
      );
      return {
        type: 'changeProperties',
        objectId: requireUuid(record['objectId'], `${pointer}/objectId`),
        expectedRevision: requireInteger(
          record['expectedRevision'],
          `${pointer}/expectedRevision`,
          1,
        ),
        ...(label === undefined ? {} : { label }),
        ...(categoryDetails === undefined ? {} : { categoryDetails }),
      };
    }

    case 'assignPlant':
      return {
        type: 'assignPlant',
        plantObjectId: requireUuid(record['plantObjectId'], `${pointer}/plantObjectId`),
        expectedRevision: requireInteger(
          record['expectedRevision'],
          `${pointer}/expectedRevision`,
          1,
        ),
        targetObjectId: requireUuidOrNull(record['targetObjectId'], `${pointer}/targetObjectId`),
      };

    case 'upsertCalibration': {
      const referencePointsRaw = record['referencePoints'];
      // May be empty — a known distance plus manual placement is a
      // legitimate calibration — but must still be present as an array.
      if (!Array.isArray(referencePointsRaw)) {
        throw invalid(
          `${pointer}/referencePoints must be an array.`,
          'request.invalid',
          `${pointer}/referencePoints`,
        );
      }
      const referencePoints = referencePointsRaw.map((item, index) => {
        const itemPointer = `${pointer}/referencePoints/${String(index)}`;
        const itemRecord = requireRecord(item, itemPointer);
        return {
          planPoint: requirePosition(itemRecord['planPoint'], `${itemPointer}/planPoint`),
          localMetres: requirePosition(itemRecord['localMetres'], `${itemPointer}/localMetres`),
        };
      });

      const knownDistanceRecord = requireRecord(
        record['knownDistance'],
        `${pointer}/knownDistance`,
      );
      const knownDistance = {
        pointA: requirePosition(knownDistanceRecord['pointA'], `${pointer}/knownDistance/pointA`),
        pointB: requirePosition(knownDistanceRecord['pointB'], `${pointer}/knownDistance/pointB`),
        distanceMetres: requireNumber(
          knownDistanceRecord['distanceMetres'],
          `${pointer}/knownDistance/distanceMetres`,
        ),
      };

      const manualRaw = record['manualAdjustment'];
      let manualAdjustment;
      if (manualRaw !== undefined) {
        const manualRecord = requireRecord(manualRaw, `${pointer}/manualAdjustment`);
        manualAdjustment = {
          rotationRadians: requireNumber(
            manualRecord['rotationRadians'],
            `${pointer}/manualAdjustment/rotationRadians`,
          ),
          translationMetres: requireOffset(
            manualRecord['translationMetres'],
            `${pointer}/manualAdjustment/translationMetres`,
          ),
        };
      }

      return {
        type: 'upsertCalibration',
        backgroundObjectId: requireUuid(
          record['backgroundObjectId'],
          `${pointer}/backgroundObjectId`,
        ),
        expectedRevision: requireInteger(
          record['expectedRevision'],
          `${pointer}/expectedRevision`,
          1,
        ),
        pageAspectRatio: requireNumber(record['pageAspectRatio'], `${pointer}/pageAspectRatio`),
        knownDistance,
        referencePoints,
        ...(manualAdjustment === undefined ? {} : { manualAdjustment }),
      };
    }

    case 'decideProposal': {
      const decision = requireEnum(record['decision'], PROPOSAL_DECISIONS, `${pointer}/decision`);
      const rawEditedGeometry = record['editedGeometry'];
      const editedGeometry =
        rawEditedGeometry === undefined
          ? undefined
          : requireGeometry(rawEditedGeometry, `${pointer}/editedGeometry`);
      return {
        type: 'decideProposal',
        proposalId: requireUuid(record['proposalId'], `${pointer}/proposalId`),
        decision,
        ...(editedGeometry === undefined ? {} : { editedGeometry }),
      };
    }

    case 'deleteObject':
      return {
        type: 'deleteObject',
        objectId: requireUuid(record['objectId'], `${pointer}/objectId`),
        expectedRevision: requireInteger(
          record['expectedRevision'],
          `${pointer}/expectedRevision`,
          1,
        ),
      };

    case 'restoreObject':
      return {
        type: 'restoreObject',
        objectId: requireUuid(record['objectId'], `${pointer}/objectId`),
        expectedRevision: requireInteger(
          record['expectedRevision'],
          `${pointer}/expectedRevision`,
          1,
        ),
      };

    case 'duplicateObject':
      return {
        type: 'duplicateObject',
        sourceObjectId: requireUuid(record['sourceObjectId'], `${pointer}/sourceObjectId`),
        newObjectId: requireUuid(record['newObjectId'], `${pointer}/newObjectId`),
        offsetMetres: requireOffset(record['offsetMetres'], `${pointer}/offsetMetres`),
      };

    default:
      throw invalid(
        `${pointer}/type must be one of: createObject, moveObject, replaceGeometry, editVertex, ` +
          'splitLinework, joinLinework, changeProperties, assignPlant, upsertCalibration, ' +
          'decideProposal, deleteObject, restoreObject, duplicateObject.',
        'request.map_command.type.invalid',
        `${pointer}/type`,
      );
  }
}
