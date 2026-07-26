/**
 * Creates a client engagement for a garden, in `draft` state (P9B-API-01).
 *
 * DUAL AUTHORIZATION, decided by whether `serviceOrganizationId` is
 * supplied — see `require-engagement-capability.ts`'s own header for the
 * full ADR-0012 citation this split follows:
 *
 * - Supplied: the caller must hold `manageEngagement` on THAT organization.
 *   The named garden need only EXIST (`404` otherwise) — no ownership or
 *   prior relationship is required, the identical free-standing posture
 *   `CreateGardenAssignment` already takes and justifies at length in its
 *   own header, for the identical reason (section 3's domain diagram; no
 *   schema reference ties `client_engagement` to any prerequisite).
 * - Omitted: the caller must hold `manageGarden` on the garden itself — a
 *   garden owner running the service relationship directly.
 *
 * `stewardshipPolicy` defaults to `'residential'` (the only value the
 * database currently admits) and `clientNotificationsEnabled` defaults to
 * `true` when the caller omits them.
 *
 * Source: implementation-plan.md work package P9B-API-01;
 * architecture/collaboration-and-client-sharing.md, section
 * "8. Client Engagement".
 */

import type { ClientEngagement as ClientEngagementResource } from '@verdery/api-contracts';
import { GardenErrorCode } from '@verdery/api-contracts';
import { NotFoundError } from '../../../platform/errors/application-error.js';
import type { IdempotencyStore } from '../../../platform/idempotency/idempotency-store.js';
import { generateUuidV7 } from '../../../shared/identifiers/uuid.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { Clock } from '../../../shared/time/clock.js';
import type { GardenAuthorization, GardenRepository } from '../../gardens-mapping/public.js';
import type { StewardshipPolicy } from './client-engagement-repository.js';
import { toClientEngagementResource } from './client-engagement-view.js';
import type { CollaborationUnitOfWork } from './collaboration-unit-of-work.js';
import type { OrganizationAuthorization } from './organization-authorization.js';
import { runIdempotentCommand } from './run-idempotent-command.js';

const OPERATION = 'client_engagements.create';
const DEFAULT_STEWARDSHIP_POLICY: StewardshipPolicy = 'residential';

export interface CreateClientEngagementInput {
  readonly gardenId: Uuid;
  readonly serviceOrganizationId?: Uuid;
  readonly stewardshipPolicy?: StewardshipPolicy;
  readonly clientNotificationsEnabled?: boolean;
}

export class CreateClientEngagement {
  constructor(
    private readonly idempotency: IdempotencyStore,
    private readonly unitOfWork: CollaborationUnitOfWork,
    private readonly organizationAuthorization: OrganizationAuthorization,
    private readonly gardenAuthorization: GardenAuthorization,
    private readonly gardens: GardenRepository,
    private readonly clock: Clock,
  ) {}

  async execute(
    request: CreateClientEngagementInput,
    actorProfileId: Uuid,
    idempotencyKey: string,
  ): Promise<ClientEngagementResource> {
    const serviceOrganizationId = request.serviceOrganizationId ?? null;

    if (serviceOrganizationId !== null) {
      await this.organizationAuthorization.requireCapability(
        serviceOrganizationId,
        actorProfileId,
        'manageEngagement',
      );

      const garden = await this.gardens.findById(request.gardenId);
      if (garden === null) {
        throw new NotFoundError(GardenErrorCode.NotFound, 'Garden not found.');
      }
    } else {
      await this.gardenAuthorization.requireCapability(
        request.gardenId,
        actorProfileId,
        'manageGarden',
      );
    }

    const stewardshipPolicy = request.stewardshipPolicy ?? DEFAULT_STEWARDSHIP_POLICY;
    const clientNotificationsEnabled = request.clientNotificationsEnabled ?? true;

    const input = {
      actorProfileId,
      operation: OPERATION,
      idempotencyKey,
      requestFingerprint: JSON.stringify({
        gardenId: request.gardenId,
        serviceOrganizationId,
        stewardshipPolicy,
        clientNotificationsEnabled,
      }),
    };

    return runIdempotentCommand(this.idempotency, this.unitOfWork, input, 201, async (context) => {
      const now = this.clock.now();
      const id = generateUuidV7();

      await context.clientEngagements.insert({
        id,
        gardenId: request.gardenId,
        serviceOrganizationId,
        stewardshipPolicy,
        clientNotificationsEnabled,
        createdByProfileId: actorProfileId,
        now,
      });

      await context.auditLogger.record({
        eventType: 'client_engagement.created',
        subjectType: 'client_engagement',
        subjectId: id,
        actorProfileId,
        actorType: 'user',
        gardenId: request.gardenId,
        details: { serviceOrganizationId, stewardshipPolicy },
      });
      await context.outbox.append({
        eventType: 'client_engagement.created',
        aggregateType: 'client_engagement',
        aggregateId: id,
        payload: { gardenId: request.gardenId, serviceOrganizationId },
      });

      return toClientEngagementResource({
        id,
        gardenId: request.gardenId,
        serviceOrganizationId,
        state: 'draft',
        stewardshipPolicy,
        clientNotificationsEnabled,
        createdByProfileId: actorProfileId,
        activatedAt: null,
        endedAt: null,
        revokedAt: null,
        revokedReason: null,
        createdAt: now,
        updatedAt: now,
      });
    });
  }
}
