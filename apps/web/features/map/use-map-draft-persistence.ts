'use client';

import type { Geometry, Position } from '@verdery/geometry-contracts';
import { useEffect } from 'react';

import { useRecoverableDraft } from '@/core/drafts/public';

import type { MapEditorStore } from './editor-store';
import type { ToolMode } from './types';

export interface MapDraftPayload {
  readonly draftPoints: readonly Position[];
  readonly pendingGateGeometry: Geometry | null;
  readonly tool: ToolMode;
}

/**
 * Local-draft schema version for the map editor's in-progress command
 * state. Increment whenever `MapDraftPayload`'s shape changes in a way an
 * old stored draft could not be blindly reapplied under — see
 * `core/drafts/local-draft-store.ts`'s doc comment for the full convention.
 */
const MAP_DRAFT_SCHEMA_VERSION = 1;

export interface MapDraftPersistence {
  readonly recovered: boolean;
  readonly discardRecoveredDraft: () => void;
}

/**
 * Persists the map editor's not-yet-submitted shape while it is being
 * drawn, so an accidental reload does not lose it. Deliberately narrow:
 * only `store.state.draftPoints` (an in-progress `create:*` polygon/line),
 * `store.state.pendingGateGeometry` (a completed gate draft awaiting a fence
 * pick), and the `tool` they belong to are persisted — every *committed*
 * command already reaches the server directly through `useCommandCommit`
 * (`map-editor-commit.ts`) the moment a stable interaction boundary is
 * crossed, per architecture doc section "10. Map Editor Integration"
 * ("Commands are committed at stable interaction boundaries"), so there is
 * no separately-persisted "session" beyond this one in-progress draft.
 * Selection, camera, and layer visibility are ordinary, trivially
 * re-derivable view state, not user-authored work at risk of being lost, so
 * none of them are persisted here.
 *
 * Source: architecture/web-application-design.md, section "9. Online-First
 * Behavior" ("Unsaved editor work remains in a local draft").
 */
export function useMapDraftPersistence(
  gardenId: string,
  store: MapEditorStore,
): MapDraftPersistence {
  const { draftPoints, pendingGateGeometry, tool } = store.state;

  const draft = useRecoverableDraft<MapDraftPayload>({
    draftType: 'map.editSession',
    scopeKey: gardenId,
    schemaVersion: MAP_DRAFT_SCHEMA_VERSION,
    payload: { draftPoints, pendingGateGeometry, tool },
    hasUnsavedInput: draftPoints.length > 0 || pendingGateGeometry !== null,
  });

  useEffect(() => {
    if (draft.recoveredPayload === null) {
      return;
    }
    const recovered = draft.recoveredPayload;
    // `setTool` always resets `draftPoints`/`pendingGateGeometry` as part of
    // its own "abandon whatever was in progress" behavior (`editor-store.tsx`),
    // which is exactly why it must run first here — the two calls after it
    // then apply the real recovered values on top of that reset baseline.
    store.setTool(recovered.tool);
    store.setDraftPoints(recovered.draftPoints);
    store.setPendingGateGeometry(recovered.pendingGateGeometry);
    draft.acknowledgeRecovered();
    // Runs once, when `draft.recoveredPayload` transitions from `null` to a
    // real value right after mount — `store`/`acknowledgeRecovered` are
    // intentionally not listed; see `add-plant-form.tsx`'s identical effect
    // for the full reasoning.
  }, [draft.recoveredPayload]);

  return {
    recovered: draft.recovered,
    discardRecoveredDraft: () => {
      draft.dismissRecovered();
      store.setTool('select');
    },
  };
}
