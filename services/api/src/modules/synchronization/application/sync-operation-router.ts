/**
 * Top-level dispatch by `recordType` to the five per-family routers.
 *
 * This is the "generic command-dispatch entry point" the work package asked
 * to check for — gardens-mapping's own `map-routes.ts` has one for its own
 * 13 map commands, but nothing before this module dispatched *across*
 * record families (`garden` vs. `plant` vs. `task`, and so on), because
 * nothing before the synchronization protocol needed to route one batch
 * spanning every family at once.
 */

import type { SyncOperationPayload } from '@verdery/api-contracts';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { GardenObjectOperationRouterDependencies } from './route-garden-object-operation.js';
import { routeGardenObjectOperation } from './route-garden-object-operation.js';
import type { GardenOperationRouterDependencies } from './route-garden-operation.js';
import { routeGardenOperation } from './route-garden-operation.js';
import type { ObservationOperationRouterDependencies } from './route-observation-operation.js';
import { routeObservationOperation } from './route-observation-operation.js';
import type { PlantOperationRouterDependencies } from './route-plant-operation.js';
import { routePlantOperation } from './route-plant-operation.js';
import type { TaskOperationRouterDependencies } from './route-task-operation.js';
import { routeTaskOperation } from './route-task-operation.js';
import type { SyncOperationOutcome } from './sync-operation-outcome.js';

export interface SyncOperationRouterDependencies {
  readonly garden: GardenOperationRouterDependencies;
  readonly gardenObject: GardenObjectOperationRouterDependencies;
  readonly plant: PlantOperationRouterDependencies;
  readonly observation: ObservationOperationRouterDependencies;
  readonly task: TaskOperationRouterDependencies;
}

export class SyncOperationRouter {
  constructor(private readonly deps: SyncOperationRouterDependencies) {}

  async route(
    profileId: Uuid,
    operationId: Uuid,
    payload: SyncOperationPayload,
  ): Promise<SyncOperationOutcome> {
    switch (payload.recordType) {
      case 'garden':
        return routeGardenOperation(this.deps.garden, profileId, operationId, payload);
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
