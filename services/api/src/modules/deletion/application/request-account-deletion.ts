/**
 * `RequestAccountDeletion` (P8-DELETE-01) — architecture/data-export-and-
 * deletion.md section 11's entry point.
 *
 * Nothing is deleted. What happens, all in ONE transaction so the account and
 * its gardens can never disagree about whether a deletion is pending:
 *
 * 1. Recent authentication, evaluated against the session's own `auth_time`
 *    — the same step-up gate account-wide export already applies, for the
 *    same reason: a stolen long-lived session must not be able to do this.
 * 2. The account enters `deletion_requested`, which `isAccountUsable` already
 *    treats as unusable — section 11's "ordinary access is disabled" needs no
 *    separate mechanism, and the account-deletion routes are the one place
 *    that deliberately stays reachable so the user can still recover.
 * 3. OWNERSHIP RESOLUTION over every garden the caller has access to
 *    (section 11's "Resolves owned shared gardens by transfer or deletion
 *    policy"), each garden falling into exactly one of three cases:
 *
 *    - SOLE OWNER: the garden enters its own `deletion_requested` with the
 *      SAME deadline as the account, so the two purge together and neither
 *      outlives the other. The caller KEEPS this membership: they are still
 *      the owner, and restoring the account must be able to restore the
 *      garden. Its other members are revoked exactly as a direct garden
 *      deletion request would revoke them.
 *    - CO-OWNED: another active owner remains, so the garden survives
 *      untouched and only the caller's own membership is revoked. This is
 *      section 11's "transfer" branch, resolved by the co-owner already
 *      holding ownership rather than by inventing a transfer flow that does
 *      not exist (invitations and ownership transfer are still unbuilt).
 *    - EDITOR/VIEWER: the garden is none of the caller's to delete; the
 *      membership is revoked.
 *
 * Every revocation writes the revoked member an addressed `garden`/`delete`
 * sync change, so both the caller's OTHER devices and the collaborators of a
 * sole-owned garden converge offline (section 13).
 */

import type { AccountDeletion } from '@verdery/api-contracts';
import type { IdempotencyStore } from '../../../platform/idempotency/idempotency-store.js';
import {
  assertRecentAuthenticationForDeletion,
  recoveryDeadlineFrom,
} from '../../../shared/deletion/deletion-policy.js';
import type { DeletionActor } from '../../../shared/deletion/deletion-policy.js';
import type { Clock } from '../../../shared/time/clock.js';
import {
  activeOwners,
  applyGardenDeletionRequest,
  revokeGardenMemberships,
} from '../../gardens-mapping/public.js';
import type { Garden, MembershipDetail } from '../../gardens-mapping/public.js';
import { requestAccountDeletion } from '../../identity-access/public.js';
import { accountDeletionNotFoundError } from './deletion-errors.js';
import { toAccountDeletionResource } from './account-deletion-view.js';
import type { AccountDeletionGardenInput } from './account-deletion-view.js';
import type { DeletionTransactionContext, DeletionUnitOfWork } from './deletion-unit-of-work.js';
import { runIdempotentCommand } from './run-idempotent-command.js';

const OPERATION = 'account.deletion_request';

export class RequestAccountDeletion {
  constructor(
    private readonly idempotency: IdempotencyStore,
    private readonly unitOfWork: DeletionUnitOfWork,
    private readonly clock: Clock,
  ) {}

