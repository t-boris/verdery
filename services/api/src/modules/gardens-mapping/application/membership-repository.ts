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
  /** When this membership row was first granted — added for `GardenMember.createdAt` (P9A-API-01); untouched by a later role change. */
  readonly createdAt: Date;
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
/**
 * One continuous stretch of one person's access to one garden at one role —
 * the application-layer shape of `collaboration.membership_period`
 * (P9A-DATA-01). `validUntil`/`endedReason` are `null` together exactly
 * while the period is open (`membership_period_closure_check`).
 */
export interface MembershipPeriodInput {
  readonly id: Uuid;
  readonly membershipId: Uuid;
  readonly gardenId: Uuid;
  readonly profileId: Uuid;
  readonly role: GardenRole;
  readonly validFrom: Date;
}

export type MembershipPeriodEndedReason = 'removed' | 'role_changed';

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

  /** Grants the owner role at garden creation. Every garden has exactly one owner at creation. Thin wrapper over `insert` — kept as its own method because "who may create the very first membership" is a distinct, narrower question than "insert a membership row". */
  insertOwner(id: Uuid, gardenId: Uuid, profileId: Uuid, now: Date): Promise<void>;

  /** Grants `role` — any of the three — the general form `insertOwner` wraps. Added for `AcceptInvitation` (P9A-API-01), which grants whatever role the invitation named (`editor` or `viewer`, never `owner`). */
  insert(id: Uuid, gardenId: Uuid, profileId: Uuid, role: GardenRole, now: Date): Promise<void>;

  /** The ACTIVE membership at this (garden, profile) pair, or `null` — the natural-key lookup `ChangeMemberRole`/`RemoveMember` resolve their target through, distinct from `findGardenAccess` in that it never joins the garden row (the target need not be the caller, and its own lifecycle state is irrelevant to who is a member). */
  findActiveByGardenAndProfile(gardenId: Uuid, profileId: Uuid): Promise<MembershipDetail | null>;

  /** Every ACTIVE membership on one garden — the roster `ListGardenMembers` (P9A-API-01) reads, narrower than `listForGarden`'s any-state result the deletion workflows need. */
  listActiveForGarden(gardenId: Uuid): Promise<MembershipDetail[]>;

  /**
   * Locks, and returns the ids of, every ACTIVE owner on `gardenId` — the
   * exact recipe the P9A-DATA-01 migration's own comment prescribes for any
   * command that removes or demotes an owner:
   * `SELECT id FROM collaboration.membership WHERE garden_id = $1 AND
   * role = 'owner' AND state = 'active' ORDER BY id FOR UPDATE`. Must be
   * called, and its result inspected, BEFORE the same transaction writes
   * anything — see `RemoveMember` for why `ChangeMemberRole` does not need
   * this at all.
   */
  lockActiveOwnerIds(gardenId: Uuid): Promise<readonly Uuid[]>;

  /** Row-locks one membership by id (`SELECT ... FOR UPDATE`) and re-reads it, so a role-change or removal cannot act on a snapshot a concurrent writer has since moved past. `null` if the row no longer exists (never happens today — memberships are never hard-deleted outside `ON DELETE CASCADE` from a purge). */
  lockMembership(membershipId: Uuid): Promise<MembershipDetail | null>;

  /** Moves an ACTIVE membership to a new role, stamping `updated_at`. Callers are responsible for the surrounding period close/open — see `openPeriod`/`closeOpenPeriod`. */
  changeRole(membershipId: Uuid, role: GardenRole, now: Date): Promise<void>;

  /** Opens a new `collaboration.membership_period` row — one INSERT, called at grant time and at every role change. */
  openPeriod(input: MembershipPeriodInput): Promise<void>;

  /** Closes the currently OPEN period for `membershipId` (`membership_period_open_key` guarantees there is at most one). A no-op if none is open — never true for a membership this module created, since every grant opens one, but kept total rather than assuming. */
  closeOpenPeriod(
    membershipId: Uuid,
    validUntil: Date,
    endedReason: MembershipPeriodEndedReason,
  ): Promise<void>;

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
