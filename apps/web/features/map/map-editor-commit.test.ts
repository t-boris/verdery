import type { MapCommandPayload } from '@verdery/geometry-contracts';
import { describe, expect, it } from 'vitest';

import { commandNeedsPriorSnapshot, objectIdOf } from './map-editor-commit';

const objectId = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0b';
const otherObjectId = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0c';

describe('objectIdOf', () => {
  it('reads `objectId` for every command type that carries one directly', () => {
    const cases: MapCommandPayload[] = [
      {
        type: 'createObject',
        objectId,
        category: 'tree',
        geometry: { type: 'Point', coordinates: [0, 0] },
      },
      { type: 'moveObject', objectId, expectedRevision: 1, translationMetres: { dx: 0, dy: 0 } },
      {
        type: 'replaceGeometry',
        objectId,
        expectedRevision: 1,
        geometry: { type: 'Point', coordinates: [0, 0] },
      },
      {
        type: 'editVertex',
        objectId,
        expectedRevision: 1,
        operation: 'remove',
        ringIndex: 0,
        vertexIndex: 0,
      },
      { type: 'changeProperties', objectId, expectedRevision: 1 },
      { type: 'deleteObject', objectId, expectedRevision: 1 },
      { type: 'restoreObject', objectId, expectedRevision: 1 },
      {
        type: 'splitLinework',
        objectId,
        expectedRevision: 1,
        resultObjectIds: [otherObjectId, otherObjectId],
        atVertexIndex: 1,
      },
    ];

    for (const command of cases) {
      expect(objectIdOf(command)).toBe(objectId);
    }
  });

  it('reads `newObjectId` for duplicateObject', () => {
    const command: MapCommandPayload = {
      type: 'duplicateObject',
      sourceObjectId: objectId,
      newObjectId: otherObjectId,
      offsetMetres: { dx: 1, dy: 1 },
    };
    expect(objectIdOf(command)).toBe(otherObjectId);
  });

  it('reads `plantObjectId` for assignPlant', () => {
    const command: MapCommandPayload = {
      type: 'assignPlant',
      plantObjectId: objectId,
      expectedRevision: 1,
      targetObjectId: null,
    };
    expect(objectIdOf(command)).toBe(objectId);
  });

  it('reads `resultObjectId` for joinLinework', () => {
    const command: MapCommandPayload = {
      type: 'joinLinework',
      firstObjectId: objectId,
      firstExpectedRevision: 1,
      secondObjectId: otherObjectId,
      secondExpectedRevision: 1,
      resultObjectId: otherObjectId,
    };
    expect(objectIdOf(command)).toBe(otherObjectId);
  });

  it('throws for command types this feature never constructs', () => {
    const command: MapCommandPayload = {
      type: 'upsertCalibration',
      backgroundObjectId: objectId,
      referencePoints: [],
    };
    expect(() => objectIdOf(command)).toThrow(/upsertCalibration/);
  });
});

describe('commandNeedsPriorSnapshot', () => {
  it('is true for changeProperties, replaceGeometry, editVertex, and assignPlant', () => {
    expect(commandNeedsPriorSnapshot('changeProperties')).toBe(true);
    expect(commandNeedsPriorSnapshot('replaceGeometry')).toBe(true);
    expect(commandNeedsPriorSnapshot('editVertex')).toBe(true);
    expect(commandNeedsPriorSnapshot('assignPlant')).toBe(true);
  });

  it('is false for every other command type', () => {
    expect(commandNeedsPriorSnapshot('createObject')).toBe(false);
    expect(commandNeedsPriorSnapshot('moveObject')).toBe(false);
    expect(commandNeedsPriorSnapshot('deleteObject')).toBe(false);
    expect(commandNeedsPriorSnapshot('restoreObject')).toBe(false);
    expect(commandNeedsPriorSnapshot('duplicateObject')).toBe(false);
    expect(commandNeedsPriorSnapshot('splitLinework')).toBe(false);
    expect(commandNeedsPriorSnapshot('joinLinework')).toBe(false);
    expect(commandNeedsPriorSnapshot('upsertCalibration')).toBe(false);
    expect(commandNeedsPriorSnapshot('decideProposal')).toBe(false);
  });
});
