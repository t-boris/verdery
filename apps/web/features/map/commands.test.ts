import { describe, expect, it } from 'vitest';

import {
  buildAssignPlantCommand,
  buildChangePropertiesCommand,
  buildCreateGateObjectCommand,
  buildCreateObjectCommand,
  buildDeleteObjectCommand,
  buildDuplicateObjectCommand,
  buildEditVertexCommand,
  buildJoinLineworkCommand,
  buildMoveObjectCommand,
  buildReplaceGeometryCommand,
  buildSplitLineworkCommand,
  defaultCategoryDetails,
  generateMapId,
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
      details: { commonName: '', quantity: 1 },
    });
  });
});

describe('command builders', () => {
  const objectId = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0b';
  const secondObjectId = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0c';
  const thirdObjectId = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0d';

  it('builds a createObject command with the category default details', () => {
    const command = buildCreateObjectCommand(objectId, 'tree', {
      type: 'Point',
      coordinates: [1, 2],
    });

    expect(command).toEqual({
      type: 'createObject',
      objectId,
      category: 'tree',
      geometry: { type: 'Point', coordinates: [1, 2] },
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
