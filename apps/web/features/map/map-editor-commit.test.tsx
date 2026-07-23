import type { MapCommandPayload } from '@verdery/geometry-contracts';
import { onlineManager } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MapEditorStoreProvider, useMapEditorStore } from './editor-store';
import { commandNeedsPriorSnapshot, objectIdOf, useCommandCommit } from './map-editor-commit';

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

function wrapper({ children }: { readonly children: ReactNode }) {
  return <MapEditorStoreProvider>{children}</MapEditorStoreProvider>;
}

const CREATE_COMMAND: MapCommandPayload = {
  type: 'createObject',
  objectId,
  category: 'tree',
  geometry: { type: 'Point', coordinates: [0, 0] },
};

describe('useCommandCommit — offline gate (P5-WEB-01)', () => {
  afterEach(() => {
    act(() => onlineManager.setOnline(true));
  });

  it('rejects a command without ever calling the mutation while the browser is offline', async () => {
    act(() => onlineManager.setOnline(false));
    const mutateAsync = vi.fn();

    const { result } = renderHook(
      () => {
        const store = useMapEditorStore();
        const commit = useCommandCommit(store, { mutateAsync }, () => null);
        return { store, commit };
      },
      { wrapper },
    );

    const affected = await act(() => result.current.commit(CREATE_COMMAND, null));

    expect(affected).toBeNull();
    expect(mutateAsync).not.toHaveBeenCalled();
    expect(result.current.store.state.status).toEqual({
      key: 'map.status.offline',
      tone: 'alert',
    });
  });

  it('submits normally while online', async () => {
    const affectedRecord = [
      {
        id: objectId,
        gardenId: 'garden-1',
        category: 'tree' as const,
        geometry: { type: 'Point' as const, coordinates: [0, 0] },
        lifecycleState: 'active' as const,
        revision: 1,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ];
    const mutateAsync = vi.fn().mockResolvedValue(affectedRecord);

    const { result } = renderHook(
      () => {
        const store = useMapEditorStore();
        const commit = useCommandCommit(store, { mutateAsync }, () => null);
        return { store, commit };
      },
      { wrapper },
    );

    const affected = await act(() => result.current.commit(CREATE_COMMAND, null));

    expect(mutateAsync).toHaveBeenCalledWith(CREATE_COMMAND);
    expect(affected).toEqual(affectedRecord);
  });
});
