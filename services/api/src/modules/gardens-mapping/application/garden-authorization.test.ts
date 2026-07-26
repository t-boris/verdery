import { GardenErrorCode } from '@verdery/api-contracts';
import { describe, expect, it } from 'vitest';
import {
  DomainRuleViolatedError,
  ForbiddenError,
  NotFoundError,
} from '../../../platform/errors/application-error.js';
import type { GardenLifecycleState } from '../domain/garden.js';
import type { GardenCapability, GardenRole } from '../domain/garden-role.js';
import { GARDEN_CAPABILITIES } from '../domain/garden-role.js';
import { GardenAuthorization } from './garden-authorization.js';
import type { GardenAccess, Membership, MembershipRepository } from './membership-repository.js';

const GARDEN_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0c';
const PROFILE_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0b';

const EVERY_LIFECYCLE_STATE: readonly GardenLifecycleState[] = [
  'active',
  'archived',
  'deletion_requested',
  'purging',
];

class FakeMembershipRepository implements MembershipRepository {
  constructor(
    private readonly membership: Membership | null,
    private readonly gardenLifecycleState: GardenLifecycleState = 'active',
  ) {}

  findGardenAccess(): Promise<GardenAccess | null> {
    return Promise.resolve(
      this.membership === null
        ? null
        : { membership: this.membership, gardenLifecycleState: this.gardenLifecycleState },
    );
  }

  insertOwner(): Promise<void> {
    throw new Error('not used by this test');
  }

  listMembershipsForProfile(): Promise<never[]> {
    throw new Error('not used by this test');
  }

  listForGarden(): Promise<never[]> {
    throw new Error('not used by this test');
  }

  listDetailsForProfile(): Promise<never[]> {
    throw new Error('not used by this test');
  }

  setState(): Promise<void> {
    throw new Error('not used by this test');
  }

  insert(): Promise<void> {
    throw new Error('not used by this test');
  }

  findActiveByGardenAndProfile(): ReturnType<MembershipRepository['findActiveByGardenAndProfile']> {
    throw new Error('not used by this test');
  }

  listActiveForGarden(): ReturnType<MembershipRepository['listActiveForGarden']> {
    throw new Error('not used by this test');
  }

  lockActiveOwnerIds(): ReturnType<MembershipRepository['lockActiveOwnerIds']> {
    throw new Error('not used by this test');
  }

  lockMembership(): ReturnType<MembershipRepository['lockMembership']> {
    throw new Error('not used by this test');
  }

  changeRole(): Promise<void> {
    throw new Error('not used by this test');
  }

  openPeriod(): Promise<void> {
    throw new Error('not used by this test');
  }

  closeOpenPeriod(): Promise<void> {
    throw new Error('not used by this test');
  }
}

function membershipWithRole(role: GardenRole): Membership {
  return { id: 'membership-1', gardenId: GARDEN_ID, profileId: PROFILE_ID, role };
}

function authorizationFor(
  role: GardenRole | null,
  lifecycleState: GardenLifecycleState = 'active',
): GardenAuthorization {
  return new GardenAuthorization(
    new FakeMembershipRepository(role === null ? null : membershipWithRole(role), lifecycleState),
  );
}

describe('GardenAuthorization', () => {
  it('conceals existence as notFound when the profile has no membership at all', async () => {
    await expect(
      authorizationFor(null).requireCapability(GARDEN_ID, PROFILE_ID, 'viewGarden'),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('returns forbidden, not notFound, for a member lacking the required capability', async () => {
    await expect(
      authorizationFor('viewer').requireCapability(GARDEN_ID, PROFILE_ID, 'manageGarden'),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('returns the membership when the role has the required capability', async () => {
    await expect(
      authorizationFor('editor').requireCapability(GARDEN_ID, PROFILE_ID, 'editGardenContent'),
    ).resolves.toEqual(membershipWithRole('editor'));
  });

  it.each<[GardenRole, boolean]>([
    ['owner', true],
    ['editor', false],
    ['viewer', false],
  ])('manageGarden: %s allowed=%s', async (role, allowed) => {
    const attempt = authorizationFor(role).requireCapability(GARDEN_ID, PROFILE_ID, 'manageGarden');

    if (allowed) {
      await expect(attempt).resolves.toBeDefined();
    } else {
      await expect(attempt).rejects.toBeInstanceOf(ForbiddenError);
    }
  });
});

/**
 * The lifecycle half of the matrix, exhaustively.
 *
 * `EXPECTED_STATES` is keyed by `GardenCapability`, so a capability added for
 * a future command does not compile until this table says which lifecycle
 * states it survives — and the first test below fails if the production
 * matrix and this table ever disagree about which capabilities exist. That is
 * the point of enforcing the rule inside `requireCapability` rather than in
 * each command: "did the new command remember the guard?" stops being a
 * question anyone has to ask, and "did the new CAPABILITY get a decision?"
 * becomes a compile error plus a failing test.
 */
const EXPECTED_STATES: Readonly<Record<GardenCapability, readonly GardenLifecycleState[]>> = {
  viewGarden: ['active', 'archived', 'deletion_requested', 'purging'],
  editGardenContent: ['active', 'archived'],
  manageGarden: ['active', 'archived', 'deletion_requested', 'purging'],
  exportGarden: ['active', 'archived', 'deletion_requested'],
  administerOwnership: ['active', 'archived', 'deletion_requested', 'purging'],
};

describe('GardenAuthorization garden lifecycle', () => {
  it('decides every modeled capability, so a future capability cannot default to "allowed everywhere"', () => {
    expect([...GARDEN_CAPABILITIES].sort()).toEqual(Object.keys(EXPECTED_STATES).sort());
  });

  const cases = GARDEN_CAPABILITIES.flatMap((capability) =>
    EVERY_LIFECYCLE_STATE.map<[GardenCapability, GardenLifecycleState, boolean]>((state) => [
      capability,
      state,
      EXPECTED_STATES[capability].includes(state),
    ]),
  );

  it.each(cases)('%s in a %s garden: allowed=%s', async (capability, state, allowed) => {
    // Owner holds every capability, so the role check never decides here.
    const attempt = authorizationFor('owner', state).requireCapability(
      GARDEN_ID,
      PROFILE_ID,
      capability,
    );

    if (allowed) {
      await expect(attempt).resolves.toEqual(membershipWithRole('owner'));
      return;
    }

    await expect(attempt).rejects.toBeInstanceOf(DomainRuleViolatedError);
    await expect(attempt).rejects.toMatchObject({
      code: GardenErrorCode.LifecycleConflict,
      category: 'domainRuleViolated',
    });
  });

  it('refuses a content write before the role check has any say, for a garden being purged', async () => {
    await expect(
      authorizationFor('owner', 'purging').requireCapability(
        GARDEN_ID,
        PROFILE_ID,
        'editGardenContent',
      ),
    ).rejects.toBeInstanceOf(DomainRuleViolatedError);
  });

  it('keeps manageGarden reachable from deletion_requested, or restore could never run', async () => {
    await expect(
      authorizationFor('owner', 'deletion_requested').requireCapability(
        GARDEN_ID,
        PROFILE_ID,
        'manageGarden',
      ),
    ).resolves.toEqual(membershipWithRole('owner'));
  });

  it('still refuses a member whose role lacks the capability, ahead of any lifecycle verdict', async () => {
    await expect(
      authorizationFor('viewer', 'deletion_requested').requireCapability(
        GARDEN_ID,
        PROFILE_ID,
        'editGardenContent',
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
