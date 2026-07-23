import type { MoveObjectPayload } from '@verdery/geometry-contracts';
import { describe, expect, it } from 'vitest';

import { editorReducer, initialEditorState, type HistoryEntry } from './editor-store';

function moveEntry(objectId: string, revision: number): HistoryEntry {
  const command: MoveObjectPayload = {
    type: 'moveObject',
    objectId,
    expectedRevision: revision - 1,
    translationMetres: { dx: 1, dy: 0 },
  };
  return { command, priorSnapshot: null, revisionAfterCommand: revision, objectId };
}

describe('editorReducer', () => {
  it('selects and deselects', () => {
    const selected = editorReducer(initialEditorState, { type: 'select', objectId: 'obj-1' });
    expect(selected.selectedObjectId).toBe('obj-1');

    const deselected = editorReducer(selected, { type: 'select', objectId: null });
    expect(deselected.selectedObjectId).toBeNull();
  });

  it('clears the in-progress draft whenever the tool changes', () => {
    const drafting = editorReducer(initialEditorState, {
      type: 'setDraftPoints',
      points: [[0, 0]],
    });
    expect(drafting.draftPoints).toEqual([[0, 0]]);

    const toolChanged = editorReducer(drafting, { type: 'setTool', tool: 'create:fence' });
    expect(toolChanged.tool).toBe('create:fence');
    expect(toolChanged.draftPoints).toEqual([]);
  });

  it('clears a pending gate geometry and leaves interaction mode whenever the tool changes', () => {
    const pending = editorReducer(initialEditorState, {
      type: 'setPendingGateGeometry',
      geometry: {
        type: 'LineString',
        coordinates: [
          [0, 0],
          [1, 0],
        ],
      },
    });
    const inTransform = editorReducer(pending, { type: 'setInteractionMode', mode: 'transform' });

    const toolChanged = editorReducer(inTransform, { type: 'setTool', tool: 'select' });
    expect(toolChanged.pendingGateGeometry).toBeNull();
    expect(toolChanged.interactionMode).toBe('idle');
  });

  it('leaves vertex-edit or transform mode whenever the selection changes', () => {
    const selected = editorReducer(initialEditorState, { type: 'select', objectId: 'obj-1' });
    const editing = editorReducer(selected, { type: 'setInteractionMode', mode: 'vertexEdit' });
    expect(editing.interactionMode).toBe('vertexEdit');

    const reselected = editorReducer(editing, { type: 'select', objectId: 'obj-2' });
    expect(reselected.interactionMode).toBe('idle');
  });

  it('toggles an id in and out of the multi-select set', () => {
    const added = editorReducer(initialEditorState, {
      type: 'toggleMultiSelect',
      objectId: 'obj-1',
    });
    expect(added.multiSelectedObjectIds).toEqual(['obj-1']);

    const addedSecond = editorReducer(added, { type: 'toggleMultiSelect', objectId: 'obj-2' });
    expect(addedSecond.multiSelectedObjectIds).toEqual(['obj-1', 'obj-2']);

    const removedFirst = editorReducer(addedSecond, {
      type: 'toggleMultiSelect',
      objectId: 'obj-1',
    });
    expect(removedFirst.multiSelectedObjectIds).toEqual(['obj-2']);

    const cleared = editorReducer(removedFirst, { type: 'clearMultiSelect' });
    expect(cleared.multiSelectedObjectIds).toEqual([]);
  });

  it('toggles a layer in and out of the hidden set', () => {
    const hidden = editorReducer(initialEditorState, { type: 'toggleLayerVisibility', layer: 4 });
    expect(hidden.hiddenLayers).toEqual([4]);

    const shown = editorReducer(hidden, { type: 'toggleLayerVisibility', layer: 4 });
    expect(shown.hiddenLayers).toEqual([]);
  });

  it('toggles a layer in and out of the locked set, independent of hidden layers', () => {
    const locked = editorReducer(initialEditorState, { type: 'toggleLayerLock', layer: 3 });
    expect(locked.lockedLayers).toEqual([3]);
    expect(locked.hiddenLayers).toEqual([]);

    const unlocked = editorReducer(locked, { type: 'toggleLayerLock', layer: 3 });
    expect(unlocked.lockedLayers).toEqual([]);
  });

  it('sets the camera only once via initCamera, ignoring later calls', () => {
    const camera = { centerX: 5, centerY: 5, scale: 30 };
    const initialized = editorReducer(initialEditorState, { type: 'initCamera', camera });
    expect(initialized.camera).toEqual(camera);
    expect(initialized.cameraInitialized).toBe(true);

    const secondAttempt = editorReducer(initialized, {
      type: 'initCamera',
      camera: { centerX: 0, centerY: 0, scale: 1 },
    });
    expect(secondAttempt.camera).toEqual(camera);
  });

  it('pushing a forward command clears the redo stack', () => {
    const withRedo = { ...initialEditorState, redoStack: [moveEntry('obj-1', 2)] };
    const next = editorReducer(withRedo, { type: 'pushForward', entry: moveEntry('obj-2', 1) });

    expect(next.undoStack).toHaveLength(1);
    expect(next.redoStack).toHaveLength(0);
  });

  it('undo moves the top undo entry onto the redo stack', () => {
    const withUndo = { ...initialEditorState, undoStack: [moveEntry('obj-1', 1)] };
    const redoEntry = moveEntry('obj-1', 2);

    const next = editorReducer(withUndo, { type: 'undoApplied', redoEntry });

    expect(next.undoStack).toHaveLength(0);
    expect(next.redoStack).toEqual([redoEntry]);
  });

  it('redo moves the top redo entry onto the undo stack', () => {
    const withRedo = { ...initialEditorState, redoStack: [moveEntry('obj-1', 2)] };
    const undoEntry = moveEntry('obj-1', 3);

    const next = editorReducer(withRedo, { type: 'redoApplied', undoEntry });

    expect(next.redoStack).toHaveLength(0);
    expect(next.undoStack).toEqual([undoEntry]);
  });
});
