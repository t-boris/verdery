/**
 * Opaque `after`/`nextCursor` codec for `GET /v1/sync/changes`, plus the
 * retention window that decides `sync.changes.cursor_expired`.
 *
 * Encoding mirrors `kysely-garden-repository.ts`'s own `encodeCursor`/
 * `decodeCursor` (base64url JSON, `SharedErrorCode.RequestInvalid` on a
 * malformed value) — the same convention, applied to a different pair of
 * fields.
 *
 * A cursor carries two things, not one:
 *
 * - `afterSequence`: the `platform.sync_change.sequence` position to resume
 *   from — `0` means "from the beginning of history", the value an omitted
 *   `after` (a first-ever pull) is treated as. This is the only field that
 *   matters for *which rows* the next page returns.
 * - `issuedAt`: when this cursor was handed out. This field exists purely to
 *   decide retention (see below) — it plays no part in row selection.
 *
 * Retention: `platform.sync_change` has no cleanup/rotation job today (see
 * that table's own migration comment — "No endpoint reads or writes this
 * table in Phase 2", still true of deletion in this pass: nothing purges a
 * row once written), so every row ever written remains physically queryable
 * forever. `sync.changes.cursor_expired` is therefore not a function of
 * whether the referenced history still exists in the table — it always does
 * — but of how long it has been since the client last actually pulled.
 * `issuedAt` is refreshed on every successful page (including an empty one),
 * so a client that pulls at least once within the retention window never
 * expires; only a client that goes silent for longer than that is forced
 * through `sync.changes.cursor_expired` into a full resynchronization
 * (architecture/offline-synchronization.md, section "13. Full
 * Resynchronization").
 *
 * `SYNC_CHANGES_RETENTION_MILLISECONDS` is this module's own reasoned
 * default, not a documented architecture requirement — the same status
 * `sync-push-idempotency.ts`'s own `SYNC_PUSH_TTL_MILLISECONDS` comment
 * gives its identical 30-day figure. The two are deliberately kept as
 * separate constants (this file does not import that one, and vice versa)
 * rather than unified into one shared value: they bound two independent
 * concerns — how long a *push* operation ID stays replayable versus how long
 * a *pull* cursor stays resumable — that only happen to reuse the same
 * "maximum supported offline duration" reasoning and the same number.
 * Coincidentally equal today, not architecturally required to stay equal.
 * Picking anything shorter here would make pull expire before an
 * equally-old push retry could still be resolved via idempotency replay,
 * which would be a strictly worse, inconsistent client experience — so this
 * number is a deliberate floor, not an arbitrary match.
 */

import { SharedErrorCode, SyncErrorCode } from '@verdery/api-contracts';
import { ConflictError, ValidationError } from '../../../platform/errors/application-error.js';

const DAYS = 24 * 60 * 60 * 1000;
export const SYNC_CHANGES_RETENTION_MILLISECONDS = 30 * DAYS;

export interface SyncChangesCursor {
  readonly afterSequence: number;
  readonly issuedAt: Date;
}

/** The cursor a first-ever pull (`after` omitted) is treated as — see this file's own header comment. `issuedAt` is `null`, not "now", because a fresh start has nothing to have gone stale. */
export const INITIAL_SYNC_CURSOR: { readonly afterSequence: number; readonly issuedAt: null } = {
  afterSequence: 0,
  issuedAt: null,
};

function invalidCursorError(): ValidationError {
  return new ValidationError(SharedErrorCode.RequestInvalid, 'The sync cursor is invalid.', {
    details: [{ code: 'request.cursor.invalid', pointer: '/after' }],
  });
}

export function encodeSyncChangesCursor(cursor: SyncChangesCursor): string {
  return Buffer.from(
    JSON.stringify({
      afterSequence: cursor.afterSequence,
      issuedAt: cursor.issuedAt.toISOString(),
    }),
  ).toString('base64url');
}

/** Malformed input means either a bug in this service's own encoding or a client that tried to construct one — both are the client's problem to fix, matching `SyncAfterCursor`'s own "clients must not parse it." */
export function decodeSyncChangesCursor(cursor: string): SyncChangesCursor {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (typeof parsed === 'object' && parsed !== null) {
      const record = parsed as Record<string, unknown>;
      const afterSequence = record['afterSequence'];
      const issuedAtRaw = record['issuedAt'];

      if (
        typeof afterSequence === 'number' &&
        Number.isInteger(afterSequence) &&
        afterSequence >= 0 &&
        typeof issuedAtRaw === 'string'
      ) {
        const issuedAt = new Date(issuedAtRaw);
        if (!Number.isNaN(issuedAt.getTime())) {
          return { afterSequence, issuedAt };
        }
      }
    }
  } catch {
    // Falls through to the thrown ValidationError below.
  }

  throw invalidCursorError();
}

/** Throws `sync.changes.cursor_expired` (mapped to `409`) when `issuedAt` is older than the retention window — see this file's own header comment. */
export function requireFreshCursor(issuedAt: Date, now: Date): void {
  if (now.getTime() - issuedAt.getTime() > SYNC_CHANGES_RETENTION_MILLISECONDS) {
    throw new ConflictError(
      SyncErrorCode.CursorExpired,
      'This sync cursor is older than the server retains resumable history; a full resynchronization is required.',
    );
  }
}
