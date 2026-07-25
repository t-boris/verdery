'use client';

import { useCallback } from 'react';

import {
  buildChangePropertiesCommand,
  buildCreateImportedBackgroundCommand,
  generateMapId,
} from './commands';
import type { MapEditorActionDeps } from './map-editor-commit';
import { toObjectSnapshot } from './object-mapper';

/**
 * The imported-background command slice (P6-PLAN-01), a sibling of
 * `use-map-editor-object-actions.ts` built the same way: shared `commit`,
 * one mutation, one undo stack.
 *
 * - `createImportedBackground` places an uploaded, processed
 *   `imported_plan` document on the map at its placeholder placement
 *   (`commands.ts#placeholderBackgroundGeometry`), uncalibrated
 *   (P6-PLAN-02 owns calibration).
 * - `setBackgroundVisibility` flips the per-background persisted
 *   `isBackgroundVisible` flag — the Phase 6 exit criterion's
 *   "independently hideable" — as an ordinary revision-guarded
 *   `changeProperties` command, undoable like any other property change.
 * - Removal needs no slice of its own: the panel reuses the generic
 *   `deleteObject` action.
 */
export function useImportedBackgroundActions({ commit, findRecord, store }: MapEditorActionDeps) {
  const createImportedBackground = useCallback(
    async (planMediaId: string, label: string, sourcePageNumber?: number) => {
      const objectId = generateMapId();
      const command = buildCreateImportedBackgroundCommand(
        objectId,
        planMediaId,
        label,
        sourcePageNumber,
      );
      const affected = await commit(command, null);
      if (affected !== null) {
        store.select(objectId);
        store.setStatus({
          key: 'map.background.created',
          args: { label },
          tone: 'status',
        });
      }
      return affected;
    },
    [commit, store],
  );

  const setBackgroundVisibility = useCallback(
    async (objectId: string, isBackgroundVisible: boolean) => {
      const record = findRecord(objectId);
      if (record === null || record.categoryDetails?.category !== 'importedBackground') {
        return null;
      }
      const priorSnapshot = toObjectSnapshot(record);
      const command = buildChangePropertiesCommand(objectId, record.revision, undefined, {
        category: 'importedBackground',
        details: { ...record.categoryDetails.details, isBackgroundVisible },
      });
      const affected = await commit(command, priorSnapshot);
      if (affected !== null) {
        store.setStatus({
          key: isBackgroundVisible ? 'map.background.shown' : 'map.background.hidden',
          tone: 'status',
        });
      }
      return affected;
    },
    [commit, findRecord, store],
  );

  return { createImportedBackground, setBackgroundVisibility };
}
