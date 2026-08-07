/**
 * `GET /gardens/{gardenId}/care-rules` — what the automation does, and what
 * currently stops it.
 *
 * A plain authenticated garden read: the use case owns `viewGarden`
 * authorization and every state is a typed field in the 200 body, so this
 * route maps one call to one response and decides nothing itself.
 *
 * Source: packages/api-contracts/openapi.yaml, operation `getGardenCareRules`.
 */

import type { GardenCareRulesResult } from '@verdery/api-contracts';
import type { FastifyInstance } from 'fastify';
import { requireGardenId } from '../../gardens-mapping/transport/garden-routes.js';
import type { GetGardenCareRules } from '../application/get-garden-care-rules.js';

export interface CareRuleRoutesDependencies {
  readonly getGardenCareRules: GetGardenCareRules;
}

export function registerCareRuleRoutes(
  app: FastifyInstance,
  dependencies: CareRuleRoutesDependencies,
): void {
  app.get('/gardens/:gardenId/care-rules', async (request, reply) => {
    const gardenId = requireGardenId(request);

    const result = await dependencies.getGardenCareRules.execute(
      gardenId,
      request.actorContext.profileId,
    );

    return reply.status(200).send(result satisfies GardenCareRulesResult);
  });
}
