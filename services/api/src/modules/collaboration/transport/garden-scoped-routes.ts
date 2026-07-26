/**
 * The two garden-scoped reads onto the professional-service domain
 * (P9B-API-01) — `GET /gardens/{gardenId}/assignments` and
 * `GET /gardens/{gardenId}/engagements`. Tagged `Collaboration`, not
 * `Organizations`, in the contract: these are garden-scoped resources,
 * authorized the same way every other garden read in that tag already is,
 * even though the rows they read belong to this module's own tables.
 *
 * Source: packages/api-contracts/openapi.yaml, tag `Collaboration`;
 * implementation-plan.md work package P9B-API-01.
 */

import type {
  ClientEngagementListResult,
  GardenAssignmentListResult,
} from '@verdery/api-contracts';
import type { FastifyInstance } from 'fastify';
import type { ListClientEngagementsForGarden } from '../application/list-client-engagements-for-garden.js';
import type { ListGardenAssignmentsForGarden } from '../application/list-garden-assignments-for-garden.js';
import { requireGardenId } from './route-helpers.js';

export interface GardenScopedRoutesDependencies {
  readonly listGardenAssignmentsForGarden: ListGardenAssignmentsForGarden;
  readonly listClientEngagementsForGarden: ListClientEngagementsForGarden;
}

export function registerGardenScopedCollaborationRoutes(
  app: FastifyInstance,
  dependencies: GardenScopedRoutesDependencies,
): void {
  app.get('/gardens/:gardenId/assignments', async (request, reply) => {
    const gardenId = requireGardenId(request);

    const result: GardenAssignmentListResult =
      await dependencies.listGardenAssignmentsForGarden.execute(
        gardenId,
        request.actorContext.profileId,
      );

    return reply.status(200).send(result);
  });

  app.get('/gardens/:gardenId/engagements', async (request, reply) => {
    const gardenId = requireGardenId(request);

    const result: ClientEngagementListResult =
      await dependencies.listClientEngagementsForGarden.execute(
        gardenId,
        request.actorContext.profileId,
      );

    return reply.status(200).send(result);
  });
}
