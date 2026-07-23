'use client';

import type { Geometry, VertexOperation } from '@verdery/geometry-contracts';
import { useCallback } from 'react';

import { buildEditVertexCommand, buildReplaceGeometryCommand } from './commands';
import type { MapEditorActionDeps } from './map-editor-commit';
import { toObjectSnapshot } from './object-mapper';

/**
 * `replaceGeometry` (whole-shape resize/rotate/freehand-reshape) and
 * `editVertex` (per-vertex insert/move/remove) — see `shapes/transform-handles.tsx`
 * and `shapes/vertex-handles.tsx` for the gesture layer that calls these.
 *
 * Both commands need `priorSnapshot` for their own future undo
 * (`deriveInverseCommand` reads `priorSnapshot.geometry`/its ring for
 * either), so both capture it via `toObjectSnapshot` before committing, the
 * same pattern `changeProperties` already uses in `use-map-editor-actions.ts`.
 */
export function useMapEditorGeometryActions({ commit, findRecord, store }: MapEditorActionDeps) {
  const replaceGeometry = useCallback(
    async (objectId: string, geometry: Geometry) => {
      const record = findRecord(objectId);
      if (record === null) {
        return null;
      }
      const priorSnapshot = toObjectSnapshot(record);
      const command = buildReplaceGeometryCommand(objectId, record.revision, geometry);
      const affected = await commit(command, priorSnapshot);
      if (affected !== null) {
        store.setStatus({ key: 'map.status.geometryUpdated', tone: 'status' });
      }
      return affected;
    },
    [commit, findRecord, store],
  );

  const editVertex = useCallback(
    async (
      objectId: string,
      operation: VertexOperation,
      ringIndex: number,
      vertexIndex: number,
      position?: readonly [number, number],
    ) => {
      const record = findRecord(objectId);
      if (record === null) {
        return null;
      }
      const priorSnapshot = toObjectSnapshot(record);
      const command = buildEditVertexCommand(
        objectId,
        record.revision,
        operation,
        ringIndex,
        vertexIndex,
        position,
      );
      const affected = await commit(command, priorSnapshot);
      if (affected !== null) {
        store.setStatus({ key: 'map.status.geometryUpdated', tone: 'status' });
      }
      return affected;
    },
    [commit, findRecord, store],
  );

  return { replaceGeometry, editVertex };
}
