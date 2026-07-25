/**
 * The two policy numbers both deletion halves share, and the gates built on
 * them (P8-DELETE-01).
 *
 * Deliberately here rather than inside either module: garden deletion lives
 * in `gardens-mapping` (it writes only that module's own schemas) while
 * account deletion lives in `deletion`, and the recovery window and the
 * step-up gate must be ONE value for both — data-export-and-deletion.md
 * states the window once, for the whole feature ("The baseline recovery
 * window is 30 days", section 11), and requires recent authentication on
 * both entry points (sections 10.1 and 11). Two constants in two modules
 * could drift; one cannot.
 *
 * Source: architecture/data-export-and-deletion.md, sections "10. Garden
 * Deletion", "11. Account Deletion".
 */

import { DeletionErrorCode } from '@verdery/api-contracts';
import { ForbiddenError } from '../../platform/errors/application-error.js';

/**
 * The approved recovery window: 30 days, named verbatim by section 11 ("The
 * baseline recovery window is 30 days") and applied to gardens too, since
 * section 10.4's "the approved recovery window" has no second figure to mean.
 */
export const DELETION_RECOVERY_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * How recent the session's underlying sign-in must be to request — or to
 * withdraw — a deletion. Reuses P8-EXPORT-01's already-documented 30-minute
 * step-up window verbatim: no document names a figure for either feature, and
 * two different step-up windows for two equally sensitive account operations
 * would be an arbitrary distinction a user would experience as inconsistency.
 *
 * The gate applies to the RESTORE direction as well as the request. Recovery
 * is what stops a stolen long-lived session from quietly deleting an account,
 * so an attacker who can silently withdraw the victim's protective deletion
 * request — or re-request it after the victim recovers — has defeated the
 * same protection from the other side.
 */
export const DELETION_RECENT_AUTHENTICATION_MAX_AGE_MS = 30 * 60 * 1000;

/** The instant a deletion requested at `now` stops being recoverable. */
export function recoveryDeadlineFrom(now: Date): Date {
  return new Date(now.getTime() + DELETION_RECOVERY_WINDOW_MS);
}

/** `true` once the recovery window has closed and the purge may be claimed. */
export function isRecoveryWindowClosed(recoveryDeadlineAt: Date, now: Date): boolean {
  return recoveryDeadlineAt.getTime() <= now.getTime();
}

/**
 * Throws unless the session's own `auth_time` is recent enough — never a
 * client-supplied instant, exactly as `assertRecentAuthenticationForAccountExport`
 * already establishes for exports.
 */
export function assertRecentAuthenticationForDeletion(
  sessionAuthenticatedAt: Date,
  now: Date,
): void {
  if (
    now.getTime() - sessionAuthenticatedAt.getTime() >
    DELETION_RECENT_AUTHENTICATION_MAX_AGE_MS
  ) {
    throw new ForbiddenError(
      DeletionErrorCode.RecentAuthenticationRequired,
      'Deletion and recovery require a recent sign-in. Sign in again and retry.',
    );
  }
}

/**
 * The narrow actor shape every deletion command needs: who is acting, and
 * when their sign-in actually happened. Structurally satisfied by
 * `ActorContext`, so a transport layer passes `request.actorContext`
 * unchanged and a test passes two fields.
 */
export interface DeletionActor {
  readonly profileId: string;
  readonly authenticatedAt: Date;
}
