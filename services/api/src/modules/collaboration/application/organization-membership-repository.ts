import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { OrganizationRole } from '../domain/organization-role.js';

/** Mirrors `collaboration.organization_membership.state` — identical vocabulary to `collaboration.membership.state`, same reasoning: no third state exists. */
export type OrganizationMembershipState = 'active' | 'removed';

/** Mirrors `collaboration.organization_membership_period.ended_reason` — identical vocabulary to `MembershipPeriodEndedReason`. */
export type OrganizationMembershipPeriodEndedReason = 'removed' | 'role_changed';

export interface OrganizationMembership {
  readonly id: Uuid;
  readonly organizationId: Uuid;
  readonly profileId: Uuid;
  readonly role: OrganizationRole;
}

/** A membership row with everything the administration commands decide on. */
export interface OrganizationMembershipDetail extends OrganizationMembership {
  readonly state: OrganizationMembershipState;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface OrganizationMembershipPeriodInput {
  readonly id: Uuid;
  readonly membershipId: Uuid;
  readonly organizationId: Uuid;
  readonly profileId: Uuid;
  readonly role: OrganizationRole;
  readonly validFrom: Date;
}

/**
 * Persistence for `collaboration.organization_membership` and its append-only
 * `organization_membership_period` child — structurally identical to
 * `gardens-mapping`'s `MembershipRepository`, the same "current-state row
 * plus period history" shape the P9B-DATA-01 migration deliberately reused
 * rather than re-derived.
 */
export interface OrganizationMembershipRepository {
  /**
   * The caller's ACTIVE membership on `organizationId`. `null` conceals both
   * "no such organization" and "not a member" identically — the same
   * posture `MembershipRepository.findGardenAccess` documents for gardens: a
   * caller must not learn that an organization id exists if they cannot see
   * it.
   */
  findActiveByOrganizationAndProfile(
    organizationId: Uuid,
    profileId: Uuid,
  ): Promise<OrganizationMembershipDetail | null>;

  /**
   * ANY membership row (active OR removed) at this (organization, profile)
   * pair. `organization_membership_org_profile_key` is a UNIQUE constraint
   * forever, not partial on `state = 'active'` (the migration's own "one row
   * per (organization, profile) forever" comment) — this is the pre-check
   * `AddOrganizationMember` runs before an insert that would otherwise race
   * that constraint, mirroring the dual pre-check-plus-catch pattern
   * `CreateInvitation` already uses for its own pending-email race.
   */
  findByOrganizationAndProfile(
    organizationId: Uuid,
    profileId: Uuid,
  ): Promise<OrganizationMembershipDetail | null>;

  /** Grants `role` to a brand-new (organization, profile) pair. Throws a unique-violation if one already exists — see `findByOrganizationAndProfile`'s own comment for why this table can never reactivate a removed row by re-inserting. */
  insert(
    id: Uuid,
    organizationId: Uuid,
    profileId: Uuid,
    role: OrganizationRole,
    now: Date,
  ): Promise<void>;

  /** Every ACTIVE membership on one organization — the roster `ListOrganizationMembers` reads. */
  listActiveForOrganization(organizationId: Uuid): Promise<OrganizationMembershipDetail[]>;

  /**
   * Locks, and returns the ids of, every ACTIVE `organization_admin` on
   * `organizationId` — the exact recipe the P9B-DATA-01 migration's own
   * header prescribes for "a future organization-administration command,"
   * substituting `organization_id`/`role = 'organization_admin'` for
   * `garden_id`/`role = 'owner'` in `MembershipRepository.lockActiveOwnerIds`'s
   * own recipe. Must be called, and its result inspected, BEFORE the same
   * transaction writes anything that could shrink the active-admin set.
   */
  lockActiveAdminIds(organizationId: Uuid): Promise<readonly Uuid[]>;

  /** Row-locks one membership by id and re-reads it — the same "decide under lock, not from a stale snapshot" guard `MembershipRepository.lockMembership` provides for gardens. */
  lockMembership(membershipId: Uuid): Promise<OrganizationMembershipDetail | null>;

  /** Moves an ACTIVE membership to a new role, stamping `updated_at`. Callers are responsible for the surrounding period close/open. */
  changeRole(membershipId: Uuid, role: OrganizationRole, now: Date): Promise<void>;

  /** Moves one membership row between `active` and `removed`, stamping `updated_at`. */
  setState(membershipId: Uuid, state: OrganizationMembershipState, now: Date): Promise<void>;

  /** Opens a new `organization_membership_period` row. */
  openPeriod(input: OrganizationMembershipPeriodInput): Promise<void>;

  /** Closes the currently OPEN period for `membershipId` (`organization_membership_period_open_key` guarantees there is at most one). */
  closeOpenPeriod(
    membershipId: Uuid,
    validUntil: Date,
    endedReason: OrganizationMembershipPeriodEndedReason,
  ): Promise<void>;
}
