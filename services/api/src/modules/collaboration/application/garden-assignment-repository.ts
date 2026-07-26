import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { GardenRole } from '../../gardens-mapping/public.js';
import type { GardenAssignmentState } from '../domain/garden-assignment-state.js';

/**
 * `collaboration.garden_assignment.role` reuses `gardens-mapping`'s own
 * `GardenRole` vocabulary narrowed to the two values the migration's
 * `garden_assignment_role_check` admits — see the migration's own
 * "ROLE-SHAPED ASSIGNMENT, NOT A NEW VOCABULARY" comment: a professional
 * works a client's garden, they do not own it, so `'owner'` is excluded at
 * the type level here exactly as `garden_assignment_role_check` excludes it
 * in the database. Reusing `GardenRole` by reference (not re-declaring a
 * parallel `'editor' | 'viewer'` union from scratch) is what keeps this type
 * and the garden-role capability vocabulary from drifting apart.
 */
export type GardenAssignmentRole = Extract<GardenRole, 'editor' | 'viewer'>;

export interface GardenAssignmentInsertInput {
  readonly id: Uuid;
  readonly organizationId: Uuid;
  readonly profileId: Uuid;
  readonly gardenId: Uuid;
  readonly role: GardenAssignmentRole;
  readonly createdByProfileId: Uuid;
  readonly now: Date;
}

/**
 * Mirrors `collaboration.garden_assignment` exactly, including its
 * append-only "one row per stint" shape — see the migration's own "WHY
 * `garden_assignment` GETS NO SEPARATE PERIOD TABLE" comment. `validUntil`
 * and `state` are `null`/`'active'` together exactly while the assignment is
 * open (`garden_assignment_closure_check`).
 */
export interface GardenAssignmentDetail {
  readonly id: Uuid;
  readonly organizationId: Uuid;
  readonly profileId: Uuid;
  readonly gardenId: Uuid;
  readonly role: GardenAssignmentRole;
  readonly state: GardenAssignmentState;
  readonly validFrom: Date;
  readonly validUntil: Date | null;
  readonly createdByProfileId: Uuid;
  readonly createdAt: Date;
}

export interface GardenAssignmentRepository {
  /** Inserts a brand-new, ACTIVE assignment row. Throws a unique-violation on `garden_assignment_active_key` if the (garden, profile) pair already holds one — see `CreateGardenAssignment`'s own pre-check-plus-catch handling. */
  insert(input: GardenAssignmentInsertInput): Promise<void>;

  /** The current ACTIVE assignment for (garden, profile), across ANY organization — the pre-check `CreateGardenAssignment` runs before attempting an insert that would otherwise race `garden_assignment_active_key`. */
  findActiveByGardenAndProfile(
    gardenId: Uuid,
    profileId: Uuid,
  ): Promise<GardenAssignmentDetail | null>;

  /** One assignment by id, scoped to `organizationId` — a caller must not learn that an assignment id exists under a DIFFERENT organization than the one they administer (the same cross-tenant concealment `InvitationRepository.findByIdAndGarden` already provides for gardens). */
  findByIdAndOrganization(id: Uuid, organizationId: Uuid): Promise<GardenAssignmentDetail | null>;

  /** Row-locks one assignment by id and re-reads it — the same "decide under lock, not from a stale snapshot" guard `MembershipRepository.lockMembership` provides, run immediately before `End`/`RevokeGardenAssignment` decide anything. No revision column exists on this table to guard against instead (see those commands' own header comments for why the row lock alone is sufficient). */
  lockById(id: Uuid): Promise<GardenAssignmentDetail | null>;

  /** Closes an assignment: writes `state` and `validUntil` together, matching `garden_assignment_closure_check`'s own pairing. `state` must be `'ended'` or `'revoked'` — never `'active'`, which only `insert` produces. */
  transitionState(id: Uuid, state: 'ended' | 'revoked', validUntil: Date): Promise<void>;

  /** Every ACTIVE assignment an organization currently holds, across every garden — "which gardens can this organization's members reach." */
  listActiveForOrganization(organizationId: Uuid): Promise<GardenAssignmentDetail[]>;

  /** Every ACTIVE assignment on one garden, across every organization — "who from which organization can work on this garden." */
  listActiveForGarden(gardenId: Uuid): Promise<GardenAssignmentDetail[]>;
}
