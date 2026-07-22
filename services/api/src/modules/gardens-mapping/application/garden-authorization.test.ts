import { describe, expect, it } from 'vitest';
import { ForbiddenError, NotFoundError } from '../../../platform/errors/application-error.js';
import type { GardenRole } from '../domain/garden-role.js';
import { GardenAuthorization } from './garden-authorization.js';
import type { Membership, MembershipRepository } from './membership-repository.js';

const GARDEN_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0c';
const PROFILE_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0b';

class FakeMembershipRepository implements MembershipRepository {
  constructor(private readonly membership: Membership | null) {}

  findActiveMembership(): Promise<Membership | null> {
    return Promise.resolve(this.membership);
  }

  insertOwner(): Promise<void> {
    throw new Error('not used by this test');
  }
}

function membershipWithRole(role: GardenRole): Membership {
  return { id: 'membership-1', gardenId: GARDEN_ID, profileId: PROFILE_ID, role };
}

describe('GardenAuthorization', () => {
  it('conceals existence as notFound when the profile has no membership at all', async () => {
    const authorization = new GardenAuthorization(new FakeMembershipRepository(null));

    await expect(
      authorization.requireCapability(GARDEN_ID, PROFILE_ID, 'viewGarden'),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('returns forbidden, not notFound, for a member lacking the required capability', async () => {
    const authorization = new GardenAuthorization(
      new FakeMembershipRepository(membershipWithRole('viewer')),
    );

    await expect(
      authorization.requireCapability(GARDEN_ID, PROFILE_ID, 'manageGarden'),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('returns the membership when the role has the required capability', async () => {
    const membership = membershipWithRole('editor');
    const authorization = new GardenAuthorization(new FakeMembershipRepository(membership));

    await expect(
      authorization.requireCapability(GARDEN_ID, PROFILE_ID, 'editGardenContent'),
    ).resolves.toEqual(membership);
  });

  it.each<[GardenRole, boolean]>([
    ['owner', true],
    ['editor', false],
    ['viewer', false],
  ])('manageGarden: %s allowed=%s', async (role, allowed) => {
    const authorization = new GardenAuthorization(
      new FakeMembershipRepository(membershipWithRole(role)),
    );
    const attempt = authorization.requireCapability(GARDEN_ID, PROFILE_ID, 'manageGarden');

    if (allowed) {
      await expect(attempt).resolves.toBeDefined();
    } else {
      await expect(attempt).rejects.toBeInstanceOf(ForbiddenError);
    }
  });
});