  async execute(actor: DeletionActor, idempotencyKey: string): Promise<AccountDeletion> {
    assertRecentAuthenticationForDeletion(actor.authenticatedAt, this.clock.now());

    const input = {
      actorProfileId: actor.profileId,
      operation: OPERATION,
      idempotencyKey,
      requestFingerprint: JSON.stringify({ profileId: actor.profileId }),
    };

    return runIdempotentCommand(this.idempotency, this.unitOfWork, input, 200, async (context) => {
      const now = this.clock.now();
      const recoveryDeadlineAt = recoveryDeadlineFrom(now);

      const profile = await context.profiles.findById(actor.profileId);
      if (profile === null) {
        // Unreachable through the authenticated pipeline, which provisions
        // the profile before any handler runs — an honest not-found beats a
        // crash if the row disappeared underneath us.
        throw accountDeletionNotFoundError();
      }

      const requested = requestAccountDeletion(profile, recoveryDeadlineAt, now);
      await context.profiles.update(requested, profile.revision);

      const resolved = await this.resolveGardens(context, actor.profileId, recoveryDeadlineAt, now);

      await context.outbox.append({
        eventType: 'account.deletion_requested',
        aggregateType: 'profile',
        aggregateId: requested.id,
        payload: {},
      });
      await context.auditLogger.record({
        eventType: 'account.deletion_requested',
        subjectType: 'profile',
        subjectId: requested.id,
        actorProfileId: actor.profileId,
        actorType: 'user',
        // Counts and a deadline. No garden names, no email, nothing that
        // would survive the purge as a copy of what was deleted.
        details: {
          recoveryDeadlineAt: recoveryDeadlineAt.toISOString(),
          gardensEnteringDeletion: resolved.filter(
            (entry) => entry.garden?.lifecycleState === 'deletion_requested',
          ).length,
          membershipsRevoked: resolved.filter((entry) => entry.membership.state === 'removed')
            .length,
        },
      });

      return toAccountDeletionResource(requested, now, recoveryDeadlineAt, resolved);
    });
  }

  /** Section 11's ownership resolution — see this class's header for the three cases. */
  private async resolveGardens(
    context: DeletionTransactionContext,
    profileId: string,
    recoveryDeadlineAt: Date,
    now: Date,
  ): Promise<readonly AccountDeletionGardenInput[]> {
    const memberships = await context.memberships.listDetailsForProfile(profileId);
    const resolved: AccountDeletionGardenInput[] = [];

    for (const membership of memberships) {
      if (membership.state !== 'active') {
        continue;
      }

      const garden = await context.gardens.findById(membership.gardenId);
      if (garden === null) {
        // A tombstone membership for an already-purged garden; nothing left
        // to resolve.
        continue;
      }

      resolved.push(
        await this.resolveOne(context, membership, garden, profileId, recoveryDeadlineAt, now),
      );
    }

    return resolved;
  }

  private async resolveOne(
    context: DeletionTransactionContext,
    membership: MembershipDetail,
    garden: Garden,
    profileId: string,
    recoveryDeadlineAt: Date,
    now: Date,
  ): Promise<AccountDeletionGardenInput> {
    const soleOwner =
      membership.role === 'owner' &&
      activeOwners(await context.memberships.listForGarden(garden.id)).length === 1;

    if (soleOwner) {
      // Already deleting (a direct garden request the user made earlier):
      // leave its own, earlier deadline alone rather than pushing it out.
      if (garden.lifecycleState === 'deletion_requested' || garden.lifecycleState === 'purging') {
        return { membership, garden };
      }

      // The account's deadline, restated rather than left to the garden
      // transition's own `now + 30 days`: the two are equal today because
      // both derive from this same instant, and pinning it here is what
      // keeps them equal if either policy ever moves.
      const requested = { ...applyGardenDeletionRequest(garden, now), recoveryDeadlineAt };
      await context.gardens.update(requested, garden.revision);
      await context.syncChanges.record({
        gardenId: requested.id,
        recordId: requested.id,
        recordType: 'garden',
        operation: 'upsert',
        recordRevision: requested.revision,
      });
      await revokeGardenMemberships(context, requested, profileId, now);

      return { membership, garden: requested };
    }

    // Co-owned or lesser role: the garden survives; only this membership goes.
    await context.memberships.setState(membership.id, 'removed', now);
    await context.syncChanges.record({
      gardenId: garden.id,
      recordId: garden.id,
      recordType: 'garden',
      operation: 'delete',
      recordRevision: garden.revision,
      targetProfileId: profileId,
    });

    return { membership: { ...membership, state: 'removed', updatedAt: now }, garden };
  }
}
