import { describe, expect, it } from 'vitest';

import {
  buildAssignPlantCommand,
  buildChangePropertiesCommand,
  buildCreateGateObjectCommand,
  buildCreateImportedBackgroundCommand,
  buildCreateObjectCommand,
  buildDeleteObjectCommand,
  buildDuplicateObjectCommand,
  buildEditVertexCommand,
  buildJoinLineworkCommand,
  buildMoveObjectCommand,
  buildMoveObjectsCommand,
  buildReplaceGeometryCommand,
  buildSplitLineworkCommand,
  buildUpsertCalibrationCommand,
  defaultCategoryDetails,
  generateMapId,
  placeholderBackgroundGeometry,
  writableImportedBackgroundDetails,
} from './commands';

const UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

describe('generateMapId', () => {
  it('produces a UUIDv7, matching the contract Uuid pattern', () => {
    expect(generateMapId()).toMatch(UUID_V7_PATTERN);
  });

  it('produces a different id on every call', () => {
    expect(generateMapId()).not.toBe(generateMapId());
  });
});

describe('defaultCategoryDetails', () => {
  it('gives lot, path, and waterFeature no details, matching their schema having none', () => {
    expect(defaultCategoryDetails('lot')).toBeUndefined();
    expect(defaultCategoryDetails('path')).toBeUndefined();
    expect(defaultCategoryDetails('waterFeature')).toBeUndefined();
  });

  it('gives gate no default — its details are always built explicitly with a real fence id', () => {
    expect(defaultCategoryDetails('gate')).toBeUndefined();
  });

  it('gives structure and fence a schema-valid "other" kind', () => {
    expect(defaultCategoryDetails('structure')).toEqual({
      category: 'structure',
      details: { structureKind: 'other' },
    });
    expect(defaultCategoryDetails('fence')).toEqual({
      category: 'fence',
      details: { fenceKind: 'other' },
    });
  });

  it('gives zone, bed, and utilityExclusion a schema-valid "other"/"inGround" kind', () => {
    expect(defaultCategoryDetails('zone')).toEqual({
      category: 'zone',
      details: { zoneKind: 'other' },
    });
    expect(defaultCategoryDetails('bed')).toEqual({
      category: 'bed',
      details: { bedKind: 'inGround' },
    });
    expect(defaultCategoryDetails('utilityExclusion')).toEqual({
      category: 'utilityExclusion',
      details: { utilityExclusionKind: 'other' },
    });
  });

  it('gives annotation empty details — measurement is optional, added later', () => {
    expect(defaultCategoryDetails('annotation')).toEqual({
      category: 'annotation',
      details: {},
    });
  });

  it('gives plant the required commonName and quantity fields', () => {
    expect(defaultCategoryDetails('plant')).toEqual({
      category: 'plant',
      details: { commonName: 'Unidentified plant', quantity: 1 },
    });
  });
});

