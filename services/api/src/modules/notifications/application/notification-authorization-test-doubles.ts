/**
 * Garden-authorization test doubles for the notifications module's unit
 * tests (P7-NOTIF-01), split out of `notification-test-doubles.ts` for the
 * repository's 600-line rule when P8-DELETE-01 widened
 * `MembershipRepository`.
 *
 * A real seam, not an arbitrary cut: everything here is about GARDEN access,
 * the one concern in that file that was never about notifications.
 * `GardenAuthorization` is a concrete class with a private field, so a
 * hand-rolled substitute is not structurally assignable — a real instance
 * over a fake repository is the construction every sibling module uses.
 */

import { GardenAuthorization } from '../../gardens-mapping/public.js';
import type {
  GardenLifecycleState,
  GardenRole,
  MembershipRepository,
} from '../../gardens-mapping/public.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';

export interface FakeMembership {
  readonly id: string;
  readonly gardenId: Uuid;
  readonly profileId: Uuid;
  readonly role: GardenRole;
}

class FakeMembershipRepository implements MembershipRepository {
  constructor(
    private readonly membership: FakeMembership | null,
    private readonly gardenLifecycleState: GardenLifecycleState = 'active',
  ) {}

  findGardenAccess(): ReturnType<MembershipRepository['findGardenAccess']> {
    return Promise.resolve(
      this.membership === null
        ? null
        : { membership: this.membership, gardenLifecycleState: this.gardenLifecycleState },
    );
  }

  insertOwner(): Promise<void> {
    throw new Error('not used by this test');
  }

  listMembershipsForProfile(): ReturnType<MembershipRepository['listMembershipsForProfile']> {
    throw new Error('not used by this test');
  }

  listForGarden(): ReturnType<MembershipRepository['listForGarden']> {
    throw new Error('not used by this test');
  }

  listDetailsForProfile(): ReturnType<MembershipRepository['listDetailsForProfile']> {
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

/** A real `GardenAuthorization` over a fake membership — the sibling modules' own construction. */
export function authorizationGranting(
  membership: FakeMembership,
  gardenLifecycleState: GardenLifecycleState = 'active',
): GardenAuthorization {
  return new GardenAuthorization(new FakeMembershipRepository(membership, gardenLifecycleState));
}

export function authorizationDenying(): GardenAuthorization {
  return new GardenAuthorization(new FakeMembershipRepository(null));
}
