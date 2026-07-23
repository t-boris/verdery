/**
 * Routes one `recordType: 'garden'` sync operation to gardens-mapping's own
 * garden-lifecycle command classes.
 *
 * `operationId` is passed as each sibling command's own `idempotencyKey`
 * argument — deliberately, not a coincidence: every one of these commands
 * already implements idempotency-by-key through the exact same
 * `IdempotencyStore` this module reuses for its own operation-id
 * idempotency (`sync-push-idempotency.ts`), keyed by
 * `(actorProfileId, operation, idempotencyKey)` where `operation` is the
 * command's own constant (`'gardens.create'`, matching this sync command's
 * own `commandType` exactly, per the contract's own description). Since
 * `operationId` is a globally unique, client-generated id that names exactly
 * one canonical payload for its whole lifetime, reusing it here is the
 * correct value for that parameter, not merely a convenient one — it gives
 * the sibling command's own internal replay guard as a second, independent
 * layer of protection against double-executing the same domain write, on
 * top of (and orthogonal to) this module's own operation-id idempotency
 * record, which is what actually decides `accepted` vs. `duplicate` on the
 * wire.
 */

import type {
  Garden as GardenResource,
  SyncGardenOperationPayload,
  SyncRecordReference,
} from '@verdery/api-contracts';
import type {
  ArchiveGarden,
  CreateGarden,
  GetGarden,
  RenameGarden,
  RequestGardenDeletion,
} from '../../gardens-mapping/public.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import { executeAndMapOutcome } from './execute-and-map-outcome.js';
import type { SyncOperationOutcome } from './sync-operation-outcome.js';

export interface GardenOperationRouterDependencies {
  readonly createGarden: CreateGarden;
  readonly renameGarden: RenameGarden;
  readonly archiveGarden: ArchiveGarden;
  readonly requestGardenDeletion: RequestGardenDeletion;
  readonly getGarden: GetGarden;
}

function toRecordRevisions(garden: GardenResource): SyncRecordReference[] {
  return [{ recordId: garden.id, recordType: 'garden', revision: garden.revision }];
}

export async function routeGardenOperation(
  deps: GardenOperationRouterDependencies,
  profileId: Uuid,
  operationId: Uuid,
  payload: SyncGardenOperationPayload,
): Promise<SyncOperationOutcome> {
  const { gardenId, command } = payload;

  const fetchCurrentRecord = async () => ({
    recordType: 'garden' as const,
    data: await deps.getGarden.execute(gardenId, profileId),
  });

  switch (command.commandType) {
    case 'gardens.create':
      // No `expectedRevision` on creation, so no stale-revision conflict is
      // possible — `fetchCurrentRecord` is `null`, matching
      // `execute-and-map-outcome.ts`'s own contract for that case.
      return executeAndMapOutcome(async () => {
        const garden = await deps.createGarden.execute(
          profileId,
          command.request.name,
          operationId,
          gardenId,
        );
        return toRecordRevisions(garden);
      }, null);

    case 'gardens.rename':
      return executeAndMapOutcome(async () => {
        const garden = await deps.renameGarden.execute(
          gardenId,
          profileId,
          command.request.name,
          command.expectedRevision,
          operationId,
        );
        return toRecordRevisions(garden);
      }, fetchCurrentRecord);

    case 'gardens.archive':
      return executeAndMapOutcome(async () => {
        const garden = await deps.archiveGarden.execute(
          gardenId,
          profileId,
          command.expectedRevision,
          operationId,
        );
        return toRecordRevisions(garden);
      }, fetchCurrentRecord);

    case 'gardens.delete_request':
      return executeAndMapOutcome(async () => {
        const garden = await deps.requestGardenDeletion.execute(
          gardenId,
          profileId,
          command.expectedRevision,
          operationId,
        );
        return toRecordRevisions(garden);
      }, fetchCurrentRecord);
  }
}
