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
import type { GardenAssignmentAccessSource } from './garden-assignment-access-source.js';
import { GardenAuthorization } from './garden-authorization.js';
import type { GardenAccess, Membership, MembershipRepository } from './membership-repository.js';

const GARDEN_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0c';
const OTHER_GARDEN_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0d';
const PROFILE_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0b';
const ASSIGNMENT_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0e';

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

/** A fake `GardenAssignmentAccessSource` scoped to exactly one (garden, profile) pair, mirroring `FakeMembershipRepository`'s own single-fixture shape. */
class FakeGardenAssignmentAccessSource implements GardenAssignmentAccessSource {
  constructor(
    private readonly gardenId: string,
    private readonly profileId: string,
    private readonly role: GardenRole | null,
    private readonly gardenLifecycleState: GardenLifecycleState = 'active',
  ) {}

  findActiveAssignment(
    gardenId: string,
    profileId: string,
  ): ReturnType<GardenAssignmentAccessSource['findActiveAssignment']> {
    if (this.role === null || gardenId !== this.gardenId || profileId !== this.profileId) {
      return Promise.resolve(null);
    }
    return Promise.resolve({
      assignmentId: ASSIGNMENT_ID,
      role: this.role,
      gardenLifecycleState: this.gardenLifecycleState,
    });
  }
}

function membershipWithRole(role: GardenRole): Membership {
  return { id: 'membership-1', gardenId: GARDEN_ID, profileId: PROFILE_ID, role };
}

function assignmentWithRole(role: GardenRole): Membership {
  return { id: ASSIGNMENT_ID, gardenId: GARDEN_ID, profileId: PROFILE_ID, role };
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
 * The assignment-sourced fallback (P9B-API-02 fix): membership finds
 * nothing, so `GardenAssignmentAccessSource` gets a say. Mirrors the ordinary
 * three-question evaluation exactly — these tests exist to prove the
 * fallback plugs into the SAME evaluation, not a parallel one.
 */
describe('GardenAuthorization assignment-sourced fallback', () => {
  it('grants viewGarden through an active assignment when no membership exists', async () => {
    const authorization = new GardenAuthorization(
      new FakeMembershipRepository(null),
      new FakeGardenAssignmentAccessSource(GARDEN_ID, PROFILE_ID, 'viewer'),
    );

    await expect(
      authorization.requireCapability(GARDEN_ID, PROFILE_ID, 'viewGarden'),
    ).resolves.toEqual(assignmentWithRole('viewer'));
  });

  it('grants editGardenContent through an editor assignment', async () => {
    const authorization = new GardenAuthorization(
      new FakeMembershipRepository(null),
      new FakeGardenAssignmentAccessSource(GARDEN_ID, PROFILE_ID, 'editor'),
    );

    await expect(
      authorization.requireCapability(GARDEN_ID, PROFILE_ID, 'editGardenContent'),
    ).resolves.toEqual(assignmentWithRole('editor'));
  });

  it('refuses editGardenContent for a viewer-role assignment (forbidden, same as ordinary viewer membership)', async () => {
    const authorization = new GardenAuthorization(
      new FakeMembershipRepository(null),
      new FakeGardenAssignmentAccessSource(GARDEN_ID, PROFILE_ID, 'viewer'),
    );

    await expect(
      authorization.requireCapability(GARDEN_ID, PROFILE_ID, 'editGardenContent'),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it.each<GardenCapability>(['manageGarden', 'exportGarden', 'administerOwnership'])(
    'never grants %s through an assignment, regardless of its role (owner-only, and garden_assignment.role excludes owner)',
    async (capability) => {
      const editorAssignment = new GardenAuthorization(
        new FakeMembershipRepository(null),
        new FakeGardenAssignmentAccessSource(GARDEN_ID, PROFILE_ID, 'editor'),
      );
      const viewerAssignment = new GardenAuthorization(
        new FakeMembershipRepository(null),
        new FakeGardenAssignmentAccessSource(GARDEN_ID, PROFILE_ID, 'viewer'),
      );

      await expect(
        editorAssignment.requireCapability(GARDEN_ID, PROFILE_ID, capability),
      ).rejects.toBeInstanceOf(ForbiddenError);
      await expect(
        viewerAssignment.requireCapability(GARDEN_ID, PROFILE_ID, capability),
      ).rejects.toBeInstanceOf(ForbiddenError);
    },
  );

  it('conceals existence as notFound when neither membership nor an assignment exists', async () => {
    const authorization = new GardenAuthorization(
      new FakeMembershipRepository(null),
      new FakeGardenAssignmentAccessSource(GARDEN_ID, PROFILE_ID, null),
    );

    await expect(
      authorization.requireCapability(GARDEN_ID, PROFILE_ID, 'viewGarden'),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('an assignment on a DIFFERENT garden grants nothing on the garden actually being asked about', async () => {
    const authorization = new GardenAuthorization(
      new FakeMembershipRepository(null),
      new FakeGardenAssignmentAccessSource(OTHER_GARDEN_ID, PROFILE_ID, 'editor'),
    );

    await expect(
      authorization.requireCapability(GARDEN_ID, PROFILE_ID, 'viewGarden'),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('ordinary membership is tried first and wins when both a membership and an assignment exist', async () => {
    const authorization = new GardenAuthorization(
      new FakeMembershipRepository(membershipWithRole('viewer')),
      new FakeGardenAssignmentAccessSource(GARDEN_ID, PROFILE_ID, 'editor'),
    );

    await expect(
      authorization.requireCapability(GARDEN_ID, PROFILE_ID, 'viewGarden'),
    ).resolves.toEqual(membershipWithRole('viewer'));
  });

  it('falls back to no access at all when no assignment source is configured (the pre-fix default)', async () => {
    const authorization = new GardenAuthorization(new FakeMembershipRepository(null));

    await expect(
      authorization.requireCapability(GARDEN_ID, PROFILE_ID, 'viewGarden'),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('respects the SAME lifecycle-state matrix for an assignment-sourced grant: editGardenContent refused while the garden is deletion_requested', async () => {
    const authorization = new GardenAuthorization(
      new FakeMembershipRepository(null),
      new FakeGardenAssignmentAccessSource(GARDEN_ID, PROFILE_ID, 'editor', 'deletion_requested'),
    );

    await expect(
      authorization.requireCapability(GARDEN_ID, PROFILE_ID, 'editGardenContent'),
    ).rejects.toBeInstanceOf(DomainRuleViolatedError);
    // viewGarden survives every lifecycle state, assignment-sourced or not.
    await expect(
      authorization.requireCapability(GARDEN_ID, PROFILE_ID, 'viewGarden'),
    ).resolves.toEqual(assignmentWithRole('editor'));
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
