'use client';

import type { GardenObjectDetails, Geometry, Position } from '@verdery/geometry-contracts';
import { deriveInverseCommand, validateGeometry } from '@verdery/geometry-contracts';
import { useCallback } from 'react';

import {
  buildChangePropertiesCommand,
  buildCreateGateObjectCommand,
  buildCreateObjectCommand,
  buildDeleteObjectCommand,
  buildMoveObjectCommand,
  generateMapId,
} from './commands';
import type { HistoryEntry } from './editor-store';
import { useMapEditorStore } from './editor-store';
import { commandNeedsPriorSnapshot, objectIdOf, useCommandCommit } from './map-editor-commit';
import { isCategoryLocked } from './map-layers';
import { toObjectSnapshot } from './object-mapper';
import { useGardenMap, useSubmitMapCommand } from './queries';
import { deriveSaveStatus } from './save-status';
import { CREATABLE_GEOMETRY_KIND, creatableCategoryOfTool } from './types';
import type { CreatableCategory, MapObjectRecord } from './types';
import { useMapEditorGeometryActions } from './use-map-editor-geometry-actions';
import { useMapEditorLineworkActions } from './use-map-editor-linework-actions';
import { useMapEditorObjectActions } from './use-map-editor-object-actions';

/**
 * Orchestrates the map editor: combines the query cache (server state), the
 * editor store (selection/tool/undo/redo), and command construction into the
 * actions the toolbar, canvas, property panel, and object list call.
 *
 * This file owns creation, whole-object move, label/detail editing, delete,
 * and undo/redo — the original five-command slice, plus the gate-creation
 * flow (gate needs a user-picked fence before it can be created at all).
 * Vertex/whole-shape geometry edits, duplication, plant assignment, and
 * fence/path split-join live in sibling hook files
 * (`use-map-editor-geometry-actions.ts`, `use-map-editor-object-actions.ts`,
 * `use-map-editor-linework-actions.ts`) that this hook composes, each
 * built the same way: they take the shared `commit` function, `findRecord`,
 * and `store` rather than each independently calling `useSubmitMapCommand`,
 * so every action shares one mutation, one `isSubmitting` flag, and one undo
 * stack.
 *
 * Undo and redo are one operation, `stepHistory`, applied to opposite
 * stacks: derive the inverse of the top entry via `deriveInverseCommand`,
 * submit it like any other command, and push the *result* onto the other
 * stack as a new entry symmetric to the one just consumed. Repeating this
 * is what makes redo-after-undo-after-undo behave correctly without a
 * separately tracked "forward" command whose `expectedRevision` would go
 * stale the moment anything else changed the object.
 *
 * Source: architecture/map-rendering-and-editing.md, section "9. Undo and Redo".
 */
