'use client';

import type {
  MapCommandPayload,
  MapCommandType,
  ObjectSnapshot,
} from '@verdery/geometry-contracts';
import { useCallback } from 'react';

import { useIsOnline } from '@/core/connectivity/public';

import type { HistoryEntry, MapEditorStore } from './editor-store';
import { isCategoryLocked } from './map-layers';
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
 *
 * This is also the single choke point for the layer-lock check
 * (`map-layers.ts`): every command that targets an *existing* object —
 * `moveObject`, `replaceGeometry`, `editVertex`, `changeProperties`,
 * `deleteObject`, `assignPlant`, `splitLinework` — is rejected here before it
 * ever reaches the server when `objectIdOf(command)` names an object on a
 * locked layer, per architecture doc section "12. Layer Model". `createObject`
 * is exempt (a user deliberately drawing a new object is not "interacting with
 * an existing object in that layer"), as are `duplicateObject` and
 * `joinLinework`, whose `objectIdOf` names a *new* object identity that does
 * not exist yet — `findRecord` correctly finds nothing for either, so this
 * check is a no-op for them rather than something to special-case. Undo/redo
 * (`use-map-editor-actions.ts`'s `stepHistory`) submits through
 * `submitMutation` directly, bypassing this gate deliberately: a lock applied
 * after an edit should not strand the user unable to undo that same edit.
 *
 * It is also the single choke point for the offline gate (P5-WEB-01): every
 * command this function guards is rejected, never sent, while the browser
 * is offline — the in-progress shape a command like `createObject` would
 * have submitted stays in `store.state.draftPoints`/`pendingGateGeometry`
 * instead, recoverable via `use-map-draft-persistence.ts`, rather than
 * either hanging (TanStack Query's default `networkMode: 'online'` would
 * otherwise silently pause the mutation and fire it the moment connectivity
 * returns — an implicit queue-and-resubmit this work package's own scope
 * explicitly excludes) or failing with a confusing transport error.
 * `stepHistory`'s own direct `submitMutation` call carries the identical
 * check for the same reason, since it bypasses this function entirely.
 */
export function useCommandCommit(
  store: MapEditorStore,
  submitMutation: SubmitMutationLike,
  findRecord: (objectId: string) => MapObjectRecord | null,
): CommitFn {
  const isOnline = useIsOnline();

  return useCallback(
    async (command, priorSnapshot) => {
      if (!isOnline) {
        store.setStatus({ key: 'map.status.offline', tone: 'alert' });
        return null;
      }

      if (command.type !== 'createObject') {
        const target = findRecord(objectIdOf(command));
        if (target !== null && isCategoryLocked(target.category, store.state.lockedLayers)) {
          store.setStatus({ key: 'map.status.layerLocked', tone: 'alert' });
          return null;
        }
      }

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
    [store, submitMutation, findRecord, isOnline],
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
