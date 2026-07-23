'use client';

import { useEffect, useRef, useState } from 'react';

import { clearLocalDraft, loadLocalDraft, saveLocalDraft } from './local-draft-store';

export interface UseRecoverableDraftOptions<TPayload> {
  /** Feature-defined, e.g. `'plants.addPlant'` or `'map.editSession'`. */
  readonly draftType: string;
  /** What the draft is scoped to — typically a garden id. */
  readonly scopeKey: string;
  /** See `local-draft-store.ts`'s doc comment for the versioning convention. */
  readonly schemaVersion: number;
  /** The caller's current in-progress value — persisted, debounced, whenever `hasUnsavedInput` is true. */
  readonly payload: TPayload;
  /** Whether `payload` currently represents real, worth-persisting user input. */
  readonly hasUnsavedInput: boolean;
  /** Debounce between a `payload` change and the write to storage. */
  readonly debounceMs?: number;
}

export interface RecoverableDraft<TPayload> {
  /**
   * A stored draft found on mount, not yet applied by the caller — `null`
   * once there was nothing to recover, or after `acknowledgeRecovered` is
   * called. The caller reads this once, applies it however its own state is
   * shaped (a form's `reset`, additional local `useState`s, …), and then
   * calls `acknowledgeRecovered`.
   */
  readonly recoveredPayload: TPayload | null;
  /** True once a recovered draft has been applied — drives a "recovered from local draft" notice. */
  readonly recovered: boolean;
  /** Call right after applying `recoveredPayload`, to flip `recovered` on and consume the one-shot payload. */
  readonly acknowledgeRecovered: () => void;
  /** Discards the persisted draft and hides the notice. Does not change the caller's current in-memory state. */
  readonly dismissRecovered: () => void;
  /** Clears the persisted draft — call after a successful submit. */
  readonly clearDraft: () => void;
}

const DEFAULT_DEBOUNCE_MS = 400;

/**
 * Wires one form or editing session to `local-draft-store.ts`: restores a
 * matching-schema draft once on mount, and persists further changes,
 * debounced, while there is real unsaved input.
 *
 * Deliberately not React Hook Form-specific — `payload`/`hasUnsavedInput`
 * are plain values, so the same hook backs both an RHF-driven form (`payload`
 * built from `watch()` plus any extra local state RHF does not own, e.g.
 * `features/plants/add-plant-form.tsx`'s `taxonomyReferenceId`) and the map
 * editor's reducer-owned in-progress command state, which has no form at
 * all.
 *
 * A found draft is restored automatically rather than asked about first
 * (`recoveredPayload` is applied by the caller as soon as it sees it, not
 * gated behind a user confirmation), with `recovered` driving a visible
 * "recovered from local draft" notice and an explicit discard action. This
 * was the deliberate choice over an "offer to restore" prompt: architecture
 * doc section "11. Forms and Validation" already establishes the general
 * preference ("Preserve user input after recoverable failures", "Avoid
 * clearing a form after an unknown mutation outcome") — the friendlier
 * default is getting the user's own typing back without an extra click, and
 * the explicit "discard" affordance plus the visible notice cover the "I
 * don't want this" case just as well as an upfront prompt would, without
 * making every ordinary fresh-form visit stop to ask "restore nothing?".
 * The notice itself is also what keeps this consistent with section 9's
 * "The interface never displays a server-confirmed state before
 * confirmation": a recovered draft is always shown as exactly that — local,
 * unconfirmed input — never as if it were already saved.
 *
 * `hasUnsavedInput` turning false — a submitted or abandoned form, or the
 * map editor finishing/cancelling its in-progress shape — clears the stored
 * draft immediately rather than merely stopping further saves, so a later
 * mount never "recovers" a draft that its own session already resolved. This
 * is gated behind the initial recovery check (`isReady` below) completing
 * first: on the very first render `hasUnsavedInput` is naturally still
 * false (the caller has not yet applied `recoveredPayload` to its own
 * state), and clearing storage at that exact instant would be wrong — the
 * one already-loaded-into-memory `recoveredPayload` this hook already
 * captured is unaffected either way, but the *disk* copy must survive long
 * enough to be worth having looked for at all.
 *
 * Source: architecture/web-application-design.md, section "9. Online-First
 * Behavior" ("Unsaved editor work remains in a local draft").
 */
export function useRecoverableDraft<TPayload>({
  draftType,
  scopeKey,
  schemaVersion,
  payload,
  hasUnsavedInput,
  debounceMs = DEFAULT_DEBOUNCE_MS,
}: UseRecoverableDraftOptions<TPayload>): RecoverableDraft<TPayload> {
  const [recoveredPayload, setRecoveredPayload] = useState<TPayload | null>(null);
  const [recovered, setRecovered] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const hasCheckedRef = useRef(false);

  // Runs once per (draftType, scopeKey) — deliberately not on every render —
  // to look for a draft left behind by an earlier, possibly-crashed session,
  // before the persist effect below is allowed to touch storage at all.
  useEffect(() => {
    if (hasCheckedRef.current) {
      return;
    }
    hasCheckedRef.current = true;
    const draft = loadLocalDraft<TPayload>(draftType, scopeKey, schemaVersion);
    if (draft !== null) {
      setRecoveredPayload(draft);
    }
    setIsReady(true);
  }, [draftType, scopeKey, schemaVersion]);

  // `payload` is a fresh object identity on nearly every render (it is
  // typically built inline from `watch()` at each call site), so it is
  // compared by value through this JSON key rather than used as a dependency
  // directly — otherwise the debounce below would restart on every render
  // regardless of whether the value actually changed.
  const payloadKey = JSON.stringify(payload);
  useEffect(() => {
    if (!isReady) {
      return;
    }
    if (!hasUnsavedInput) {
      clearLocalDraft(draftType, scopeKey);
      return;
    }
    const timeoutId = window.setTimeout(() => {
      saveLocalDraft(draftType, scopeKey, schemaVersion, payload);
    }, debounceMs);
    return () => window.clearTimeout(timeoutId);
    // `payload` itself is intentionally omitted: `payloadKey` already tracks
    // every value change it would, without retriggering on identity alone.
  }, [draftType, scopeKey, schemaVersion, hasUnsavedInput, debounceMs, payloadKey, isReady]);

  return {
    recoveredPayload,
    recovered,
    acknowledgeRecovered: () => {
      setRecoveredPayload(null);
      setRecovered(true);
    },
    dismissRecovered: () => {
      clearLocalDraft(draftType, scopeKey);
      setRecoveredPayload(null);
      setRecovered(false);
    },
    clearDraft: () => {
      clearLocalDraft(draftType, scopeKey);
      setRecoveredPayload(null);
      setRecovered(false);
    },
  };
}
