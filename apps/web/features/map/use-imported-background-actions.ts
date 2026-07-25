'use client';

import type { PlanCalibrationInput } from '@verdery/geometry-contracts';
import { useCallback } from 'react';

import {
  buildChangePropertiesCommand,
  buildCreateImportedBackgroundCommand,
  buildUpsertCalibrationCommand,
  generateMapId,
  writableImportedBackgroundDetails,
} from './commands';
import type { MapEditorActionDeps } from './map-editor-commit';
import { toObjectSnapshot } from './object-mapper';
import type { MapObjectRecord } from './types';

/**
 * The imported-background command slice (P6-PLAN-01/-02), a sibling of
 * `use-map-editor-object-actions.ts` built the same way: shared `commit`,
 * one mutation, one undo stack.
 *
 * - `createImportedBackground` places an uploaded, processed
 *   `imported_plan` document on the map at its placeholder placement
 *   (`commands.ts#placeholderBackgroundGeometry`), uncalibrated.
 * - `setBackgroundVisibility` flips the per-background persisted
 *   `isBackgroundVisible` flag — the Phase 6 exit criterion's
 *   "independently hideable" — as an ordinary revision-guarded
 *   `changeProperties` command, undoable like any other property change.
 *   The server-owned `calibration` block is stripped from the echoed
 *   details (`writableImportedBackgroundDetails`).
 * - `applyCalibration` (P6-PLAN-02) submits the calibration session's full
 *   input set as `upsertCalibration`; the server derives the transform,
 *   residuals, and footprint. Not undoable by design — recalibration is
 *   the correction path.
 * - `adjustCalibratedBackground` is the "drag a calibrated background"
 *   path: a calibrated background's placement IS its transform (the
 *   server rejects `moveObject` for it), so a drag recalibrates from the
 *   stored inputs with the drag delta composed into the manual
 *   adjustment — "manual origin adjustment" recorded as re-derivable
 *   input, exactly section 16's model.
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
        details: {
          ...writableImportedBackgroundDetails(record.categoryDetails.details),
          isBackgroundVisible,
        },
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

  const applyCalibration = useCallback(
    async (objectId: string, input: PlanCalibrationInput) => {
      const record = findRecord(objectId);
      if (record === null || record.categoryDetails?.category !== 'importedBackground') {
        return null;
      }
      const command = buildUpsertCalibrationCommand(objectId, record.revision, input);
      const affected = await commit(command, null);
      if (affected !== null) {
        store.setCalibrationDraft(null);
        store.setStatus({ key: 'map.calibration.applied', tone: 'status' });
      }
      return affected;
    },
    [commit, findRecord, store],
  );

  const adjustCalibratedBackground = useCallback(
    async (record: MapObjectRecord, dx: number, dy: number) => {
      const details =
        record.categoryDetails?.category === 'importedBackground'
          ? record.categoryDetails.details
          : null;
      const calibration = details?.calibration;
      if (calibration === undefined || calibration === null) {
        return null;
      }
      const manual = calibration.manualAdjustment ?? {
        rotationRadians: 0,
        translationMetres: { dx: 0, dy: 0 },
      };
      const command = buildUpsertCalibrationCommand(record.id, record.revision, {
        pageAspectRatio: calibration.pageAspectRatio,
        knownDistance: calibration.knownDistance,
        referencePoints: calibration.referencePoints.map(({ planPoint, localMetres }) => ({
          planPoint,
          localMetres,
        })),
        manualAdjustment: {
          rotationRadians: manual.rotationRadians,
          translationMetres: {
            dx: manual.translationMetres.dx + dx,
            dy: manual.translationMetres.dy + dy,
          },
        },
      });
      const affected = await commit(command, null);
      if (affected !== null) {
        store.setStatus({ key: 'map.calibration.adjusted', tone: 'status' });
      }
      return affected;
    },
    [commit, store],
  );

  return {
    createImportedBackground,
    setBackgroundVisibility,
    applyCalibration,
    adjustCalibratedBackground,
  };
}
