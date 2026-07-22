'use client';

import type {
  GardenObjectDetails,
  Geometry,
  MapCommandPayload,
  ObjectSnapshot,
  Position,
} from '@verdery/geometry-contracts';
import { deriveInverseCommand, validateGeometry } from '@verdery/geometry-contracts';
import { useCallback } from 'react';

import {
  buildChangePropertiesCommand,
  buildCreateObjectCommand,
  buildDeleteObjectCommand,
  buildMoveObjectCommand,
  generateMapId,
} from './commands';
import type { HistoryEntry } from './editor-store';
import { useMapEditorStore } from './editor-store';
import { toObjectSnapshot } from './object-mapper';
import { useGardenMap, useSubmitMapCommand } from './queries';
import { CREATABLE_GEOMETRY_KIND, creatableCategoryOfTool } from './types';
import type { CreatableCategory, MapObjectRecord } from './types';

/**
 * Every command type this feature ever constructs carries its target as
 * `objectId` — true for all five wired commands (`createObject`,
 * `moveObject`, `changeProperties`, `deleteObject`, and `restoreObject`,
 * which only `deriveInverseCommand` ever produces). Kept as an explicit
 * switch, not a duck-typed `'objectId' in command` check, so adding a sixth
 * wired command type without extending this switch is a compile error.
 */
function objectIdOf(command: MapCommandPayload): string {
  switch (command.type) {
    case 'createObject':
    case 'moveObject':
    case 'changeProperties':
    case 'deleteObject':
    case 'restoreObject':
      return command.objectId;
    default:
      throw new Error(`Map editor history does not support command type "${command.type}".`);
  }
}

/**
 * Orchestrates the map editor: combines the query cache (server state), the
 * editor store (selection/tool/undo/redo), and command construction into the
 * five actions the toolbar, canvas, property panel, and object list call.
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

  /** Submits a forward (user-initiated) command and pushes its undo entry. */
  const commit = useCallback(
    async (
      command: MapCommandPayload,
      priorSnapshot: ObjectSnapshot | null,
    ): Promise<readonly MapObjectRecord[] | null> => {
      try {
        const affected = await submitMutation.mutateAsync(command);
        const revisionAfterCommand = affected[0]?.revision;
        if (revisionAfterCommand === undefined) {
          throw new Error('submitMapCommand returned no affected objects.');
        }

        const entry: HistoryEntry = {
          command,
          priorSnapshot: command.type === 'changeProperties' ? priorSnapshot : null,
          revisionAfterCommand,
          objectId: objectIdOf(command),
        };
        store.pushForward(entry);
        return affected;
      } catch {
        store.setStatus({ key: 'map.status.commandFailed', tone: 'alert' });
        return null;
      }
    },
    [store, submitMutation],
  );

  const createObject = useCallback(
    async (category: CreatableCategory, geometry: Geometry) => {
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
      } else {
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
      // Only `changeProperties`'s inverse reads `priorSnapshot` back — see
      // `deriveInverseCommand`'s switch. The live cache still holds the
      // pre-step state for every other wired command at this point, since
      // none of the others remove the object from the list except delete,
      // whose own inverse (`restoreObject`) never reads `priorSnapshot`.
      const priorSnapshotForNewEntry =
        inverse.type === 'changeProperties'
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

  /** A point-category tool (tree, plant) commits immediately on click — no draft state involved. */
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

    await createObject(category, geometry);
  }, [createObject, store]);

  const cancelDraft = useCallback(() => {
    store.setTool('select');
  }, [store]);

  return {
    records,
    selectedRecord,
    findRecord,
    createObject,
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
  };
}

/** Prop type for the components `map-editor.tsx` hands this hook's result to. */
export type MapEditorActions = ReturnType<typeof useMapEditorActions>;
