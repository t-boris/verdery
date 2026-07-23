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

  /**
   * `gardenId`, when supplied, is used as the new garden's id instead of a
   * server-generated one. Optional and defaulted to a fresh `generateUuidV7()`
   * so every existing caller (the ordinary REST `POST /v1/gardens` route,
   * which has no id to supply) is unaffected — added for the synchronization
   * module's `gardens.create` sync command, whose own payload names
   * `gardenId` as "the client-generated id of the new garden," needed for
   * offline optimistic creation before the server has ever seen the record.
   */
  async execute(
    profileId: Uuid,
    rawName: string,
    idempotencyKey: string,
    gardenId?: Uuid,
  ): Promise<GardenResource> {
    const input = {
      actorProfileId: profileId,
      operation: OPERATION,
      idempotencyKey,
      requestFingerprint: JSON.stringify({ name: rawName, gardenId }),
    };

    return runIdempotentCommand(this.idempotency, this.unitOfWork, input, 201, async (context) => {
      const now = this.clock.now();
      const garden = createGarden(gardenId ?? generateUuidV7(), rawName, profileId, now);

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
