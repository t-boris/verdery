/**
 * `GET /gardens/{gardenId}/weather` — the conditions over a garden, so the
 * weather the rule engine reasons from is the same weather the person can
 * see.
 *
 * A plain authenticated garden read: the use case owns `viewGarden`
 * authorization and every degradation is a typed field in the 200 body, so
 * this route maps one call to one response and decides nothing itself —
 * the `geocoding-routes.ts` shape.
 *
 * `requireGardenId` is imported from `gardens-mapping`'s own route module,
 * the same cross-module transport-helper reuse `recommendation-routes.ts`
 * already establishes for the identical parameter.
 *
 * Source: packages/api-contracts/openapi.yaml, operation `getGardenWeather`.
 */

import type { GardenWeatherResult } from '@verdery/api-contracts';
import type { FastifyInstance } from 'fastify';
import { requireGardenId } from '../../gardens-mapping/transport/garden-routes.js';
import type { GetGardenWeatherView } from '../application/get-garden-weather-view.js';

export interface WeatherRoutesDependencies {
  readonly getGardenWeatherView: GetGardenWeatherView;
}

export function registerWeatherRoutes(
  app: FastifyInstance,
  dependencies: WeatherRoutesDependencies,
): void {
  app.get('/gardens/:gardenId/weather', async (request, reply) => {
    const gardenId = requireGardenId(request);

    const result = await dependencies.getGardenWeatherView.execute(
      gardenId,
      request.actorContext.profileId,
    );

    return reply.status(200).send(result satisfies GardenWeatherResult);
  });
}
