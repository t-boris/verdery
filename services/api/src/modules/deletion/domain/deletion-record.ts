/**
 * The purge job — which is also the completion evidence (P8-DELETE-01).
 *
 * One row per subject whose recovery window closed and whose purge was
 * claimed. It exists ONLY from the claim onward: while a deletion is
 * recoverable there is nothing irreversible to record, and the subject's own
 * lifecycle state already carries the request and its deadline.
 *
 * ```text
 * (claimed by the sweep) ──▶ purging ──completePurge──▶ purged
 *                              │  ▲
 *                              │  └── deferPurge (media bytes not yet
 *                              │      confirmed absent; the next sweep pass
 *                              │      resumes from the recorded checkpoints)
 *                              └─────┘
 * ```
 *
 * There is no `failed` state. Section 16 requires that "partial provider
 * failure remains internally visible and retries" — a purge that cannot
 * finish stays `purging` with a `deferredReason` and an honest attempt count,
 * which is visible and retried. A terminal state would silently stop the
 * sweep from ever trying again, which is the one outcome a deletion must
 * never quietly reach.
 *
 * WHAT THIS ROW MAY CONTAIN, per section 19 ("Deletion completion is
 * verifiable without retaining deleted content"): identifiers, timestamps,
 * and counts. Nothing here, and nothing in the `purge_checkpoint` children,
 * carries a name, a photo, a location, or any other value that was deleted.
 */

import { DeletionErrorCode } from '@verdery/api-contracts';
import { DomainRuleViolatedError } from '../../../platform/errors/application-error.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';

export type DeletionSubjectType = 'garden' | 'account';

export type DeletionRecordState = 'purging' | 'purged';

export interface DeletionRecord {
  readonly id: Uuid;
  readonly subjectType: DeletionSubjectType;
  readonly subjectId: Uuid;
  /** Who asked. For an account deletion this is the account itself. */
  readonly requestedByProfileId: Uuid;
  readonly state: DeletionRecordState;
  /** Copied off the subject at claim time, so the evidence still answers "was the window honored?" after the subject is unreadable. */
  readonly requestedAt: Date;
  readonly recoveryDeadlineAt: Date;
  readonly purgeStartedAt: Date;
  readonly completedAt: Date | null;
  readonly attemptCount: number;
  readonly deferredReason: string | null;
  readonly mediaRecordsScheduled: number;
  readonly identityProviderDeletedAt: Date | null;
  readonly revision: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface ClaimPurgeInput {
  readonly id: Uuid;
  readonly subjectType: DeletionSubjectType;
  readonly subjectId: Uuid;
  readonly requestedByProfileId: Uuid;
  readonly requestedAt: Date;
  readonly recoveryDeadlineAt: Date;
}

export function claimPurge(input: ClaimPurgeInput, now: Date): DeletionRecord {
  return {
    id: input.id,
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    requestedByProfileId: input.requestedByProfileId,
    state: 'purging',
    requestedAt: input.requestedAt,
    recoveryDeadlineAt: input.recoveryDeadlineAt,
    purgeStartedAt: now,
    completedAt: null,
    // Zero, not one: the claim is not itself a pass. The sweep's very first
    // pass over the claimed record calls `beginPurgeAttempt`, which makes
    // this 1 — so the number always reads as "passes that actually tried".
    attemptCount: 0,
    deferredReason: null,
    mediaRecordsScheduled: 0,
    identityProviderDeletedAt: null,
    revision: 1,
    createdAt: now,
    updatedAt: now,
  };
}

/** Counts one more sweep pass over an unfinished purge, and clears whatever the previous pass was waiting on. */
export function beginPurgeAttempt(record: DeletionRecord, now: Date): DeletionRecord {
  requirePurging(record, 'beginPurgeAttempt');

  return {
    ...record,
    attemptCount: record.attemptCount + 1,
    deferredReason: null,
    revision: record.revision + 1,
    updatedAt: now,
  };
}

/** Records how many media records this purge handed to the byte-deletion workflow — a count, never a list. */
export function recordScheduledMediaDeletions(
  record: DeletionRecord,
  scheduled: number,
  now: Date,
): DeletionRecord {
  requirePurging(record, 'recordScheduledMediaDeletions');

  return {
    ...record,
    mediaRecordsScheduled: record.mediaRecordsScheduled + scheduled,
    revision: record.revision + 1,
    updatedAt: now,
  };
}

/** Section 11's "Deletes Firebase Authentication identity after application preconditions", once the provider has confirmed it. */
export function recordIdentityProviderDeletion(record: DeletionRecord, now: Date): DeletionRecord {
  requirePurging(record, 'recordIdentityProviderDeletion');

  if (record.identityProviderDeletedAt !== null) {
    return record;
  }

  return {
    ...record,
    identityProviderDeletedAt: now,
    revision: record.revision + 1,
    updatedAt: now,
  };
}

/**
 * Stops this pass short with a stable machine reason, leaving the purge
 * `purging` so the next sweep resumes it. The one legitimate reason today is
 * media bytes not yet confirmed absent.
 */
export function deferPurge(record: DeletionRecord, reason: string, now: Date): DeletionRecord {
  requirePurging(record, 'deferPurge');

  return { ...record, deferredReason: reason, revision: record.revision + 1, updatedAt: now };
}

/** `purging` -> `purged`. Idempotent: re-completing an already-purged record changes nothing. */
export function completePurge(record: DeletionRecord, now: Date): DeletionRecord {
  if (record.state === 'purged') {
    return record;
  }

  return {
    ...record,
    state: 'purged',
    completedAt: now,
    deferredReason: null,
    revision: record.revision + 1,
    updatedAt: now,
  };
}

function requirePurging(record: DeletionRecord, action: string): void {
  if (record.state !== 'purging') {
    throw new DomainRuleViolatedError(
      DeletionErrorCode.NotRecoverable,
      `${action} requires deletion record '${record.id}' to still be purging.`,
    );
  }
}
