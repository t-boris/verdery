/**
 * Seasonal plan HTTP route (P9D-SEASON-API-01) — the `SeasonalPlan` tag.
 *
 * Hand-written request validation against the same rules
 * `packages/api-contracts/openapi.yaml` declares, matching this module's
 * existing transport layer (`recommendation-routes.ts`'s own header
 * convention). Reuses `gardens-mapping/transport/garden-routes.ts`'s
 * exported `requireGardenId`, the same reuse `recommendation-routes.ts`
 * already makes for its own `gardenId` path parameter.
 *
 * Source: packages/api-contracts/openapi.yaml, tag `SeasonalPlan`;
 * tasks/todo.md, "P9D-SEASON-01 design decisions", "Stage 3 —
 * P9D-SEASON-API-01".
 */

import type { FastifyInstance } from 'fastify';
import { requireGardenId } from '../../gardens-mapping/transport/garden-routes.js';
import type { GetGardenSeasonalPlan } from '../application/get-garden-seasonal-plan.js';
import { toGardenSeasonalPlanResource } from '../application/get-garden-seasonal-plan-view.js';

export interface SeasonalPlanRoutesDependencies {
  readonly getGardenSeasonalPlan: GetGardenSeasonalPlan;
}

export function registerSeasonalPlanRoutes(
  app: FastifyInstance,
  dependencies: SeasonalPlanRoutesDependencies,
): void {
  app.get('/gardens/:gardenId/seasonal-plan', async (request, reply) => {
    const gardenId = requireGardenId(request);

    const plan = await dependencies.getGardenSeasonalPlan.execute(
      gardenId,
      request.actorContext.profileId,
    );

    return reply.status(200).send(toGardenSeasonalPlanResource(plan));
  });
}