export function useMapEditorActions(gardenId: string) {
  const store = useMapEditorStore();
  const mapQuery = useGardenMap(gardenId);
  const submitMutation = useSubmitMapCommand(gardenId);

  const records: readonly MapObjectRecord[] = mapQuery.data?.objects ?? [];
  const findRecord = useCallback(
    (objectId: string) => records.find((record) => record.id === objectId) ?? null,
    [records],
  );

  const selectedRecord =
    store.state.selectedObjectId === null ? null : findRecord(store.state.selectedObjectId);

  const commit = useCommandCommit(store, submitMutation, findRecord);

  const createObject = useCallback(
    async (category: CreatableCategory, geometry: Geometry) => {
      if (category === 'gate') {
        // A gate's `fenceObjectId` is required and has no default — it must
        // go through `completeGateCreation` after the user picks a real
        // fence, never through this generic path.
        throw new Error('Gate objects must be created via completeGateCreation, not createObject.');
      }
      const objectId = generateMapId();
      const command = buildCreateObjectCommand(objectId, category, geometry);
      const affected = await commit(command, null);
      if (affected !== null) {
        store.select(objectId);
        store.setTool('select');
        store.setStatus({
          key: 'map.status.created',
          args: { label: affected[0]?.label ?? objectId },
          tone: 'status',
        });
      }
      return affected;
    },
    [commit, store],
  );

  /** Submits the gate `createObject` command once the user has picked a real fence for `store.state.pendingGateGeometry`. */
  const completeGateCreation = useCallback(
    async (fenceObjectId: string, widthMetres?: number) => {
      const geometry = store.state.pendingGateGeometry;
      if (geometry === null) {
        return null;
      }
      const objectId = generateMapId();
      const command = buildCreateGateObjectCommand(objectId, geometry, fenceObjectId, widthMetres);
      const affected = await commit(command, null);
      store.setPendingGateGeometry(null);
      if (affected !== null) {
        store.select(objectId);
        store.setStatus({
          key: 'map.status.created',
          args: { label: affected[0]?.label ?? objectId },
          tone: 'status',
        });
      }
      return affected;
    },
    [commit, store],
  );

  const cancelGateCreation = useCallback(() => {
    store.setPendingGateGeometry(null);
  }, [store]);

  const moveObject = useCallback(
    async (objectId: string, dx: number, dy: number) => {
      const record = findRecord(objectId);
      if (record === null) {
        return null;
      }
      const command = buildMoveObjectCommand(objectId, record.revision, dx, dy);
      const affected = await commit(command, null);
      if (affected !== null) {
        store.setStatus({
          key: 'map.status.moved',
          args: { label: record.label ?? objectId },
          tone: 'status',
        });
      } else if (!isCategoryLocked(record.category, store.state.lockedLayers)) {
        // `commit` already set a more specific `map.status.layerLocked`
        // status for a locked-layer rejection — only overwrite it with the
        // generic failure message when the rejection was for another reason
        // (a stale revision, a network failure).
        store.setStatus({ key: 'map.status.moveFailed', tone: 'alert' });
      }
      return affected;
    },
    [commit, findRecord, store],
  );

  const changeProperties = useCallback(
    async (
      objectId: string,
      label: string | undefined,
      categoryDetails: GardenObjectDetails | undefined,
    ) => {
      const record = findRecord(objectId);
      if (record === null) {
        return null;
      }
      const priorSnapshot = toObjectSnapshot(record);
      const command = buildChangePropertiesCommand(
        objectId,
        record.revision,
        label,
        categoryDetails,
      );
      const affected = await commit(command, priorSnapshot);
      if (affected !== null) {
        store.setStatus({ key: 'map.properties.saved', tone: 'status' });
      }
      return affected;
    },
    [commit, findRecord, store],
  );

  const deleteObject = useCallback(
    async (objectId: string) => {
      const record = findRecord(objectId);
      if (record === null) {
        return null;
      }
      const command = buildDeleteObjectCommand(objectId, record.revision);
      const affected = await commit(command, null);
      if (affected !== null) {
        if (store.state.selectedObjectId === objectId) {
          store.select(null);
        }
        store.setStatus({
          key: 'map.properties.deletedStatus',
          args: { label: record.label ?? objectId },
          tone: 'status',
        });
      }
      return affected;
    },
    [commit, findRecord, store],
  );

  const stepHistory = useCallback(
    async (direction: 'undo' | 'redo') => {
      const sourceStack = direction === 'undo' ? store.state.undoStack : store.state.redoStack;
      const top = sourceStack[sourceStack.length - 1];

      if (top === undefined) {
        store.setStatus({
          key: direction === 'undo' ? 'map.status.nothingToUndo' : 'map.status.nothingToRedo',
          tone: 'status',
        });
        return;
      }

      const inverse = deriveInverseCommand(
        top.command,
        top.priorSnapshot,
        top.revisionAfterCommand,
      );
      if (inverse === null) {
        store.setStatus({ key: 'map.status.undoUnavailable', tone: 'alert' });
        return;
      }

      const inverseObjectId = objectIdOf(inverse);
      // Only a command type in `commandNeedsPriorSnapshot` reads
      // `priorSnapshot` back — see `map-editor-commit.ts`. The live cache
      // still holds the pre-step state for every other wired command at
      // this point, since none of the others remove the object from the
      // list except delete, whose own inverse (`restoreObject`) never reads
      // `priorSnapshot`.
      const priorSnapshotForNewEntry = commandNeedsPriorSnapshot(inverse.type)
        ? (() => {
            const record = findRecord(inverseObjectId);
            return record === null ? null : toObjectSnapshot(record);
          })()
        : null;

      try {
        const affected = await submitMutation.mutateAsync(inverse);
        const revisionAfterCommand = affected[0]?.revision;
        if (revisionAfterCommand === undefined) {
          throw new Error('submitMapCommand returned no affected objects.');
        }

        const newEntry: HistoryEntry = {
          command: inverse,
          priorSnapshot: priorSnapshotForNewEntry,
          revisionAfterCommand,
          objectId: inverseObjectId,
        };

        if (direction === 'undo') {
          store.applyUndoStep(newEntry);
        } else {
          store.applyRedoStep(newEntry);
        }

        store.select(inverse.type === 'deleteObject' ? null : inverseObjectId);
        store.setStatus({
          key: direction === 'undo' ? 'map.status.undoApplied' : 'map.status.redoApplied',
          tone: 'status',
        });
      } catch {
        store.setStatus({ key: 'map.status.commandFailed', tone: 'alert' });
      }
    },
    [findRecord, store, submitMutation],
  );

  const undo = useCallback(() => stepHistory('undo'), [stepHistory]);
  const redo = useCallback(() => stepHistory('redo'), [stepHistory]);

  /** A point-category tool (tree, plant, annotation) commits immediately on click — no draft state involved. */
  const placePoint = useCallback(
    async (category: CreatableCategory, position: Position) => {
      await createObject(category, { type: 'Point', coordinates: position });
    },
    [createObject],
  );

  /**
   * Commits the in-progress polygon/line draft in `store.state.draftPoints`
   * as a `createObject` command, after the same client-side geometry
   * validation the server itself runs (`validateGeometry`) — immediate
   * feedback per architecture doc section "11. Validation" ("Local
   * validation provides immediate feedback").
   *
   * `gate` is the one creatable category that never reaches `createObject`
   * from here: its draft becomes `store.state.pendingGateGeometry` instead,
   * awaiting the user's fence pick via `completeGateCreation`.
   */
  const finishDraft = useCallback(async () => {
    const category = creatableCategoryOfTool(store.state.tool);
    const points = store.state.draftPoints;
    if (category === null) {
      return;
    }

    const kind = CREATABLE_GEOMETRY_KIND[category];
    let geometry: Geometry;

    if (kind === 'polygon') {
      const first = points[0];
      if (points.length < 3 || first === undefined) {
        store.setStatus({ key: 'map.canvas.draftTooSmall', tone: 'alert' });
        return;
      }
      geometry = { type: 'Polygon', coordinates: [[...points, first]] };
    } else if (kind === 'line') {
      if (points.length < 2) {
        store.setStatus({ key: 'map.canvas.draftTooSmall', tone: 'alert' });
        return;
      }
      geometry = { type: 'LineString', coordinates: [...points] };
    } else {
      // Point categories place immediately via `placePoint` and never draft.
      return;
    }

    if (validateGeometry(geometry).some((issue) => issue.severity === 'error')) {
      store.setStatus({ key: 'map.canvas.draftTooSmall', tone: 'alert' });
      return;
    }

    if (category === 'gate') {
      if (!records.some((record) => record.category === 'fence')) {
        store.setStatus({ key: 'map.gate.noFenceAvailable', tone: 'alert' });
        store.setTool('select');
        return;
      }
      store.setPendingGateGeometry(geometry);
      store.setTool('select');
      return;
    }

    await createObject(category, geometry);
  }, [createObject, records, store]);

  const cancelDraft = useCallback(() => {
    store.setTool('select');
  }, [store]);

  const geometryActions = useMapEditorGeometryActions({ commit, findRecord, store });
  const objectActions = useMapEditorObjectActions({ commit, findRecord, store });
  const lineworkActions = useMapEditorLineworkActions({ commit, findRecord, store });

  return {
    records,
    selectedRecord,
    findRecord,
    createObject,
    completeGateCreation,
    cancelGateCreation,
    moveObject,
    changeProperties,
    deleteObject,
    placePoint,
    finishDraft,
    cancelDraft,
    undo,
    redo,
    canUndo: store.state.undoStack.length > 0,
    canRedo: store.state.redoStack.length > 0,
    isSubmitting: submitMutation.isPending,
    // Reuses `submitMutation`'s own status rather than tracking a parallel
    // piece of state — see `save-status.ts`'s doc comment for why this is
    // enough to drive `map-save-status.tsx`'s persistent indicator.
    saveStatus: deriveSaveStatus(submitMutation.status),
    ...geometryActions,
    ...objectActions,
    ...lineworkActions,
  };
}

/** Prop type for the components `map-editor.tsx` hands this hook's result to. */
export type MapEditorActions = ReturnType<typeof useMapEditorActions>;
