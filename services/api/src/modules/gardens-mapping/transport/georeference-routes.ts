/**
 * `PUT /gardens/{gardenId}/georeference` — placing a garden on the Earth.
 *
 * Its own file rather than a fourteenth branch in `map-routes.ts`: this is
 * not a map command, and that endpoint's shape (one `POST` with a
 * discriminated payload, a command id and a client timestamp) says nothing
 * about a revisioned garden-level resource.
 *
 * Same hand-written-validation convention as the rest of this module, and
 * the same reused helpers from `garden-routes.ts`. The body parser lives in
 * `parse-georeference-request.ts` so it can be tested without a server.
 *
 * Source: packages/api-contracts/openapi.yaml, operation
 * `setGardenGeoreference`; implementation-plan.md work package P12-GEO-01.
 */

import type { FastifyInstance } from 'fastify';
import type { SetGardenGeoreference } from '../application/set-garden-georeference.js';
import {
  optionalExpectedRevision,
  requireGardenId,
  requireIdempotencyKey,
} from './garden-routes.js';
import { parseGeoreferenceRequest } from './parse-georeference-request.js';

export interface GeoreferenceRoutesDependencies {
  readonly setGardenGeoreference: SetGardenGeoreference;
}

export function registerGeoreferenceRoutes(
  app: FastifyInstance,
  dependencies: GeoreferenceRoutesDependencies,
): void {
  app.put('/gardens/:gardenId/georeference', async (request, reply) => {
    const gardenId = requireGardenId(request);
    const idempotencyKey = requireIdempotencyKey(request);
    const expectedRevision = optionalExpectedRevision(request);
    const input = parseGeoreferenceRequest(request.body);

    const georeference = await dependencies.setGardenGeoreference.execute(
      gardenId,
      request.actorContext.profileId,
      input,
      expectedRevision,
      idempotencyKey,
    );

    return reply.status(200).send(georeference);
  });
}
