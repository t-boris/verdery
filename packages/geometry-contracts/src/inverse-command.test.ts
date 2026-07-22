import { describe, expect, it } from 'vitest';
import { loadFixture } from '@verdery/test-fixtures';
import type { CommandInverseFixture } from '@verdery/test-fixtures';

import { deriveInverseCommand } from './inverse-command.js';
import type { ObjectSnapshot } from './inverse-command.js';
import type { MapCommandPayload } from './command.js';

const fixture = loadFixture<CommandInverseFixture>('geometry/command-inverse.json');

describe('deriveInverseCommand fixture', () => {
  it('uses the expected schema version', () => {
    expect(fixture.schemaVersion).toBe(1);
  });

  it.each(fixture.cases.map((testCase) => [testCase.name, testCase] as const))(
    'derives the inverse for %s',
    (_name, testCase) => {
      const inverse = deriveInverseCommand(
        testCase.command as MapCommandPayload,
        testCase.priorSnapshot as ObjectSnapshot | null,
        testCase.revisionAfterCommand,
      );
      expect(inverse).toEqual(testCase.expectedInverse);
    },
  );
});

describe('deriveInverseCommand', () => {
  it('round-trips a move: applying the inverse of an inverse returns the original translation', () => {
    const command: MapCommandPayload = {
      type: 'moveObject',
      objectId: 'obj-1',
      expectedRevision: 1,
      translationMetres: { dx: 3, dy: -2 },
    };

    const inverse = deriveInverseCommand(command, null, 2);
    expect(inverse).not.toBeNull();

    const roundTrip = deriveInverseCommand(inverse as MapCommandPayload, null, 3);
    expect(roundTrip).toEqual({
      type: 'moveObject',
      objectId: 'obj-1',
      expectedRevision: 3,
      translationMetres: { dx: 3, dy: -2 },
    });
  });

  it('returns null for editVertex move when the referenced vertex index does not exist in the prior geometry', () => {
    const command: MapCommandPayload = {
      type: 'editVertex',
      objectId: 'obj-1',
      expectedRevision: 1,
      operation: 'move',
      ringIndex: 0,
      vertexIndex: 99,
      position: [1, 1],
    };
    const priorSnapshot: ObjectSnapshot = {
      objectId: 'obj-1',
      category: 'zone',
      geometry: { type: 'Point', coordinates: [0, 0] },
      lifecycleState: 'active',
    };

    expect(deriveInverseCommand(command, priorSnapshot, 2)).toBeNull();
  });
});
