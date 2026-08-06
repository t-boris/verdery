/**
 * `POST /gardens/{gardenId}/plans/{planMediaId}/reading` — reading an
 * uploaded plat of survey into something a person can review.
 *
 * Its own file rather than a branch of `map-routes.ts` for the reason
 * `georeference-routes.ts` is its own file: this is not a map command. It is
 * a `POST` because it spends provider work, not because it writes — it
 * writes nothing at all (ADR-0018), and accepting any part of the reading is
 * a separate ordinary command with its own revision guard.
 *
 * Same hand-written-validation convention as the rest of this module, reusing
 * `garden-routes.ts`'s helpers.
 *
 * Source: packages/api-contracts/openapi.yaml, operation `readPlatFromPlan`;
 * docs/architecture/decisions/ADR-0018-plat-extraction-as-reviewable-proposals.md.
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';

import type { ReadPlatFromPlan } from '../application/read-plat-from-plan.js';
import type { TraceGardenFromAerial } from '../application/trace-garden-from-aerial.js';
import { requireGardenId } from './garden-routes.js';
import { requireUuid } from './parse-primitives.js';

export interface PlatRoutesDependencies {
  readonly readPlatFromPlan: ReadPlatFromPlan;
  readonly traceGardenFromAerial: TraceGardenFromAerial;
}

function requirePlanMediaId(request: FastifyRequest): string {
  const parameters = request.params as { planMediaId?: unknown };
  return requireUuid(parameters.planMediaId, '/planMediaId');
}

export function registerPlatRoutes(
  app: FastifyInstance,
  dependencies: PlatRoutesDependencies,
): void {
  app.post('/gardens/:gardenId/plans/:planMediaId/reading', async (request, reply) => {
    const gardenId = requireGardenId(request);
    const planMediaId = requirePlanMediaId(request);

    const reading = await dependencies.readPlatFromPlan.execute(
      gardenId,
      request.actorContext.profileId,
      planMediaId,
    );

    return reply.status(200).send(reading);
  });

  app.post('/gardens/:gardenId/aerial-tracing', async (request, reply) => {
    const result = await dependencies.traceGardenFromAerial.execute(
      requireGardenId(request),
      request.actorContext.profileId,
    );
    return reply.status(200).send(result);
  });
}
