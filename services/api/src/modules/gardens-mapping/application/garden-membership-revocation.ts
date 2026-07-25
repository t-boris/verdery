/**
 * The membership half of garden deletion and recovery (P8-DELETE-01) —
 * architecture/data-export-and-deletion.md section 10's step 2 ("Resolves
 * other owners and shared access") and step 6 ("Emits revocation changes for
 * offline clients"), and the exact reversal of both.
 *
 * WHY THE OWNER IS NEVER REVOKED HERE: the requesting owner is the only
 * person who can withdraw the request, and section 11's recovery window is
 * worthless if the act of starting deletion also locks the person who might
 * change their mind out of the garden. Every OTHER member loses access
 * immediately, which is what step 3's "revokes new edits" means for someone
 * who is not deciding.
 *
 * WHY EACH TOMBSTONE IS ADDRESSED: a `garden`/`delete` sync change is how a
 * revoked collaborator's offline client learns to purge its local copy
 * (section 13). The same row read by the still-active owner would make the
 * OWNER's client purge a garden that is still recoverable — so revocation
 * writes `targetProfileId`, and the owner's own pull never sees it. See the
 * deletion baseline migration's comment on `platform.sync_change
 * .target_profile_id`.
 *
 * WHICH ROWS A RESTORE REVERSES: exactly those this request revoked, matched
 * on `updatedAt >= deletionRequestedAt`. A membership removed BEFORE the
 * deletion request was removed for some other reason and is none of the
 * restore's business — reactivating it would silently re-grant access nobody
 * asked to re-grant.
 */

import type { SyncChangeRecorder } from '../../../platform/sync/sync-change-recorder.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { Garden } from '../domain/garden.js';
import type { MembershipDetail, MembershipRepository } from './membership-repository.js';

export interface MembershipRevocationPorts {
  readonly memberships: MembershipRepository;
  readonly syncChanges: SyncChangeRecorder;
}

/**
 * Revokes every ACTIVE membership on `garden` except `retainedProfileId`'s,
 * addressing each revoked member their own garden tombstone. Returns the
 * profile ids revoked, so the caller can record how many without re-reading.
 *
 * Pass `retainedProfileId: null` at purge time: by then nobody is deciding
 * anything and every remaining member — the owner included — must converge.
 */
export async function revokeGardenMemberships(
  ports: MembershipRevocationPorts,
  garden: Garden,
  retainedProfileId: Uuid | null,
  now: Date,
): Promise<readonly Uuid[]> {
  const memberships = await ports.memberships.listForGarden(garden.id);
  const revoked: Uuid[] = [];

  for (const membership of memberships) {
    if (membership.state !== 'active' || membership.profileId === retainedProfileId) {
      continue;
    }

    await ports.memberships.setState(membership.id, 'removed', now);
    await ports.syncChanges.record({
      gardenId: garden.id,
      recordId: garden.id,
      recordType: 'garden',
      operation: 'delete',
      recordRevision: garden.revision,
      targetProfileId: membership.profileId,
    });
    revoked.push(membership.profileId);
  }

  return revoked;
}

/**
 * Reactivates the memberships a deletion request revoked — see this file's
 * header for why the match is `updatedAt >= revokedSince` rather than "every
 * removed row" — and addresses each restored member an `upsert` so their
 * client learns the garden is back.
 *
 * A restored client holds no content for the garden any more (it purged
 * locally on the tombstone) and this single `garden` upsert does not re-emit
 * that content: the client's own recovery is a full resynchronization, the
 * response offline-synchronization.md section 13 already prescribes for
 * "authorization partitions changed incompatibly". Recorded in
 * `docs/development/deferred-capabilities.md`.
 */
export async function restoreGardenMemberships(
  ports: MembershipRevocationPorts,
  garden: Garden,
  revokedSince: Date,
  now: Date,
): Promise<readonly Uuid[]> {
  const memberships = await ports.memberships.listForGarden(garden.id);
  const restored: Uuid[] = [];

  for (const membership of memberships) {
    if (membership.state !== 'removed' || membership.updatedAt.getTime() < revokedSince.getTime()) {
      continue;
    }

    await ports.memberships.setState(membership.id, 'active', now);
    await ports.syncChanges.record({
      gardenId: garden.id,
      recordId: garden.id,
      recordType: 'garden',
      operation: 'upsert',
      recordRevision: garden.revision,
      targetProfileId: membership.profileId,
    });
    restored.push(membership.profileId);
  }

  return restored;
}

/** The active owners of a garden — the ownership-resolution input account deletion needs (section 11). */
export function activeOwners(
  memberships: readonly MembershipDetail[],
): readonly MembershipDetail[] {
  return memberships.filter(
    (membership) => membership.state === 'active' && membership.role === 'owner',
  );
}
