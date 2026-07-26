/**
 * Assigns an organization member to a garden (P9B-API-01) — the ONE place
 * organization boundaries and garden boundaries meet.
 *
 * Checks BOTH, in order: (a) the caller holds `manageGardenAssignment` on
 * `organizationId`, and (b) `profileId` is genuinely an ACTIVE member of
 * THAT SAME organization — never assumed from the caller's own membership,
 * always re-read against the specific organization named in the path, so an
 * `organizationAdmin` of org A can never assign a member of org B through
 * org A's own endpoint.
 *
 * FREE-STANDING, NOT SCOPED BY AN ACTIVE CLIENT ENGAGEMENT. Read
 * architecture/collaboration-and-client-sharing.md sections 3, 7, and 8
 * specifically to settle this rather than assume it: section 3's own domain
 * diagram draws `garden_assignment` as a DIRECT edge from
 * `organization_membership` to `garden`, with no `client_engagement` on that
 * path at all, and the P9B-DATA-01 migration gives `garden_assignment` no
 * foreign key or other reference to `client_engagement` — the two are
 * genuinely independent records with independent lifecycles. Section 23's
 * "Open Product Decisions" names several genuinely unresolved questions
 * (publisher-capability defaults, staff-attribution fields, stewardship
 * policies) but never lists "must an assignment be backed by an engagement"
 * among them, which is the strongest signal available that this is not an
 * open question the architecture left for this package to invent an answer
 * to — it is already settled by the model as written. An organization
 * administrator may therefore assign any of their organization's members to
 * ANY garden id that exists, unconditionally; nothing here asks the
 * garden's owner to have approved it, or an engagement naming this
 * organization to already exist.
 *
 * STILL VALIDATES THAT THE GARDEN EXISTS, though — a plain existence read
 * against `gardens-mapping`'s own `GardenRepository`, not the
 * membership-gated `GardenAuthorization` (the caller is not necessarily a
 * garden member; that is the entire point of this mechanism). `garden_id`
 * carries no foreign key in the schema (the same reason
 * `collaboration.membership.garden_id` lost its own), so this is the only
 * check standing between an assignment and a dangling, meaningless
 * `gardenId`.
 *
 * Fails with `409` on `garden_assignment_active_key` — the schema's own
 * enforcement of "at most one ACTIVE assignment per (garden, profile)" —
 * checked twice, deliberately, the same dual pre-check-plus-catch pattern
 * `AddOrganizationMember`/`CreateInvitation` already establish.
 *
 * Source: implementation-plan.md work package P9B-API-01;
 * architecture/collaboration-and-client-sharing.md, sections
 * "3. Domain Relationships", "7. Service Organizations and Assignments",
 * "23. Open Product Decisions".
 */

import type { GardenAssignment as GardenAssignmentResource } from '@verdery/api-contracts';
import { GardenErrorCode, OrganizationErrorCode } from '@verdery/api-contracts';
import {
  isUniqueViolation,
  postgresConstraintName,
} from '../../../platform/database/postgres-errors.js';
import {
  ConflictError,
  DomainRuleViolatedError,
  NotFoundError,
} from '../../../platform/errors/application-error.js';
import type { IdempotencyStore } from '../../../platform/idempotency/idempotency-store.js';
import { generateUuidV7 } from '../../../shared/identifiers/uuid.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { Clock } from '../../../shared/time/clock.js';
import type { GardenRepository } from '../../gardens-mapping/public.js';
import type { GardenAssignmentRole } from './garden-assignment-repository.js';
import { toGardenAssignmentResource } from './garden-assignment-view.js';
import type { CollaborationUnitOfWork } from './collaboration-unit-of-work.js';
import type { OrganizationAuthorization } from './organization-authorization.js';
import { runIdempotentCommand } from './run-idempotent-command.js';

const OPERATION = 'garden_assignments.create';
const ACTIVE_ASSIGNMENT_CONSTRAINT = 'garden_assignment_active_key';

export interface CreateGardenAssignmentInput {
  readonly profileId: Uuid;
  readonly gardenId: Uuid;
  readonly role: GardenAssignmentRole;
}

function assignmentAlreadyActive(cause?: unknown): ConflictError {
  return new ConflictError(
    OrganizationErrorCode.AssignmentAlreadyActive,
    'This profile already holds an active assignment on this garden.',
    cause === undefined ? {} : { cause },
  );
}

export class CreateGardenAssignment {
  constructor(
    private readonly idempotency: IdempotencyStore,
    private readonly unitOfWork: CollaborationUnitOfWork,
    private readonly organizationAuthorization: OrganizationAuthorization,
    private readonly gardens: GardenRepository,
    private readonly clock: Clock,
  ) {}

  async execute(
    organizationId: Uuid,
    request: CreateGardenAssignmentInput,
    actorProfileId: Uuid,
    idempotencyKey: string,
  ): Promise<GardenAssignmentResource> {
    await this.organizationAuthorization.requireCapability(
      organizationId,
      actorProfileId,
      'manageGardenAssignment',
    );

    const garden = await this.gardens.findById(request.gardenId);
    if (garden === null) {
      throw new NotFoundError(GardenErrorCode.NotFound, 'Garden not found.');
    }

    const input = {
      actorProfileId,
      operation: OPERATION,
      idempotencyKey,
      requestFingerprint: JSON.stringify({ organizationId, ...request }),
    };

    return runIdempotentCommand(this.idempotency, this.unitOfWork, input, 201, async (context) => {
      const assignee = await context.organizationMemberships.findActiveByOrganizationAndProfile(
        organizationId,
        request.profileId,
      );
      if (assignee === null) {
        throw new DomainRuleViolatedError(
          OrganizationErrorCode.AssigneeNotOrganizationMember,
          'The assignee must be an active member of this organization.',
        );
      }

      const alreadyActive = await context.gardenAssignments.findActiveByGardenAndProfile(
        request.gardenId,
        request.profileId,
      );
      if (alreadyActive !== null) {
        throw assignmentAlreadyActive();
      }

      const now = this.clock.now();
      const id = generateUuidV7();

      try {
        await context.gardenAssignments.insert({
          id,
          organizationId,
          profileId: request.profileId,
          gardenId: request.gardenId,
          role: request.role,
          createdByProfileId: actorProfileId,
          now,
        });
      } catch (error) {
        if (
          isUniqueViolation(error) &&
          postgresConstraintName(error) === ACTIVE_ASSIGNMENT_CONSTRAINT
        ) {
          throw assignmentAlreadyActive(error);
        }
        throw error;
      }

      await context.auditLogger.record({
        eventType: 'garden_assignment.created',
        subjectType: 'garden_assignment',
        subjectId: id,
        actorProfileId,
        actorType: 'user',
        gardenId: request.gardenId,
        details: { organizationId, profileId: request.profileId, role: request.role },
      });
      await context.outbox.append({
        eventType: 'garden_assignment.created',
        aggregateType: 'garden_assignment',
        aggregateId: id,
        payload: {
          organizationId,
          profileId: request.profileId,
          gardenId: request.gardenId,
          role: request.role,
        },
      });

      return toGardenAssignmentResource({
        id,
        organizationId,
        profileId: request.profileId,
        gardenId: request.gardenId,
        role: request.role,
        state: 'active',
        validFrom: now,
        validUntil: null,
        createdByProfileId: actorProfileId,
        createdAt: now,
      });
    });
  }
}