describe('command builders', () => {
  const objectId = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0b';
  const secondObjectId = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0c';
  const thirdObjectId = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0d';

  it('builds a createObject command with the category default details', () => {
    const command = buildCreateObjectCommand(objectId, 'tree', {
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [2, 0],
          [1, 2],
          [0, 0],
        ],
      ],
    });

    expect(command).toEqual({
      type: 'createObject',
      objectId,
      category: 'tree',
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [0, 0],
            [2, 0],
            [1, 2],
            [0, 0],
          ],
        ],
      },
      categoryDetails: { category: 'tree', details: {} },
    });
  });

  it('omits categoryDetails for lot, which has none', () => {
    const command = buildCreateObjectCommand(objectId, 'lot', {
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 0],
        ],
      ],
    });
    expect(command.categoryDetails).toBeUndefined();
  });

  it('builds a gate createObject command with the real picked fenceObjectId, no width', () => {
    const geometry = {
      type: 'LineString' as const,
      coordinates: [
        [0, 0],
        [1, 0],
      ] as const,
    };
    const command = buildCreateGateObjectCommand(objectId, geometry, secondObjectId);

    expect(command).toEqual({
      type: 'createObject',
      objectId,
      category: 'gate',
      geometry,
      categoryDetails: { category: 'gate', details: { fenceObjectId: secondObjectId } },
    });
  });

  it('builds a gate createObject command carrying an optional widthMetres', () => {
    const geometry = {
      type: 'LineString' as const,
      coordinates: [
        [0, 0],
        [1, 0],
      ] as const,
    };
    const command = buildCreateGateObjectCommand(objectId, geometry, secondObjectId, 1.2);

    expect(command.categoryDetails).toEqual({
      category: 'gate',
      details: { fenceObjectId: secondObjectId, widthMetres: 1.2 },
    });
  });

  it('builds a moveObject command carrying the expected revision and translation', () => {
    expect(buildMoveObjectCommand(objectId, 4, 1.5, -0.5)).toEqual({
      type: 'moveObject',
      objectId,
      expectedRevision: 4,
      translationMetres: { dx: 1.5, dy: -0.5 },
    });
  });

  it('builds one atomic moveObjects command for a working selection', () => {
    expect(
      buildMoveObjectsCommand(
        [
          { id: objectId, revision: 4 },
          { id: secondObjectId, revision: 7 },
        ],
        1.5,
        -0.5,
      ),
    ).toEqual({
      type: 'moveObjects',
      targets: [
        { objectId, expectedRevision: 4 },
        { objectId: secondObjectId, expectedRevision: 7 },
      ],
      translationMetres: { dx: 1.5, dy: -0.5 },
    });
  });

  it('builds a replaceGeometry command carrying the full new geometry', () => {
    const geometry = { type: 'Point' as const, coordinates: [3, 4] as const };
    expect(buildReplaceGeometryCommand(objectId, 2, geometry)).toEqual({
      type: 'replaceGeometry',
      objectId,
      expectedRevision: 2,
      geometry,
    });
  });

  it('builds an editVertex "move" command carrying a position', () => {
    expect(buildEditVertexCommand(objectId, 3, 'move', 0, 1, [5, 6])).toEqual({
      type: 'editVertex',
      objectId,
      expectedRevision: 3,
      operation: 'move',
      ringIndex: 0,
      vertexIndex: 1,
      position: [5, 6],
    });
  });

  it('builds an editVertex "remove" command omitting position', () => {
    const command = buildEditVertexCommand(objectId, 3, 'remove', 0, 1);
    expect(command).toEqual({
      type: 'editVertex',
      objectId,
      expectedRevision: 3,
      operation: 'remove',
      ringIndex: 0,
      vertexIndex: 1,
    });
    expect('position' in command).toBe(false);
  });

  it('builds a changeProperties command that omits an undefined label', () => {
    const command = buildChangePropertiesCommand(objectId, 2, undefined, {
      category: 'zone',
      details: { zoneKind: 'lawn' },
    });
    expect(command).toEqual({
      type: 'changeProperties',
      objectId,
      expectedRevision: 2,
      categoryDetails: { category: 'zone', details: { zoneKind: 'lawn' } },
    });
    expect('label' in command).toBe(false);
  });

  it('builds an assignPlant command carrying an explicit null target', () => {
    expect(buildAssignPlantCommand(objectId, 5, null)).toEqual({
      type: 'assignPlant',
      plantObjectId: objectId,
      expectedRevision: 5,
      targetObjectId: null,
    });
  });

  it('builds an assignPlant command carrying a real target', () => {
    expect(buildAssignPlantCommand(objectId, 5, secondObjectId)).toEqual({
      type: 'assignPlant',
      plantObjectId: objectId,
      expectedRevision: 5,
      targetObjectId: secondObjectId,
    });
  });

  it('builds a deleteObject command', () => {
    expect(buildDeleteObjectCommand(objectId, 7)).toEqual({
      type: 'deleteObject',
      objectId,
      expectedRevision: 7,
    });
  });

  it('builds a duplicateObject command carrying source, new id, and offset', () => {
    expect(buildDuplicateObjectCommand(objectId, secondObjectId, 1, 1)).toEqual({
      type: 'duplicateObject',
      sourceObjectId: objectId,
      newObjectId: secondObjectId,
      offsetMetres: { dx: 1, dy: 1 },
    });
  });

  it('builds a splitLinework command carrying both result ids and the split vertex', () => {
    expect(buildSplitLineworkCommand(objectId, 2, [secondObjectId, thirdObjectId], 3)).toEqual({
      type: 'splitLinework',
      objectId,
      expectedRevision: 2,
      resultObjectIds: [secondObjectId, thirdObjectId],
      atVertexIndex: 3,
    });
  });

  it('builds a joinLinework command carrying both sources and the result id', () => {
    expect(buildJoinLineworkCommand(objectId, 2, secondObjectId, 5, thirdObjectId)).toEqual({
      type: 'joinLinework',
      firstObjectId: objectId,
      firstExpectedRevision: 2,
      secondObjectId,
      secondExpectedRevision: 5,
      resultObjectId: thirdObjectId,
    });
  });
});

