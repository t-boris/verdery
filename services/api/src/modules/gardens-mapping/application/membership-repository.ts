import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { GardenLifecycleState } from '../domain/garden.js';
import type { GardenRole } from '../domain/garden-role.js';

export interface Membership {
  readonly id: Uuid;
  readonly gardenId: Uuid;
  readonly profileId: Uuid;
  readonly role: GardenRole;
}

/**
 * Everything `GardenAuthorization` needs to answer one request: the caller's
 * active membership AND the garden's own lifecycle state.
 *
 * The two travel together because authorization decides on both — the role
 * says whether the caller may ask, the lifecycle state says whether the garden
 * is in a state to be asked (see `garden-role.ts`'s second matrix). Reading
 * them in one query rather than two is not only cheaper: it removes the window
 * in which a garden could enter `deletion_requested` between the membership
 * read and the lifecycle read, which is precisely the window this guard exists
 * to close.
 */
export interface GardenAccess {
  readonly membership: Membership;
  readonly gardenLifecycleState: GardenLifecycleState;
}

/**
 * `collaboration.membership.state` as this codebase's own migration already
 * constrains it (`membership_state_check CHECK (state IN ('active',
 * 'removed'))`). `'removed'` was schema-anticipated with zero producers until
 * P8-DELETE-01: garden deletion revokes non-owner members at request time,
 * restore reactivates them, and the purge revokes whoever remains. A
 * `'removed'` row is the offline-synchronization revocation tombstone and
 * deliberately OUTLIVES the purged garden it names — see the deletion
 * baseline migration for why the garden foreign key had to go.
 */
export type GardenMembershipState = 'active' | 'removed';

export interface GardenPartitionMembership {
  readonly gardenId: Uuid;
  readonly state: GardenMembershipState;
}

/** A membership row with everything the deletion workflows decide on: who, which role, which state, and when the state last moved. */
export interface MembershipDetail {
  readonly id: Uuid;
  readonly gardenId: Uuid;
  readonly profileId: Uuid;
  readonly role: GardenRole;
  readonly state: GardenMembershipState;
  readonly updatedAt: Date;
}

/**
 * Membership persistence for Phase 2. The Collaboration module owns
 * `collaboration.membership` per architecture/data-and-geospatial-design.md,
 * section "3. Schema Ownership", but no Collaboration module exists yet —
 * membership today is entirely a side effect of garden creation, with no
 * invite/accept flow to justify standing up a separate module (P2-BE-01
 * names only identity-access and gardens-mapping). This repository lives
 * here as a deliberate, temporary consolidation, revisited when invitations
 * ship and a real Collaboration module has its own write path to this table.
 */
export interface MembershipRepository {
  /**
   * The caller's ACTIVE membership on an EXISTING garden, with that garden's
   * lifecycle state. `null` means "no access to speak of" and covers both
   * halves deliberately: no active membership, or no garden row left at all
   * (a purge removes the garden but leaves the `removed` membership tombstone
   * behind — see `GardenMembershipState`). Both must look identical to a
   * caller, which is exactly what `GardenAuthorization` conceals as
   * `notFound`.
   */
  findGardenAccess(gardenId: Uuid, profileId: Uuid): Promise<GardenAccess | null>;

  /** Grants the owner role at garden creation. Every garden has exactly one owner at creation. */
  insertOwner(id: Uuid, gardenId: Uuid, profileId: Uuid, now: Date): Promise<void>;

  /**
   * Every membership row this profile has, in any state — added for
   * `GetSyncChanges` (P5-BE-02), which needs both "gardens visible for
   * ordinary upserts" (`state === 'active'`) and "gardens whose only
   * remaining visibility is their own revocation tombstone"
   * (`state !== 'active'`) from a single read. Not narrowed to active-only
   * like `findGardenAccess`, deliberately: a profile whose membership was
   * removed still needs to learn that fact from its next pull.
   */
  listMembershipsForProfile(profileId: Uuid): Promise<GardenPartitionMembership[]>;

  /**
   * Every membership row on one garden, in any state (P8-DELETE-01). The
   * deletion workflows need the whole set, not just the active part: request
   * time decides who to revoke from the active rows, restore decides who to
   * reactivate from the removed ones, and the purge needs to know that
   * nobody is left active.
   */
  listForGarden(gardenId: Uuid): Promise<MembershipDetail[]>;

  /** Every membership row this profile has, with role and state — the ownership-resolution input for account deletion (P8-DELETE-01). */
  listDetailsForProfile(profileId: Uuid): Promise<MembershipDetail[]>;

  /** Moves one membership row between `active` and `removed`, stamping `updated_at` — which is what later tells a restore which rows a given deletion request revoked. */
  setState(membershipId: Uuid, state: GardenMembershipState, now: Date): Promise<void>;
}
