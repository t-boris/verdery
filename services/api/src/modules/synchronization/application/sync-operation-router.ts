/**
 * Top-level dispatch by `recordType` to the five per-family routers.
 *
 * This is the "generic command-dispatch entry point" the work package asked
 * to check for — gardens-mapping's own `map-routes.ts` has one for its own
 * 13 map commands, but nothing before this module dispatched *across*
 * record families (`garden` vs. `plant` vs. `task`, and so on), because
 * nothing before the synchronization protocol needed to route one batch
 * spanning every family at once.
 *
 * BOUNDARY CAPABILITY CHECK (P9A-SYNC-01, G-8
 * `docs/development/garden-capability-matrix.md`): before dispatching,
 * `requiredPushCapability` declares what this exact payload needs, and this
 * method asserts it directly — defence in depth, not a replacement for the
 * per-command `requireCapability` calls the delegated command still makes
 * (and still must pass) on its own. A failure here is mapped through the
 * SAME `toRejected` every delegated command's own `executeAndMapOutcome`
 * uses, so a viewer's push is refused with an ordinary per-operation
 * `rejected` result inside the HTTP 200 batch, identically to today —
 * nothing about the wire shape changes, only that the refusal is now
 * guaranteed at the boundary too, not solely inherited.
 */

import type { SyncOperationPayload } from '@verdery/api-contracts';
import { ApplicationError } from '../../../platform/errors/application-error.js';
import type { GardenAuthorization } from '../../gardens-mapping/public.js';
import type { DeletionActor } from '../../../shared/deletion/deletion-policy.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import { toRejected } from './execute-and-map-outcome.js';
import type { GardenObjectOperationRouterDependencies } from './route-garden-object-operation.js';
import { routeGardenObjectOperation } from './route-garden-object-operation.js';
import type { GardenOperationRouterDependencies } from './route-garden-operation.js';
import { routeGardenOperation } from './route-garden-operation.js';
import type { ObservationOperationRouterDependencies } from './route-observation-operation.js';
import { routeObservationOperation } from './route-observation-operation.js';
import type { PlantOperationRouterDependencies } from './route-plant-operation.js';
import { routePlantOperation } from './route-plant-operation.js';
import { requiredPushCapability } from './sync-operation-capability.js';
import type { TaskOperationRouterDependencies } from './route-task-operation.js';
import { routeTaskOperation } from './route-task-operation.js';
import type { SyncOperationOutcome } from './sync-operation-outcome.js';

export interface SyncOperationRouterDependencies {
  readonly garden: GardenOperationRouterDependencies;
  readonly gardenObject: GardenObjectOperationRouterDependencies;
  readonly plant: PlantOperationRouterDependencies;
  readonly observation: ObservationOperationRouterDependencies;
  readonly task: TaskOperationRouterDependencies;
  /** G-8's own boundary check — the same `GardenAuthorization` every routed command already holds, reused here rather than duplicated. */
  readonly authorization: GardenAuthorization;
}

export class SyncOperationRouter {
  constructor(private readonly deps: SyncOperationRouterDependencies) {}

  async route(
    actor: DeletionActor,
    operationId: Uuid,
    payload: SyncOperationPayload,
  ): Promise<SyncOperationOutcome> {
    const profileId = actor.profileId;

    const requiredCapability = requiredPushCapability(payload);
    if (requiredCapability !== null) {
      try {
        await this.deps.authorization.requireCapability(
          payload.gardenId,
          profileId,
          requiredCapability,
        );
      } catch (error) {
        if (error instanceof ApplicationError) {
          return toRejected(error);
        }
        throw error;
      }
    }

    switch (payload.recordType) {
      case 'garden':
        // The one family whose commands include a step-up-gated operation
        // (`requestGardenDeletion`), so it receives the whole actor rather
        // than the profile id alone — see `routeGardenOperation`.
        return routeGardenOperation(this.deps.garden, actor, operationId, payload);
      case 'gardenObject':
        return routeGardenObjectOperation(this.deps.gardenObject, profileId, operationId, payload);
      case 'plant':
        return routePlantOperation(this.deps.plant, profileId, operationId, payload);
      case 'observation':
        return routeObservationOperation(this.deps.observation, profileId, operationId, payload);
      case 'task':
        return routeTaskOperation(this.deps.task, profileId, operationId, payload);
    }
  }
}
