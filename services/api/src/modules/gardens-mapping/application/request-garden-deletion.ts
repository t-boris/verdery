import type { Garden as GardenResource } from '@verdery/api-contracts';
import type { IdempotencyStore } from '../../../platform/idempotency/idempotency-store.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { Clock } from '../../../shared/time/clock.js';
import { requestGardenDeletion } from '../domain/garden.js';
import { applyRevisionGuardedUpdate } from './apply-revision-guarded-update.js';
import type { GardenAuthorization } from './garden-authorization.js';
import { toGardenResource } from './garden-view.js';
import type { GardensMappingUnitOfWork } from './gardens-mapping-unit-of-work.js';
import { runIdempotentCommand } from './run-idempotent-command.js';

const OPERATION = 'gardens.delete_request';

/**
 * Starts the deletion workflow. Does not delete anything: the asynchronous
 * purge after the recovery window is a separate, not-yet-built workflow.
 *
 * Source: architecture/data-and-geospatial-design.md, section "15. Deletion".
 */
export class RequestGardenDeletion {
  constructor(
    private readonly idempotency: IdempotencyStore,
    private readonly unitOfWork: GardensMappingUnitOfWork,
    private readonly authorization: GardenAuthorization,
    private readonly clock: Clock,
  ) {}

  async execute(
    gardenId: Uuid,
    profileId: Uuid,
    expectedRevision: number,
    idempotencyKey: string,
  ): Promise<GardenResource> {
    const membership = await this.authorization.requireCapability(
      gardenId,
      profileId,
      'manageGarden',
    );

    const input = {
      actorProfileId: profileId,
      operation: OPERATION,
      idempotencyKey,
      requestFingerprint: JSON.stringify({ gardenId, expectedRevision }),
    };

    return runIdempotentCommand(this.idempotency, this.unitOfWork, input, 200, async (context) => {
      const now = this.clock.now();
      const requested = await applyRevisionGuardedUpdate(
        context.gardens,
        gardenId,
        expectedRevision,
        (garden) => requestGardenDeletion(garden, now),
      );

      await context.outbox.append({
        eventType: 'garden.deletion_requested',
        aggregateType: 'garden',
        aggregateId: requested.id,
        payload: {},
      });
      await context.auditLogger.record({
        eventType: 'garden.deletion_requested',
        subjectType: 'garden',
        subjectId: requested.id,
        actorProfileId: profileId,
        actorType: 'user',
      });

      return toGardenResource(requested, membership.role);
    });
  }
}
