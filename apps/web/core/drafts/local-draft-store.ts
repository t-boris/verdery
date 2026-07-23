/**
 * Schema-versioned local drafts.
 *
 * Backs `architecture/web-application-design.md`'s "6. State Ownership"
 * table entry ("Recoverable drafts | IndexedDB or local storage adapter with
 * explicit schema") and section "9. Online-First Behavior" ("Unsaved editor
 * work remains in a local draft").
 *
 * `localStorage`, not IndexedDB, was chosen for every draft this application
 * currently persists: every draft type in this codebase — a form's field
 * values, or the map editor's in-progress vertex list — is a small,
 * synchronously-serializable JSON value (at most a few kilobytes even for a
 * long fence trace), nowhere near `localStorage`'s practical multi-megabyte
 * origin quota. IndexedDB's advantages (asynchronous, larger-capacity,
 * transactional storage for structured or binary data) would add real
 * complexity — an async API, its own migration story — for no benefit at
 * this data size. It is the right choice for a future, larger concern this
 * work package does not build: section 9's "Large imports preserve local
 * recovery metadata when browser capabilities allow it" (`features/imports`
 * does not exist in this codebase yet; see
 * `docs/development/deferred-capabilities.md`).
 *
 * Every stored draft carries an explicit `schemaVersion`. Each draft type
 * owns one version constant (for example `ADD_PLANT_DRAFT_SCHEMA_VERSION`),
 * incremented whenever that draft's payload shape changes in a way an old
 * stored draft could not be blindly reapplied under — a field renamed,
 * removed, or given a new type. This mirrors the `commandVersion` convention
 * the iOS client's `CoreDomain/Synchronization` payload types already use
 * (for example `GardenSyncCommandPayload.version`), applied here to a
 * client-only concept with no server or contract counterpart. A stored
 * draft whose `schemaVersion` does not match the caller's current constant
 * is treated as absent: discarded, never partially applied or upcast.
 */

export interface DraftEnvelope<TPayload> {
  readonly schemaVersion: number;
  readonly draftType: string;
  readonly savedAt: string;
  readonly payload: TPayload;
}

const STORAGE_KEY_PREFIX = 'verdery.draft.';

function draftStorageKey(draftType: string, scopeKey: string): string {
  return `${STORAGE_KEY_PREFIX}${draftType}.${scopeKey}`;
}

/**
 * `localStorage` is a browser global reached through this one adapter
 * (architecture doc section "20. Dependency Rules"), and every access is
 * wrapped: private browsing, an exhausted origin quota, or a disabled
 * storage API can all make it throw, and server rendering has no `window`
 * at all. None of those conditions should ever break the form or map
 * session the caller is actually using — a lost draft is an acceptable
 * degradation, a crash is not.
 */
function localStorageOrNull(): Storage | null {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function saveLocalDraft<TPayload>(
  draftType: string,
  scopeKey: string,
  schemaVersion: number,
  payload: TPayload,
): void {
  const storage = localStorageOrNull();
  if (storage === null) {
    return;
  }

  const envelope: DraftEnvelope<TPayload> = {
    schemaVersion,
    draftType,
    savedAt: new Date().toISOString(),
    payload,
  };

  try {
    storage.setItem(draftStorageKey(draftType, scopeKey), JSON.stringify(envelope));
  } catch {
    // Quota exceeded or storage disabled — see this module's doc comment.
  }
}

/**
 * Reads back a draft saved by `saveLocalDraft`, or `null` when there is
 * none, it was written under a different `schemaVersion`, or it is not
 * parseable JSON (a hand-edited or corrupted value). All three are treated
 * identically: no partially-valid draft is ever handed back to a caller.
 */
export function loadLocalDraft<TPayload>(
  draftType: string,
  scopeKey: string,
  schemaVersion: number,
): TPayload | null {
  const storage = localStorageOrNull();
  if (storage === null) {
    return null;
  }

  const raw = storage.getItem(draftStorageKey(draftType, scopeKey));
  if (raw === null) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<DraftEnvelope<TPayload>>;
    if (
      parsed.schemaVersion !== schemaVersion ||
      parsed.draftType !== draftType ||
      parsed.payload === undefined
    ) {
      return null;
    }
    return parsed.payload;
  } catch {
    return null;
  }
}

export function clearLocalDraft(draftType: string, scopeKey: string): void {
  const storage = localStorageOrNull();
  if (storage === null) {
    return;
  }

  try {
    storage.removeItem(draftStorageKey(draftType, scopeKey));
  } catch {
    // Same reasoning as `saveLocalDraft`.
  }
}
