'use client';

import { useCallback } from 'react';

import { buildJoinLineworkCommand, buildSplitLineworkCommand, generateMapId } from './commands';
import type { MapEditorActionDeps } from './map-editor-commit';

/**
 * `splitLinework` and `joinLinework`, wired for `fence` and `path` only —
 * the two categories whose primary geometry is a line a user might
 * plausibly want to cut in two or stitch back together.
 *
 * Both commands return `null` from `deriveInverseCommand` by design ("Split
 * and join recreate object identity in ways a single inverse command cannot
 * express" — see its module doc comment), so both are committed with
 * `priorSnapshot: null`: the `HistoryEntry` this pushes still lets
 * `stepHistory` show "undo unavailable" correctly, it just never needs a
 * snapshot to do so.
 */
export function useMapEditorLineworkActions({ commit, findRecord, store }: MapEditorActionDeps) {
  const splitLinework = useCallback(
    async (objectId: string, atVertexIndex: number) => {
      const record = findRecord(objectId);
      if (record === null) {
        return null;
      }
      const firstObjectId = generateMapId();
      const secondObjectId = generateMapId();
      const command = buildSplitLineworkCommand(
        objectId,
        record.revision,
        [firstObjectId, secondObjectId],
        atVertexIndex,
      );
      const affected = await commit(command, null);
      if (affected !== null) {
        // The original object no longer exists after a split (server-side);
        // selecting the first resulting piece keeps the user oriented at
        // the split point rather than dropping selection entirely.
        store.select(firstObjectId);
        store.setStatus({ key: 'map.status.split', tone: 'status' });
      }
      return affected;
    },
    [commit, findRecord, store],
  );

  const joinLinework = useCallback(
    async (firstObjectId: string, secondObjectId: string) => {
      const first = findRecord(firstObjectId);
      const second = findRecord(secondObjectId);
      if (first === null || second === null) {
        return null;
      }
      const joinableCategory = first.category === 'fence' || first.category === 'path';
      if (!joinableCategory || first.category !== second.category) {
        store.setStatus({ key: 'map.status.joinMismatch', tone: 'alert' });
        return null;
      }

      const resultObjectId = generateMapId();
      const command = buildJoinLineworkCommand(
        firstObjectId,
        first.revision,
        secondObjectId,
        second.revision,
        resultObjectId,
      );
      const affected = await commit(command, null);
      if (affected !== null) {
        store.clearMultiSelect();
        store.select(resultObjectId);
        store.setStatus({ key: 'map.status.joined', tone: 'status' });
      }
      return affected;
    },
    [commit, findRecord, store],
  );

  return { splitLinework, joinLinework };
}
