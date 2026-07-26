/**
 * Creates a service organization (P9B-API-01).
 *
 * ANY AUTHENTICATED PROFILE MAY CALL THIS. An organization does not exist
 * yet for anyone to hold a role on, so no capability could possibly gate its
 * own creation — the identical reasoning `gardens-mapping/application/
 * create-garden.ts`'s own `CreateGarden` already applies to a brand-new
 * garden (also uncapability-gated). Registered account state
 * (`registerAuthentication`'s own `isAccountUsable` gate) is the only
 * precondition, enforced upstream of every authenticated route already.
 *
 * Creates the organization AND its first `organization_membership` row, as
 * `organization_admin`, in ONE transaction — ADR-0012: "a solo professional
 * may start with an organization containing one administrator."
 *
 * Source: implementation-plan.md work package P9B-API-01;
 * architecture/decisions/ADR-0012-separate-team-and-client-sharing.md,
 * section "Service Organizations".
 */

import type { ServiceOrganization as ServiceOrganizationResource } from '@verdery/api-contracts';
import type { IdempotencyStore } from '../../../platform/idempotency/idempotency-store.js';
import { generateUuidV7 } from '../../../shared/identifiers/uuid.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { Clock } from '../../../shared/time/clock.js';
import { createServiceOrganization } from '../domain/service-organization.js';
import type { CollaborationUnitOfWork } from './collaboration-unit-of-work.js';
import { toServiceOrganizationResource } from './organization-view.js';
import { runIdempotentCommand } from './run-idempotent-command.js';

const OPERATION = 'organizations.create';

export class CreateServiceOrganization {
  constructor(
    private readonly idempotency: IdempotencyStore,
    private readonly unitOfWork: CollaborationUnitOfWork,
    private readonly clock: Clock,
  ) {}

  async execute(
    profileId: Uuid,
    rawName: string,
    idempotencyKey: string,
  ): Promise<ServiceOrganizationResource> {
    const input = {
      actorProfileId: profileId,
      operation: OPERATION,
      idempotencyKey,
      requestFingerprint: JSON.stringify({ name: rawName }),
    };

    return runIdempotentCommand(this.idempotency, this.unitOfWork, input, 201, async (context) => {
      const now = this.clock.now();
      const organization = createServiceOrganization(generateUuidV7(), rawName, now);
      await context.organizations.insert(organization);

      const membershipId = generateUuidV7();
      await context.organizationMemberships.insert(
        membershipId,
        organization.id,
        profileId,
        'organization_admin',
        now,
      );
      await context.organizationMemberships.openPeriod({
        id: generateUuidV7(),
        membershipId,
        organizationId: organization.id,
        profileId,
        role: 'organization_admin',
        validFrom: now,
      });

      await context.outbox.append({
        eventType: 'organization.created',
        aggregateType: 'service_organization',
        aggregateId: organization.id,
        payload: { name: organization.name, adminProfileId: profileId },
      });
      await context.auditLogger.record({
        eventType: 'organization.created',
        subjectType: 'service_organization',
        subjectId: organization.id,
        actorProfileId: profileId,
        actorType: 'user',
      });

      return toServiceOrganizationResource(organization, 'organization_admin');
    });
  }
}
