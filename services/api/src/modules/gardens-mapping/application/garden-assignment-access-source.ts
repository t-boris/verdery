import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { GardenLifecycleState } from '../domain/garden.js';
import type { GardenRole } from '../domain/garden-role.js';

/**
 * The second, ALTERNATE resolution path `GardenAuthorization.requireCapability`
 * consults when ordinary `collaboration.membership` grants no access —
 * ADR-0012-separate-team-and-client-sharing.md's own invariant: "A
 * professional must also have an active garden assignment OR operational
 * garden membership." Before this port existed, `garden_assignment` rows
 * were pure bookkeeping with zero behavioral effect: nothing this module
 * read ever joined against `collaboration.garden_assignment`, so an
 * organization admin could assign a professional to a garden and that
 * professional would still be refused every content command exactly like a
 * stranger (proven, until this fix, by
 * `collaboration-organization-garden-denial-matrix.test.ts`'s own test 1).
 *
 * WHY THIS IS A SEPARATE PORT, NOT A CHANGE TO
 * `MembershipRepository.findGardenAccess`: `collaboration.garden_assignment`
 * is owned by the real `collaboration` TypeScript module P9B-DATA-01 stood
 * up (its own repository, `GardenAssignmentRepository`/
 * `KyselyGardenAssignmentRepository`), unlike `collaboration.membership`,
 * which `membership-repository.ts`'s own header documents as a *temporary*
 * consolidation gardens-mapping still owns pending a real Collaboration
 * module write path. Reaching into `collaboration.garden_assignment` from
 * inside `KyselyMembershipRepository` would mean `gardens-mapping` importing
 * behavior that already has a real, independent home elsewhere — exactly
 * the private-persistence crossing
 * `docs/architecture/backend-modular-monolith.md` section "5.3 Persistence"
 * rules out ("A module may not import another module's private persistence
 * implementation"). A second, gardens-mapping-owned port is the same
 * "narrow read port" shape this codebase already established for exactly
 * this situation — see `notifications/application/garden-recipient-source.ts`
 * and `tasks-recommendations/persistence/kysely-evaluation-garden-source.ts`
 * ("`KyselyEvaluationGardenSource`"), both of which read another module's
 * schema-owned table through a dedicated port and a narrow, read-only Kysely
 * adapter rather than importing that module's own repository class. The
 * adapter (`KyselyGardenAssignmentAccessSource`) follows the identical
 * shape.
 *
 * The composition root (`compose-gardens-mapping.ts`) wires the real
 * adapter into the ONE shared `GardenAuthorization` instance every module —
 * map, plants, tasks, observations, media, sync, collaboration itself —
 * already funnels through, so this fix holds everywhere at once, the same
 * "enforced once here" property `garden-authorization.ts`'s own header
 * already claims for the lifecycle-state check.
 */
export interface GardenAssignmentAccess {
  /**
   * The `collaboration.garden_assignment.id` this grant came from — used as
   * `Membership.id` for an assignment-sourced grant (see
   * `garden-authorization.ts`). Deliberately a REAL, stable identifier
   * pointing at the actual assignment row, not a fabricated one: nothing
   * downstream reads a provenance-distinguishing field today (checked
   * exhaustively before this fix — every `requireCapability` caller reads
   * only `.role`, or feeds `.id` into `MembershipRepository.lockMembership`/
   * `setState`, both of which only ever run on paths gated by
   * `administerOwnership`/`manageGarden`, capabilities an assignment can
   * never carry since `garden_assignment.role` is schema-constrained to
   * `editor`/`viewer`), so adding a distinguishing field to `Membership`
   * would be exactly the kind of unrequested machinery this codebase's own
   * migration comments repeatedly warn against. Using the assignment's own
   * id instead of a synthetic one keeps real provenance available the
   * moment something DOES need it, without adding a field nothing reads yet.
   */
  readonly assignmentId: Uuid;
  /** `editor` or `viewer` only — `garden_assignment_role_check` forbids `owner` at the database level, so this is never `'owner'` in practice. Typed as the wider `GardenRole` only so `roleHasCapability`/`Membership.role` need no separate narrower type. */
  readonly role: GardenRole;
  /**
   * Read from the SAME query as `role`, joined to `gardens_mapping.garden` —
   * mirrors `GardenAccess.gardenLifecycleState`'s own "read together, at one
   * instant" reasoning (`membership-repository.ts`), so an assignment-sourced
   * grant is subject to the identical capability -> lifecycle-state matrix
   * ordinary membership already is, never a bypass of it.
   */
  readonly gardenLifecycleState: GardenLifecycleState;
}

export interface GardenAssignmentAccessSource {
  /**
   * The caller's currently ACTIVE `collaboration.garden_assignment` for this
   * exact (garden, profile) pair, or `null` — mirrors
   * `MembershipRepository.findGardenAccess`'s own "active access on an
   * existing garden, or nothing to speak of" contract. `null` covers both an
   * absent assignment and one whose named garden no longer exists (the
   * adapter's own inner join to `gardens_mapping.garden` handles the latter,
   * the same way `findGardenAccess`'s inner join already does for
   * membership).
   */
  findActiveAssignment(gardenId: Uuid, profileId: Uuid): Promise<GardenAssignmentAccess | null>;
}
