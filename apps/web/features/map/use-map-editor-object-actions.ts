'use client';

import { useCallback } from 'react';

import { buildAssignPlantCommand, buildDuplicateObjectCommand, generateMapId } from './commands';
import type { MapEditorActionDeps } from './map-editor-commit';
import { toObjectSnapshot } from './object-mapper';

/** Fixed offset applied to a duplicated object so it is visibly distinct from its source. */
const DUPLICATE_OFFSET_METRES = { dx: 1, dy: 1 };

/**
 * `duplicateObject` and `assignPlant` — two commands that each target one
 * object but do not fit `use-map-editor-actions.ts`'s existing shapes:
 * `duplicateObject` creates a *new* object identity from an existing one,
 * and `assignPlant` changes a field that also appears in
 * `PlantPlacementDetails` but is deliberately never routed through
 * `changeProperties` — see `command.ts`'s `AssignPlantPayload`.
 */
export function useMapEditorObjectActions({ commit, findRecord, store }: MapEditorActionDeps) {
  /**
   * `priorSnapshot` is `null` here — matching `moveObject`/`deleteObject`'s
   * existing pattern — because `deriveInverseCommand`'s `duplicateObject`
   * branch never reads it, only `command.newObjectId`.
   */
  const duplicateObject = useCallback(
    async (sourceObjectId: string) => {
      const record = findRecord(sourceObjectId);
      if (record === null) {
        return null;
      }
      const newObjectId = generateMapId();
      const command = buildDuplicateObjectCommand(
        sourceObjectId,
        newObjectId,
        DUPLICATE_OFFSET_METRES.dx,
        DUPLICATE_OFFSET_METRES.dy,
      );
      const affected = await commit(command, null);
      if (affected !== null) {
        store.select(newObjectId);
        store.setStatus({
          key: 'map.status.duplicated',
          args: { label: record.label ?? sourceObjectId },
          tone: 'status',
        });
      }
      return affected;
    },
    [commit, findRecord, store],
  );

  const assignPlant = useCallback(
    async (plantObjectId: string, targetObjectId: string | null) => {
      const record = findRecord(plantObjectId);
      if (record === null) {
        return null;
      }
      const priorSnapshot = toObjectSnapshot(record);
      const command = buildAssignPlantCommand(plantObjectId, record.revision, targetObjectId);
      const affected = await commit(command, priorSnapshot);
      if (affected !== null) {
        store.setStatus({ key: 'map.status.assigned', tone: 'status' });
      }
      return affected;
    },
    [commit, findRecord, store],
  );

  return { duplicateObject, assignPlant };
}
