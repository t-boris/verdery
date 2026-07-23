import type { Garden as GardenResource } from '@verdery/api-contracts';
import type { IdempotencyStore } from '../../../platform/idempotency/idempotency-store.js';
import { generateUuidV7 } from '../../../shared/identifiers/uuid.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { Clock } from '../../../shared/time/clock.js';
import { createGarden } from '../domain/garden.js';
import { toGardenResource } from './garden-view.js';
import type { GardensMappingUnitOfWork } from './gardens-mapping-unit-of-work.js';
import { runIdempotentCommand } from './run-idempotent-command.js';

const OPERATION = 'gardens.create';

export class CreateGarden {
  constructor(
    private readonly idempotency: IdempotencyStore,
    private readonly unitOfWork: GardensMappingUnitOfWork,
    private readonly clock: Clock,
  ) {}

  async execute(profileId: Uuid, rawName: string, idempotencyKey: string): Promise<GardenResource> {
    const input = {
      actorProfileId: profileId,
      operation: OPERATION,
      idempotencyKey,
      requestFingerprint: JSON.stringify({ name: rawName }),
    };

    return runIdempotentCommand(this.idempotency, this.unitOfWork, input, 201, async (context) => {
      const now = this.clock.now();
      const garden = createGarden(generateUuidV7(), rawName, profileId, now);

      await context.gardens.insert(garden);
      await context.memberships.insertOwner(generateUuidV7(), garden.id, profileId, now);

      await context.syncChanges.record({
        gardenId: garden.id,
        recordId: garden.id,
        recordType: 'garden',
        operation: 'upsert',
        recordRevision: garden.revision,
      });
      await context.outbox.append({
        eventType: 'garden.created',
        aggregateType: 'garden',
        aggregateId: garden.id,
        payload: { name: garden.name, ownerProfileId: profileId },
      });
      await context.auditLogger.record({
        eventType: 'garden.created',
        subjectType: 'garden',
        subjectId: garden.id,
        actorProfileId: profileId,
        actorType: 'user',
      });

      return toGardenResource(garden, 'owner');
    });
  }
}
