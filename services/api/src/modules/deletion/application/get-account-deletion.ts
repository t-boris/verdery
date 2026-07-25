/**
 * `GetAccountDeletion` (P8-DELETE-01): what is pending for the caller's own
 * account, and when it becomes irreversible.
 *
 * Deliberately reachable while the account is DISABLED by its own pending
 * deletion — that is the whole point. A user who requested deletion and
 * changed their mind can sign in, see exactly which gardens go with them and
 * by when, and act. Every other endpoint refuses them.
 */

import type { AccountDeletion } from '@verdery/api-contracts';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { GardenRepository, MembershipRepository } from '../../gardens-mapping/public.js';
import type { ProfileRepository } from '../../identity-access/public.js';
import { toAccountDeletionResource } from './account-deletion-view.js';
import type { AccountDeletionGardenInput } from './account-deletion-view.js';
import { accountDeletionNotFoundError } from './deletion-errors.js';

export class GetAccountDeletion {
  constructor(
    private readonly profiles: ProfileRepository,
    private readonly memberships: MembershipRepository,
    private readonly gardens: GardenRepository,
  ) {}

  async execute(profileId: Uuid): Promise<AccountDeletion> {
    const profile = await this.profiles.findById(profileId);

    if (
      profile === null ||
      profile.recoveryDeadlineAt === null ||
      profile.deletionRequestedAt === null
    ) {
      throw accountDeletionNotFoundError();
    }

    const memberships = await this.memberships.listDetailsForProfile(profileId);
    const gardens: AccountDeletionGardenInput[] = [];

    for (const membership of memberships) {
      gardens.push({ membership, garden: await this.gardens.findById(membership.gardenId) });
    }

    return toAccountDeletionResource(
      profile,
      profile.deletionRequestedAt,
      profile.recoveryDeadlineAt,
      gardens,
    );
  }
}
