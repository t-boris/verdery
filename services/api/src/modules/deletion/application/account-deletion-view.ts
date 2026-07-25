/**
 * Builds the `AccountDeletion` contract resource (P8-DELETE-01).
 *
 * The per-garden resolution is DERIVED from current state rather than stored,
 * and that is a deliberate choice worth defending: every fact the resource
 * reports is already recorded somewhere authoritative — the garden's own
 * lifecycle state, the membership's own state and role, the instant it last
 * moved — so a stored copy would be a second answer to a question that
 * already has one, and the two could disagree after a restore, a co-owner's
 * departure, or a garden's own separate deletion. Deriving cannot drift.
 *
 * The three resolutions map onto observable state exactly:
 *
 * - `gardenDeletionRequested` — the caller still owns the garden actively and
 *   the garden is itself in `deletionRequested`/`purging`. That combination
 *   is only produced by ownership resolution: a sole owner keeps membership
 *   (they may still restore) while the garden they own alone follows the
 *   account into deletion.
 * - `ownershipRetainedByCoOwner` — the membership was revoked and its role
 *   was `owner`, so somebody else's ownership is what let the garden survive.
 * - `membershipRevoked` — the membership was revoked and the role was
 *   editor/viewer.
 *
 * Memberships whose state last moved BEFORE the deletion request are excluded
 * entirely: they were revoked for some unrelated earlier reason and reporting
 * them as consequences of this request would be false.
 */

import type { AccountDeletion, AccountDeletionGarden } from '@verdery/api-contracts';
import type { Garden, MembershipDetail } from '../../gardens-mapping/public.js';
import type { Profile } from '../../identity-access/public.js';

export interface AccountDeletionGardenInput {
  readonly membership: MembershipDetail;
  /** `null` when the garden row no longer exists — a purged garden this membership is now only a tombstone for. */
  readonly garden: Garden | null;
}

export function toAccountDeletionResource(
  profile: Profile,
  requestedAt: Date,
  recoveryDeadlineAt: Date,
  gardens: readonly AccountDeletionGardenInput[],
): AccountDeletion {
  const resolved: AccountDeletionGarden[] = [];

  for (const entry of gardens) {
    const resolution = resolveGarden(entry, requestedAt);
    if (resolution !== null) {
      resolved.push({ gardenId: entry.membership.gardenId, resolution });
    }
  }

  return {
    profileId: profile.id,
    // `disabled` is the claimed-purge state (identity-and-authorization.md
    // section 7's `deletion_requested → disabled → purged`); the contract
    // names the same thing `purging`, matching the garden vocabulary.
    state: profile.accountState === 'disabled' ? 'purging' : 'recoveryWindow',
    requestedAt: requestedAt.toISOString(),
    recoveryDeadlineAt: recoveryDeadlineAt.toISOString(),
    gardens: resolved,
  };
}

function resolveGarden(
  entry: AccountDeletionGardenInput,
  requestedAt: Date,
): AccountDeletionGarden['resolution'] | null {
  if (entry.membership.state === 'active') {
    const lifecycle = entry.garden?.lifecycleState;
    return lifecycle === 'deletion_requested' || lifecycle === 'purging'
      ? 'gardenDeletionRequested'
      : null;
  }

  if (entry.membership.updatedAt.getTime() < requestedAt.getTime()) {
    return null;
  }

  return entry.membership.role === 'owner' ? 'ownershipRetainedByCoOwner' : 'membershipRevoked';
}
