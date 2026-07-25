/**
 * `RestoreAccountDeletion` (P8-DELETE-01) — the exact reversal of
 * `RequestAccountDeletion`, inside the recovery window.
 *
 * Reverses all three of the request's effects in one transaction:
 *
 * 1. The account returns to `active`, which restores ordinary access
 *    everywhere at once (`isAccountUsable` is the single gate).
 * 2. Every membership the request revoked comes back — matched on "removed
 *    at or after the request instant", so a membership revoked for some
 *    earlier, unrelated reason is left alone rather than silently re-granted.
 * 3. Every garden the request put into `deletionRequested` returns to
 *    `active`, and each of THOSE gardens' own revoked collaborators is
 *    restored too, through the same helper a direct `restoreGarden` uses.
 *
 * A garden that reached `purging` before the restore is skipped: it is past
 * the point of no return, and taking the whole account restore down with it
 * would punish the user for a race they cannot see. The account itself
 * refuses to restore once the ACCOUNT purge is claimed (`disabled`), which is
 * the case that genuinely cannot be undone.
 */

import type { IdempotencyStore } from '../../../platform/idempotency/idempotency-store.js';
import { assertRecentAuthenticationForDeletion } from '../../../shared/deletion/deletion-policy.js';
import type { DeletionActor } from '../../../shared/deletion/deletion-policy.js';
import type { Clock } from '../../../shared/time/clock.js';
import { applyGardenRestore, restoreGardenMemberships } from '../../gardens-mapping/public.js';
import { restoreAccount } from '../../identity-access/public.js';
import { accountDeletionNotFoundError } from './deletion-errors.js';
import type { DeletionUnitOfWork } from './deletion-unit-of-work.js';
import { runIdempotentCommand } from './run-idempotent-command.js';

const OPERATION = 'account.deletion_request.restore';

export class RestoreAccountDeletion {
  constructor(
    private readonly idempotency: IdempotencyStore,
    private readonly unitOfWork: DeletionUnitOfWork,
    private readonly clock: Clock,
  ) {}

  async execute(actor: DeletionActor, idempotencyKey: string): Promise<void> {
    assertRecentAuthenticationForDeletion(actor.authenticatedAt, this.clock.now());

    const input = {
      actorProfileId: actor.profileId,
      operation: OPERATION,
      idempotencyKey,
      requestFingerprint: JSON.stringify({ profileId: actor.profileId }),
    };

    await runIdempotentCommand(this.idempotency, this.unitOfWork, input, 204, async (context) => {
      const now = this.clock.now();

      const profile = await context.profiles.findById(actor.profileId);
      if (profile === null || profile.accountState === 'active') {
        throw accountDeletionNotFoundError();
      }

      const requestedAt = profile.deletionRequestedAt ?? profile.updatedAt;
      const restored = restoreAccount(profile, now);
      await context.profiles.update(restored, profile.revision);

      let gardensRestored = 0;
      const memberships = await context.memberships.listDetailsForProfile(actor.profileId);

      for (const membership of memberships) {
        if (
          membership.state === 'removed' &&
          membership.updatedAt.getTime() >= requestedAt.getTime()
        ) {
          const garden = await context.gardens.findById(membership.gardenId);
          if (garden === null) {
            // The garden was purged in the meantime — a membership tombstone
            // for something that no longer exists cannot be reactivated.
            continue;
          }
          await context.memberships.setState(membership.id, 'active', now);
          await context.syncChanges.record({
            gardenId: garden.id,
            recordId: garden.id,
            recordType: 'garden',
            operation: 'upsert',
            recordRevision: garden.revision,
            targetProfileId: actor.profileId,
          });
          continue;
        }

        if (membership.state !== 'active') {
          continue;
        }

        const garden = await context.gardens.findById(membership.gardenId);
        if (garden === null || garden.lifecycleState !== 'deletion_requested') {
          // Not deleting, or already past the point of no return — see this
          // class's header for why `purging` is skipped rather than fatal.
          continue;
        }
        if ((garden.deletionRequestedAt?.getTime() ?? 0) < requestedAt.getTime()) {
          // The user asked for THIS garden to be deleted before they asked for
          // the account — a separate decision, made earlier, that withdrawing
          // the account deletion says nothing about. The same cutoff the
          // membership half uses, for the same reason: a restore reverses what
          // its own request did, never what someone already decided.
          continue;
        }

        const active = applyGardenRestore(garden, now);
        await context.gardens.update(active, garden.revision);
        await context.syncChanges.record({
          gardenId: active.id,
          recordId: active.id,
          recordType: 'garden',
          operation: 'upsert',
          recordRevision: active.revision,
        });
        await restoreGardenMemberships(context, active, requestedAt, now);
        gardensRestored += 1;
      }

      await context.auditLogger.record({
        eventType: 'account.deletion_withdrawn',
        subjectType: 'profile',
        subjectId: restored.id,
        actorProfileId: actor.profileId,
        actorType: 'user',
        details: { gardensRestored },
      });

      return null;
    });
  }
}
