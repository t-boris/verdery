'use client';

import type {
  MapCommandPayload,
  MapCommandType,
  ObjectSnapshot,
} from '@verdery/geometry-contracts';
import { useCallback } from 'react';

import type { HistoryEntry, MapEditorStore } from './editor-store';
import type { MapObjectRecord } from './types';

/**
 * Every command type this feature ever constructs carries a way to name the
 * one object whose revision the resulting `HistoryEntry` must track. Kept as
 * an explicit switch, not a duck-typed `'objectId' in command` check, so
 * adding a command type without extending this switch is a compile error.
 *
 * Most command types carry their target directly as `objectId`.
 * `duplicateObject` has no single `objectId` (it has `sourceObjectId` and
 * `newObjectId`) — `deriveInverseCommand`'s inverse for it deletes
 * `newObjectId`, so that is the id this history entry must track.
 * `assignPlant` carries its target as `plantObjectId`. `joinLinework` has no
 * single `objectId` either (it has `firstObjectId`/`secondObjectId`) —
 * `resultObjectId` is the one object that survives the command, so that is
 * what a `HistoryEntry` for it tracks (its inverse is `null` regardless —
 * see `deriveInverseCommand`'s module doc comment — but the entry still
 * needs a target id to satisfy `HistoryEntry`'s shape).
 */
export function objectIdOf(command: MapCommandPayload): string {
  switch (command.type) {
    case 'createObject':
    case 'moveObject':
    case 'replaceGeometry':
    case 'editVertex':
    case 'changeProperties':
    case 'deleteObject':
    case 'restoreObject':
    case 'splitLinework':
      return command.objectId;
    case 'duplicateObject':
      return command.newObjectId;
    case 'assignPlant':
      return command.plantObjectId;
    case 'joinLinework':
      return command.resultObjectId;
    default:
      throw new Error(`Map editor history does not support command type "${command.type}".`);
  }
}

/**
 * Command types whose `deriveInverseCommand` branch reads `priorSnapshot`
 * back — see `@verdery/geometry-contracts`'s `inverse-command.ts`. Every
 * other command type's `HistoryEntry.priorSnapshot` stays `null`, since
 * nothing would ever read it.
 */
const PRIOR_SNAPSHOT_COMMAND_TYPES: ReadonlySet<MapCommandType> = new Set([
  'changeProperties',
  'replaceGeometry',
  'editVertex',
  'assignPlant',
]);

/** True when a command's own future undo will need the snapshot captured just before it ran. */
export function commandNeedsPriorSnapshot(type: MapCommandType): boolean {
  return PRIOR_SNAPSHOT_COMMAND_TYPES.has(type);
}

export type CommitFn = (
  command: MapCommandPayload,
  priorSnapshot: ObjectSnapshot | null,
) => Promise<readonly MapObjectRecord[] | null>;

interface SubmitMutationLike {
  mutateAsync: (command: MapCommandPayload) => Promise<readonly MapObjectRecord[]>;
}

/**
 * Builds the one `commit` function every map editor action hook shares:
 * submits a forward (user-initiated) command and pushes its undo entry.
 *
 * A single instance lives in `use-map-editor-actions.ts` and is passed as a
 * parameter into the sibling action hooks (`use-map-editor-geometry-actions.ts`
 * and the like) rather than each hook building its own — they all need the
 * same underlying `submitMapCommand` mutation and undo stack, not five
 * independent copies of either.
 */
export function useCommandCommit(
  store: MapEditorStore,
  submitMutation: SubmitMutationLike,
): CommitFn {
  return useCallback(
    async (command, priorSnapshot) => {
      try {
        const affected = await submitMutation.mutateAsync(command);
        const revisionAfterCommand = affected[0]?.revision;
        if (revisionAfterCommand === undefined) {
          throw new Error('submitMapCommand returned no affected objects.');
        }

        const entry: HistoryEntry = {
          command,
          priorSnapshot: commandNeedsPriorSnapshot(command.type) ? priorSnapshot : null,
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
}

/**
 * The three collaborators every sibling action hook
 * (`use-map-editor-geometry-actions.ts`, `use-map-editor-object-actions.ts`,
 * `use-map-editor-linework-actions.ts`) needs, all built once in
 * `use-map-editor-actions.ts` and passed down — see `useCommandCommit`'s
 * doc comment for why this is composition by parameter, not each hook
 * calling `useSubmitMapCommand` independently.
 */
export interface MapEditorActionDeps {
  readonly commit: CommitFn;
  readonly findRecord: (objectId: string) => MapObjectRecord | null;
  readonly store: MapEditorStore;
}
