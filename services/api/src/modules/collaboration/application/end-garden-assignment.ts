/**
 * Ends a garden assignment (P9B-API-01).
 *
 * `manageGardenAssignment`-only — no self-service ending by the assigned
 * professional. Unlike leaving a garden (`RemoveMember`'s own "self-removal
 * is not membership administration" posture, backed directly by
 * architecture/collaboration-and-client-sharing.md section 5), no document
 * in scope grants an assigned professional a unilateral right to end their
 * own assignment; the organization that created it administers its end too.
 *
 * NO REVISION GUARD, AND NONE IS NEEDED. `collaboration.garden_assignment`
 * carries no `revision` column at all (unlike `service_organization`/
 * `organization_membership`, which do) — see the P9B-DATA-01 migration's own
 * "WHY `garden_assignment` GETS NO SEPARATE PERIOD TABLE" comment for why
 * this table is append-only/state-driven by design. Concurrency safety here
 * comes entirely from `lockById` (`SELECT ... FOR UPDATE`), run and its
 * result inspected BEFORE this transaction decides or writes anything — the
 * identical "decide under lock, not from a stale snapshot" guard
 * `MembershipRepository.lockMembership` provides elsewhere. A genuine
 * concurrent race between two callers ending/revoking the SAME assignment
 * simply serializes on that lock; whichever transaction commits first
 * determines the (single, valid) terminal state the other observes when it
 * re-reads under the same lock and finds the row already in ITS target
 * terminal state, at which point this command's own idempotent-no-op branch
 * below returns it unchanged rather than attempting a second, redundant
 * write. No lost update is possible: a terminal state, once reached, is
 * final and equally correct regardless of which concurrent caller's
 * transaction actually produced it.
 *
 * IDEMPOTENT: ending an assignment already `ended` returns it unchanged.
 * Ending one that is `revoked` — a DIFFERENT terminal state — is refused
 * with `422`, mirroring `garden-assignment-state.ts`'s own transition
 * diagram, where neither terminal state is reachable from the other.
 *
 * Source: implementation-plan.md work package P9B-API-01;
 * services/api/src/modules/collaboration/domain/garden-assignment-state.ts.
 */

import type { GardenAssignment as GardenAssignmentResource } from '@verdery/api-contracts';
import { OrganizationErrorCode } from '@verdery/api-contracts';
import {
  DomainRuleViolatedError,
  NotFoundError,
} from '../../../platform/errors/application-error.js';
import type { IdempotencyStore } from '../../../platform/idempotency/idempotency-store.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { Clock } from '../../../shared/time/clock.js';
import { isValidGardenAssignmentTransition } from '../domain/garden-assignment-state.js';
import type { CollaborationUnitOfWork } from './collaboration-unit-of-work.js';
import { toGardenAssignmentResource } from './garden-assignment-view.js';
import type { OrganizationAuthorization } from './organization-authorization.js';
import { runIdempotentCommand } from './run-idempotent-command.js';

const OPERATION = 'garden_assignments.end';
const TARGET_STATE = 'ended';

function assignmentNotFound(): NotFoundError {
  return new NotFoundError(
    OrganizationErrorCode.AssignmentNotFound,
    'No assignment exists at this id on this organization.',
  );
}

export class EndGardenAssignment {
  constructor(
    private readonly idempotency: IdempotencyStore,
    private readonly unitOfWork: CollaborationUnitOfWork,
    private readonly organizationAuthorization: OrganizationAuthorization,
    private readonly clock: Clock,
  ) {}

  async execute(
    organizationId: Uuid,
    assignmentId: Uuid,
    actorProfileId: Uuid,
    idempotencyKey: string,
  ): Promise<GardenAssignmentResource> {
    await this.organizationAuthorization.requireCapability(
      organizationId,
      actorProfileId,
      'manageGardenAssignment',
    );

    const input = {
      actorProfileId,
      operation: OPERATION,
      idempotencyKey,
      requestFingerprint: JSON.stringify({ organizationId, assignmentId }),
    };

    return runIdempotentCommand(this.idempotency, this.unitOfWork, input, 200, async (context) => {
      const found = await context.gardenAssignments.findByIdAndOrganization(
        assignmentId,
        organizationId,
      );
      if (found === null) {
        throw assignmentNotFound();
      }

      const locked = await context.gardenAssignments.lockById(found.id);
      if (locked === null) {
        throw assignmentNotFound();
      }

      if (locked.state === TARGET_STATE) {
        // Idempotent no-op: already ended.
        return toGardenAssignmentResource(locked);
      }
      if (!isValidGardenAssignmentTransition(locked.state, TARGET_STATE)) {
        throw new DomainRuleViolatedError(
          OrganizationErrorCode.AssignmentInvalidTransition,
          `Cannot end an assignment in state "${locked.state}".`,
        );
      }

      const now = this.clock.now();
      await context.gardenAssignments.transitionState(locked.id, TARGET_STATE, now);

      await context.auditLogger.record({
        eventType: 'garden_assignment.ended',
        subjectType: 'garden_assignment',
        subjectId: locked.id,
        actorProfileId,
        actorType: 'user',
        gardenId: locked.gardenId,
        details: { organizationId, profileId: locked.profileId },
      });
      await context.outbox.append({
        eventType: 'garden_assignment.ended',
        aggregateType: 'garden_assignment',
        aggregateId: locked.id,
        payload: { organizationId, gardenId: locked.gardenId, profileId: locked.profileId },
      });

      return toGardenAssignmentResource({ ...locked, state: TARGET_STATE, validUntil: now });
    });
  }
}