describe('buildCreateImportedBackgroundCommand (P6-PLAN-01)', () => {
  const objectId = '018f3a00-0000-7000-8000-000000000001';
  const planMediaId = '018f3a00-0000-7000-8000-000000000002';

  it('builds an uncalibrated, visible background at the placeholder placement', () => {
    const command = buildCreateImportedBackgroundCommand(objectId, planMediaId, 'plan.jpg');

    expect(command).toEqual({
      type: 'createObject',
      objectId,
      category: 'importedBackground',
      geometry: placeholderBackgroundGeometry(),
      label: 'plan.jpg',
      categoryDetails: {
        category: 'importedBackground',
        details: {
          planMediaId,
          isBackgroundVisible: true,
          calibrationState: 'uncalibrated',
        },
      },
    });
  });

  it('carries an explicit page selection above 1, and normalizes page 1 to absent', () => {
    const paged = buildCreateImportedBackgroundCommand(objectId, planMediaId, 'plan.pdf', 3);
    expect(paged.categoryDetails).toMatchObject({
      details: { sourcePageNumber: 3 },
    });

    const firstPage = buildCreateImportedBackgroundCommand(objectId, planMediaId, 'plan.pdf', 1);
    expect(firstPage.categoryDetails).toEqual({
      category: 'importedBackground',
      details: {
        planMediaId,
        isBackgroundVisible: true,
        calibrationState: 'uncalibrated',
      },
    });
  });

  it('uses a closed square Polygon as the placeholder', () => {
    const geometry = placeholderBackgroundGeometry();
    expect(geometry.type).toBe('Polygon');
    if (geometry.type === 'Polygon') {
      const ring = geometry.coordinates[0] ?? [];
      expect(ring).toHaveLength(5);
      expect(ring[0]).toEqual(ring[ring.length - 1]);
    }
  });
});

describe('buildUpsertCalibrationCommand', () => {
  const objectId = '01890000-0000-7000-8000-00000000000b';

  it('carries the full derivation input set, revision-guarded', () => {
    const command = buildUpsertCalibrationCommand(objectId, 4, {
      pageAspectRatio: 0.75,
      knownDistance: { pointA: [0.1, 0.1], pointB: [0.6, 0.1], distanceMetres: 10 },
      referencePoints: [{ planPoint: [0, 0], localMetres: [2, 1] }],
      manualAdjustment: { rotationRadians: 0.1, translationMetres: { dx: 1, dy: -1 } },
    });

    expect(command).toEqual({
      type: 'upsertCalibration',
      backgroundObjectId: objectId,
      expectedRevision: 4,
      pageAspectRatio: 0.75,
      knownDistance: { pointA: [0.1, 0.1], pointB: [0.6, 0.1], distanceMetres: 10 },
      referencePoints: [{ planPoint: [0, 0], localMetres: [2, 1] }],
      manualAdjustment: { rotationRadians: 0.1, translationMetres: { dx: 1, dy: -1 } },
    });
  });

  it('omits an absent manual adjustment instead of sending null', () => {
    const command = buildUpsertCalibrationCommand(objectId, 1, {
      pageAspectRatio: 1,
      knownDistance: { pointA: [0, 0], pointB: [1, 0], distanceMetres: 8 },
      referencePoints: [],
    });
    expect('manualAdjustment' in command).toBe(false);
  });
});

describe('writableImportedBackgroundDetails', () => {
  it('strips the server-owned calibration block and keeps every writable field', () => {
    const details = {
      planMediaId: '01890000-0000-7000-8000-00000000000c',
      sourcePageNumber: 2,
      isBackgroundVisible: false,
      calibrationState: 'calibrated' as const,
      calibration: {
        transformRevision: 1,
        pageAspectRatio: 1,
        knownDistance: { pointA: [0, 0] as const, pointB: [1, 0] as const, distanceMetres: 8 },
        referencePoints: [],
        transform: {
          metresPerPlanUnit: 8,
          rotationRadians: 0,
          translationMetres: { x: 0, y: 0 },
        },
        rmsErrorMetres: null,
      },
    };

    expect(writableImportedBackgroundDetails(details)).toEqual({
      planMediaId: '01890000-0000-7000-8000-00000000000c',
      sourcePageNumber: 2,
      isBackgroundVisible: false,
      calibrationState: 'calibrated',
    });
  });
});
