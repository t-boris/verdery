/**
 * Capability evaluation for garden access.
 *
 * A profile with no membership on the garden and a profile whose membership
 * lacks the required capability both fail, but must not look the same to an
 * attacker probing for which garden IDs exist: the former conceals existence
 * as `notFound`, the latter is a `forbidden` a member already knows applies
 * to a garden they know exists.
 *
 * THREE questions, in this order, because each one presupposes the answer to
 * the previous (identity-and-authorization.md section 9, steps 4, 5 and 7):
 *
 * 1. Does the caller have access at all? -> `notFound`, concealing existence.
 * 2. Does their role carry the capability? -> `forbidden`.
 * 3. Is the garden in a lifecycle state where that capability applies?
 *    -> `garden.lifecycle_conflict` (HTTP 422).
 *
 * Step 3 is the ONE enforcement point for "a garden pending deletion refuses
 * content writes" (data-export-and-deletion.md section 10.3). It lives here,
 * not in each command, because every garden-scoped command in every module —
 * gardens-mapping, plants-inventory, observations-history,
 * tasks-recommendations, media, exports, notifications — already funnels
 * through this method, and a rule enforced once here holds for commands that
 * have not been written yet. Which capability survives which lifecycle state
 * is decided in `domain/garden-role.ts`, not here.
 *
 * The garden's lifecycle state is NOT re-read separately: it arrives with the
 * membership from one query, so it is the state as of the same instant the
 * membership was true.
 *
 * ## Step 1 has TWO independent sources, not one (P9B-API-02 fix)
 *
 * ADR-0012: "Organization membership alone grants no garden access. A
 * professional must also have an active garden assignment OR operational
 * garden membership" — an ALTERNATE, equally-real path, not a lesser one.
 * `findGardenAccess` (ordinary `collaboration.membership`) is tried first;
 * only when it finds nothing does `assignments` (`collaboration
 * .garden_assignment`, via `GardenAssignmentAccessSource` — see that port's
 * own header for why this is a second port rather than a change to
 * `findGardenAccess` itself) get consulted. Whichever source answers, the
 * SAME three-step evaluation below runs unchanged: an assignment-sourced
 * grant is subject to the identical role -> capability and
 * capability -> lifecycle-state matrices ordinary membership already is,
 * never a bypass of either. Since `garden_assignment.role` is schema-limited
 * to `editor`/`viewer` (`garden_assignment_role_check` — a professional works
 * a client's garden, they do not own it), `roleHasCapability` already
 * guarantees an assignment can never carry `manageGarden`/`exportGarden`/
 * `administerOwnership` — no separate check is needed for that.
 *
 * `assignments` is optional: every module OTHER than gardens-mapping's own
 * composition constructs no `GardenAuthorization` of its own (they all reuse
 * the single shared instance `compose-gardens-mapping.ts` builds — see that
 * file's own header), and most unit-test fakes across this codebase have no
 * reason to know about garden assignments at all. `null` here means
 * literally "no second source configured", not "assignments never grant
 * access" — the one production composition root always supplies the real
 * adapter.
 *
 * Source: architecture/identity-and-authorization.md, section
 * "9. Authorization Evaluation"; implementation-plan.md work package P2-SEC-01;
 * ADR-0012-separate-team-and-client-sharing.md.
 */

import { GardenErrorCode, SharedErrorCode } from '@verdery/api-contracts';
import {
  DomainRuleViolatedError,
  ForbiddenError,
  NotFoundError,
} from '../../../platform/errors/application-error.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { GardenCapability } from '../domain/garden-role.js';
import { capabilityAllowedInLifecycleState, roleHasCapability } from '../domain/garden-role.js';
import type { GardenAssignmentAccessSource } from './garden-assignment-access-source.js';
import type { GardenAccess, Membership, MembershipRepository } from './membership-repository.js';

export class GardenAuthorization {
  constructor(
    private readonly memberships: MembershipRepository,
    private readonly assignments: GardenAssignmentAccessSource | null = null,
  ) {}

  /** Returns the caller's membership, or throws `notFound`/`forbidden`/`lifecycleConflict` per the rules above. */
  async requireCapability(
    gardenId: Uuid,
    profileId: Uuid,
    capability: GardenCapability,
  ): Promise<Membership> {
    const access = await this.resolveAccess(gardenId, profileId);

    if (access === null) {
      throw new NotFoundError(GardenErrorCode.NotFound, 'Garden not found.');
    }

    if (!roleHasCapability(access.membership.role, capability)) {
      throw new ForbiddenError(
        SharedErrorCode.Forbidden,
        'You do not have permission to perform this action on this garden.',
      );
    }

    if (!capabilityAllowedInLifecycleState(capability, access.gardenLifecycleState)) {
      // `domainRuleViolated` -> HTTP 422, the same status and the same
      // `garden.lifecycle_conflict` code the domain's own lifecycle refusals
      // already use, so a client needs no second failure mode to understand.
      // On the offline path this becomes a per-operation `rejected` push
      // outcome (`execute-and-map-outcome.ts`), which clients treat as
      // terminal — a queued edit into a garden since marked for deletion is
      // dropped, never retried forever.
      throw new DomainRuleViolatedError(
        GardenErrorCode.LifecycleConflict,
        'This action is not available for a garden pending deletion.',
      );
    }

    return access.membership;
  }

  /**
   * Ordinary membership first; only when it finds nothing does an active
   * garden assignment get a say — see this file's header, "Step 1 has TWO
   * independent sources". Returns the same `GardenAccess` shape either way,
   * so every step after this call is source-agnostic.
   */
  private async resolveAccess(gardenId: Uuid, profileId: Uuid): Promise<GardenAccess | null> {
    const membershipAccess = await this.memberships.findGardenAccess(gardenId, profileId);
    if (membershipAccess !== null) {
      return membershipAccess;
    }

    if (this.assignments === null) {
      return null;
    }

    const assignmentAccess = await this.assignments.findActiveAssignment(gardenId, profileId);
    if (assignmentAccess === null) {
      return null;
    }

    return {
      membership: {
        id: assignmentAccess.assignmentId,
        gardenId,
        profileId,
        role: assignmentAccess.role,
      },
      gardenLifecycleState: assignmentAccess.gardenLifecycleState,
    };
  }
}
