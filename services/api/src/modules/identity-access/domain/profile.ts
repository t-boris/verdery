import { DeletionErrorCode } from '@verdery/api-contracts';
import { DomainRuleViolatedError } from '../../../platform/errors/application-error.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { AccountState } from './account-state.js';

/**
 * The Grow Garden application profile: PostgreSQL's side of identity.
 *
 * Firebase remains the sole authority for credentials, provider links, and
 * token state — this entity never carries them.
 *
 * Source: architecture/identity-and-authorization.md, section
 * "2. Identity Authority".
 */
export interface Profile {
  readonly id: Uuid;
  readonly firebaseUid: string;
  readonly accountState: AccountState;
  readonly locale: string;
  readonly timeZone: string;
  readonly revision: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  /** When account deletion was requested (P8-DELETE-01); `null` outside a pending deletion. */
  readonly deletionRequestedAt: Date | null;
  /** When the 30-day recovery window closes. Non-null exactly while `accountState` is `deletion_requested` or `disabled`. */
  readonly recoveryDeadlineAt: Date | null;
  /** When the purge finished. Non-null exactly while `accountState` is `purged`. */
  readonly purgedAt: Date | null;
}

const DEFAULT_LOCALE = 'en';
const DEFAULT_TIME_ZONE = 'UTC';

/**
 * Provisions a new profile for a first-seen Firebase identity.
 *
 * Starts directly in `active`, not `pending`: Phase 2 has no onboarding or
 * consent-gated registration policy built, and parking every new sign-in in
 * `pending` with no screen that ever moves it to `active` would make the
 * first-garden vertical slice this phase exists to deliver impossible to
 * reach. A future onboarding requirement is a policy this function's caller
 * can add without changing the entity itself.
 *
 * Source: architecture/identity-and-authorization.md, section
 * "6. Application Profile Provisioning".
 */
export function provisionProfile(id: Uuid, firebaseUid: string, createdAt: Date): Profile {
  return {
    id,
    firebaseUid,
    accountState: 'active',
    locale: DEFAULT_LOCALE,
    timeZone: DEFAULT_TIME_ZONE,
    revision: 1,
    createdAt,
    updatedAt: createdAt,
    deletionRequestedAt: null,
    recoveryDeadlineAt: null,
    purgedAt: null,
  };
}

/**
 * `active` -> `deletion_requested` (P8-DELETE-01): the account enters its
 * 30-day recovery window and ordinary access stops immediately, which is
 * exactly what `isAccountUsable` already means and why no separate "disable"
 * step is needed here — architecture/data-export-and-deletion.md section 11:
 * "During the window, ordinary access is disabled and the user may recover
 * through a verified process where offered."
 *
 * Only `active` may enter deletion: a `pending`, `suspended`, or already-
 * deleting account is a different situation with a different answer, and
 * guessing one here would be worse than refusing.
 */
export function requestAccountDeletion(
  profile: Profile,
  recoveryDeadlineAt: Date,
  now: Date,
): Profile {
  if (profile.accountState === 'deletion_requested') {
    throw new DomainRuleViolatedError(
      DeletionErrorCode.AlreadyRequested,
      'Deletion has already been requested for this account.',
    );
  }
  if (profile.accountState !== 'active') {
    throw new DomainRuleViolatedError(
      DeletionErrorCode.NotRecoverable,
      'This account cannot start deletion from its current state.',
    );
  }

  return {
    ...profile,
    accountState: 'deletion_requested',
    revision: profile.revision + 1,
    updatedAt: now,
    deletionRequestedAt: now,
    recoveryDeadlineAt,
  };
}

/**
 * `deletion_requested` -> `active`. Refused once the purge has been claimed
 * (`disabled`) with its own code, the same distinction `restoreGarden` draws:
 * "too late" and "nothing to undo" are different facts.
 */
export function restoreAccount(profile: Profile, now: Date): Profile {
  if (profile.accountState === 'disabled' || profile.accountState === 'purged') {
    throw new DomainRuleViolatedError(
      DeletionErrorCode.NotRecoverable,
      'This account is being purged and can no longer be restored.',
    );
  }
  if (profile.accountState !== 'deletion_requested') {
    throw new DomainRuleViolatedError(
      DeletionErrorCode.NotFound,
      'No deletion request is pending for this account.',
    );
  }

  return {
    ...profile,
    accountState: 'active',
    revision: profile.revision + 1,
    updatedAt: now,
    deletionRequestedAt: null,
    recoveryDeadlineAt: null,
  };
}

/**
 * `deletion_requested` -> `disabled`: the deletion sweep claiming an account
 * whose window has closed. `disabled` is the documented state between request
 * and purge (identity-and-authorization.md section 7:
 * `deletion_requested → disabled → purged`) and it is the point of no return
 * — `restoreAccount` above refuses it.
 *
 * Idempotent for the resume case, exactly like `claimGardenForPurge`.
 */
export function claimAccountForPurge(profile: Profile, now: Date): Profile {
  if (profile.accountState === 'disabled') {
    return profile;
  }
  if (profile.accountState !== 'deletion_requested') {
    throw new DomainRuleViolatedError(
      DeletionErrorCode.NotRecoverable,
      'Only an account with a pending deletion request can be purged.',
    );
  }

  return {
    ...profile,
    accountState: 'disabled',
    revision: profile.revision + 1,
    updatedAt: now,
  };
}

/**
 * `disabled` -> `purged`: the terminal tombstone.
 *
 * The row SURVIVES, minimized. It has to: roughly twenty NOT NULL foreign
 * keys point at it from content inside SHARED gardens that outlive this
 * account (`plant.created_by_profile_id`, `garden_object_revision
 * .actor_profile_id`, `media_record.uploaded_by_profile_id`, …), and that
 * content belongs to those gardens, not to this person. Deleting the row is
 * therefore impossible without destroying other people's gardens; what IS
 * possible — and what this does — is to leave behind nothing but an opaque
 * identifier and the fact of deletion.
 *
 * `firebaseUid` is replaced rather than nulled (the column is NOT NULL and
 * UNIQUE) with a value derived from the profile id: it can never collide with
 * a real Firebase uid, it cannot be used to look the person up, and it keeps
 * a future sign-in by the same human landing on a brand-new profile instead
 * of resurrecting this one. Locale and time zone go back to defaults —
 * both are personal settings, neither is referenced by anything.
 */
export function markAccountPurged(profile: Profile, now: Date): Profile {
  if (profile.accountState !== 'disabled') {
    throw new DomainRuleViolatedError(
      DeletionErrorCode.NotRecoverable,
      'Only a claimed account purge can be completed.',
    );
  }

  return {
    ...profile,
    firebaseUid: purgedFirebaseUid(profile.id),
    accountState: 'purged',
    locale: DEFAULT_LOCALE,
    timeZone: DEFAULT_TIME_ZONE,
    revision: profile.revision + 1,
    updatedAt: now,
    deletionRequestedAt: null,
    recoveryDeadlineAt: null,
    purgedAt: now,
  };
}

/** The unresolvable placeholder a purged profile's `firebase_uid` becomes — see `markAccountPurged`. */
export function purgedFirebaseUid(profileId: Uuid): string {
  return `purged:${profileId}`;
}
