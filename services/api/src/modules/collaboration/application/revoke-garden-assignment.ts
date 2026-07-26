/**
 * Revokes a garden assignment (P9B-API-01) — the for-cause sibling of
 * `EndGardenAssignment`; see that file's own header for the shared
 * `manageGardenAssignment`-only gate, the no-revision-column reasoning, and
 * the lock-then-decide concurrency guard, all identical here.
 *
 * IDEMPOTENT: revoking an assignment already `revoked` returns it unchanged.
 * Revoking one that is `ended` — a DIFFERENT terminal state — is refused
 * with `422`.
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

const OPERATION = 'garden_assignments.revoke';
const TARGET_STATE = 'revoked';

function assignmentNotFound(): NotFoundError {
  return new NotFoundError(
    OrganizationErrorCode.AssignmentNotFound,
    'No assignment exists at this id on this organization.',
  );
}

export class RevokeGardenAssignment {
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
        // Idempotent no-op: already revoked.
        return toGardenAssignmentResource(locked);
      }
      if (!isValidGardenAssignmentTransition(locked.state, TARGET_STATE)) {
        throw new DomainRuleViolatedError(
          OrganizationErrorCode.AssignmentInvalidTransition,
          `Cannot revoke an assignment in state "${locked.state}".`,
        );
      }

      const now = this.clock.now();
      await context.gardenAssignments.transitionState(locked.id, TARGET_STATE, now);

      await context.auditLogger.record({
        eventType: 'garden_assignment.revoked',
        subjectType: 'garden_assignment',
        subjectId: locked.id,
        actorProfileId,
        actorType: 'user',
        gardenId: locked.gardenId,
        details: { organizationId, profileId: locked.profileId },
      });
      await context.outbox.append({
        eventType: 'garden_assignment.revoked',
        aggregateType: 'garden_assignment',
        aggregateId: locked.id,
        payload: { organizationId, gardenId: locked.gardenId, profileId: locked.profileId },
      });

      return toGardenAssignmentResource({ ...locked, state: TARGET_STATE, validUntil: now });
    });
  }
}
