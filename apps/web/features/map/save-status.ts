import type { MutationStatus } from '@tanstack/react-query';

import type { MessageKey } from '@/shared/localization/public';

/**
 * A persistent presentation of the map editor's save state, distinct from
 * `editor-store.tsx`'s `StatusMessage` — that toast is shown once per command
 * and then gone; this reflects whether the *last* command actually reached
 * the server, and keeps reflecting it until the next one settles.
 *
 * This app is online-first with no offline command queue (`use-map-editor-actions.ts`'s
 * `commit`/`useSubmitMapCommand` commits directly to the server on every
 * submit) — there is no local-only "unsynced" state to track beyond whether
 * the one in-flight or most-recently-settled mutation succeeded. Building a
 * true offline/local-database sync-status system is Phase 5 scope ("Native
 * Offline Synchronization and Web Continuity"); this type only ever describes
 * the single server round trip that already exists.
 *
 * Deliberately derived from `useSubmitMapCommand`'s own TanStack Query
 * `MutationStatus` rather than tracked as separate state: that mutation's
 * status already transitions idle → pending → success/error on every submit
 * (including undo/redo, which shares the same mutation instance — see
 * `map-editor-commit.ts`'s doc comment) and — unlike a one-shot toast — stays
 * at `success`/`error` until the *next* submit changes it again, which is
 * exactly the "persist until the next successful command" behavior this
 * indicator needs.
 */
export type SaveStatus = 'idle' | 'saving' | 'saved' | 'failed';

export function deriveSaveStatus(mutationStatus: MutationStatus): SaveStatus {
  switch (mutationStatus) {
    case 'idle':
      return 'idle';
    case 'pending':
      return 'saving';
    case 'success':
      return 'saved';
    case 'error':
      return 'failed';
  }
}

/** Message key for every non-`idle` status — `map-save-status.tsx` renders nothing for `idle`. */
export const SAVE_STATUS_LABEL_KEY: Readonly<Record<Exclude<SaveStatus, 'idle'>, MessageKey>> = {
  saving: 'map.saveStatus.saving',
  saved: 'map.saveStatus.saved',
  failed: 'map.saveStatus.failed',
};
