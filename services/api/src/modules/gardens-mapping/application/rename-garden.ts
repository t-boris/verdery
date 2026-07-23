import type { Garden as GardenResource } from '@verdery/api-contracts';
import type { IdempotencyStore } from '../../../platform/idempotency/idempotency-store.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { Clock } from '../../../shared/time/clock.js';
import { renameGarden } from '../domain/garden.js';
import { applyRevisionGuardedUpdate } from './apply-revision-guarded-update.js';
import type { GardenAuthorization } from './garden-authorization.js';
import { toGardenResource } from './garden-view.js';
import type { GardensMappingUnitOfWork } from './gardens-mapping-unit-of-work.js';
import { runIdempotentCommand } from './run-idempotent-command.js';

const OPERATION = 'gardens.rename';

export class RenameGarden {
  constructor(
    private readonly idempotency: IdempotencyStore,
    private readonly unitOfWork: GardensMappingUnitOfWork,
    private readonly authorization: GardenAuthorization,
    private readonly clock: Clock,
  ) {}

  async execute(
    gardenId: Uuid,
    profileId: Uuid,
    rawName: string,
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
      requestFingerprint: JSON.stringify({ gardenId, name: rawName, expectedRevision }),
    };

    return runIdempotentCommand(this.idempotency, this.unitOfWork, input, 200, async (context) => {
      const now = this.clock.now();
      const renamed = await applyRevisionGuardedUpdate(
        context.gardens,
        gardenId,
        expectedRevision,
        (garden) => renameGarden(garden, rawName, now),
      );

      await context.syncChanges.record({
        gardenId: renamed.id,
        recordId: renamed.id,
        recordType: 'garden',
        operation: 'upsert',
        recordRevision: renamed.revision,
      });
      await context.outbox.append({
        eventType: 'garden.renamed',
        aggregateType: 'garden',
        aggregateId: renamed.id,
        payload: { name: renamed.name },
      });
      await context.auditLogger.record({
        eventType: 'garden.renamed',
        subjectType: 'garden',
        subjectId: renamed.id,
        actorProfileId: profileId,
        actorType: 'user',
      });

      return toGardenResource(renamed, membership.role);
    });
  }
}
