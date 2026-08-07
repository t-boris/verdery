/**
 * The garden-scoped seasonal-timing acceptance surface: the queue its owner
 * or editor works through, and the accept that makes one fact readable by
 * the three seasonal rules FOR THAT GARDEN.
 *
 * Garden-scoped paths rather than a global `/plant-knowledge/...` queue,
 * because the decision itself is garden-scoped — the URL says what the
 * authority covers. Authorization lives in the use cases (`editGardenContent`),
 * not here, the same split every other garden route in this codebase uses.
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import type {
  AcceptGardenSeasonalFact,
  ListGardenSeasonalFactsAwaitingAcceptance,
} from '../application/accept-garden-seasonal-facts.js';
import { SEASONAL_ACCEPTANCE_QUEUE_DEFAULT_LIMIT } from '../application/accept-garden-seasonal-facts.js';
import { invalid, UUID_PATTERN } from '../../gardens-mapping/transport/garden-routes.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';

export interface GardenSeasonalAcceptanceRoutesDependencies {
  readonly listGardenSeasonalFactsAwaitingAcceptance: ListGardenSeasonalFactsAwaitingAcceptance;
  readonly acceptGardenSeasonalFact: AcceptGardenSeasonalFact;
}

function requireGardenId(request: FastifyRequest): Uuid {
  const gardenId = (request.params as Record<string, unknown>)['gardenId'];
  if (typeof gardenId !== 'string' || !UUID_PATTERN.test(gardenId)) {
    throw invalid('gardenId must be a UUID.', 'request.gardenId.invalid', '/gardenId');
  }
  return gardenId;
}

function requireFactId(request: FastifyRequest): Uuid {
  const factId = (request.params as Record<string, unknown>)['factId'];
  if (typeof factId !== 'string' || !UUID_PATTERN.test(factId)) {
    throw invalid('factId must be a UUID.', 'request.factId.invalid', '/factId');
  }
  return factId;
}

function parseLimit(request: FastifyRequest): number {
  const limit = (request.query as { limit?: unknown }).limit;
  if (limit === undefined) {
    return SEASONAL_ACCEPTANCE_QUEUE_DEFAULT_LIMIT;
  }
  const parsed = Number(limit);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw invalid('limit must be a positive integer.', 'request.limit.invalid', '/limit');
  }
  return parsed;
}

export function registerGardenSeasonalAcceptanceRoutes(
  app: FastifyInstance,
  dependencies: GardenSeasonalAcceptanceRoutesDependencies,
): void {
  app.get('/gardens/:gardenId/seasonal-facts/awaiting-acceptance', async (request, reply) => {
    const queue = await dependencies.listGardenSeasonalFactsAwaitingAcceptance.execute(
      requireGardenId(request),
      request.actorContext.profileId,
      parseLimit(request),
    );

    return reply.status(200).send({
      // Reported rather than inferred from an empty list: "this garden has
      // no location yet" and "there is nothing left to accept" are different
      // situations, and a reader who cannot tell them apart cannot act.
      hemisphereKnown: queue.hemisphereKnown,
      items: queue.items.map((item) => ({
        ...item.fact,
        createdAt: item.fact.createdAt.toISOString(),
        scientificName: item.scientificName,
        commonName: item.commonName,
      })),
    });
  });

  app.post('/gardens/:gardenId/seasonal-facts/:factId/accept', async (request, reply) => {
    const result = await dependencies.acceptGardenSeasonalFact.execute(
      requireGardenId(request),
      requireFactId(request),
      request.actorContext.profileId,
    );

    // 200 for every outcome: a retried accept, a fact that does not apply
    // here, and a garden without a location are all legitimate states of
    // this request rather than client errors, and the caller is told which
    // one it got.
    return reply.status(200).send(result);
  });
}
