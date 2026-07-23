import type { Garden as GardenResource } from '@verdery/api-contracts';
import type { IdempotencyStore } from '../../../platform/idempotency/idempotency-store.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { Clock } from '../../../shared/time/clock.js';
import { archiveGarden } from '../domain/garden.js';
import { applyRevisionGuardedUpdate } from './apply-revision-guarded-update.js';
import type { GardenAuthorization } from './garden-authorization.js';
import { toGardenResource } from './garden-view.js';
import type { GardensMappingUnitOfWork } from './gardens-mapping-unit-of-work.js';
import { runIdempotentCommand } from './run-idempotent-command.js';

const OPERATION = 'gardens.archive';

export class ArchiveGarden {
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
      const archived = await applyRevisionGuardedUpdate(
        context.gardens,
        gardenId,
        expectedRevision,
        (garden) => archiveGarden(garden, now),
      );

      await context.syncChanges.record({
        gardenId: archived.id,
        recordId: archived.id,
        recordType: 'garden',
        operation: 'upsert',
        recordRevision: archived.revision,
      });
      await context.outbox.append({
        eventType: 'garden.archived',
        aggregateType: 'garden',
        aggregateId: archived.id,
        payload: {},
      });
      await context.auditLogger.record({
        eventType: 'garden.archived',
        subjectType: 'garden',
        subjectId: archived.id,
        actorProfileId: profileId,
        actorType: 'user',
      });

      return toGardenResource(archived, membership.role);
    });
  }
}
