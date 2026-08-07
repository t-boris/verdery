/**
 * The seasonal-timing review surface's own HTTP routes.
 *
 * Registered in `app.ts`'s ordinary authenticated block, with authorization
 * enforced INSIDE the use cases (`requirePlantReviewerAccess`) rather than
 * as a Fastify preHandler — the exact shape
 * `plant-assertion-review-routes.ts` established for the sibling queue, and
 * the same "the guard is a call at the top of the use case" convention the
 * rest of this codebase follows.
 *
 * NOT IN `packages/api-contracts/openapi.yaml`, for the same stated reason
 * its sibling is not: this is a professional/admin capability gated by a
 * configuration allowlist, not a surface any mobile or web client contract
 * targets. A deliberate scope boundary, not an oversight.
 *
 * Source: application/review-taxonomy-seasonal-facts.ts.
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { invalid, UUID_PATTERN } from '../../gardens-mapping/transport/garden-routes.js';
import type {
  ApproveTaxonomySeasonalFactReview,
  ListTaxonomySeasonalFactsAwaitingReview,
} from '../application/review-taxonomy-seasonal-facts.js';

export interface SeasonalFactReviewRoutesDependencies {
  readonly listTaxonomySeasonalFactsAwaitingReview: ListTaxonomySeasonalFactsAwaitingReview;
  readonly approveTaxonomySeasonalFactReview: ApproveTaxonomySeasonalFactReview;
}

function requireFactId(request: FastifyRequest): string {
  const params = request.params as Record<string, unknown>;
  const factId = params['factId'];
  if (typeof factId !== 'string' || !UUID_PATTERN.test(factId)) {
    throw invalid('factId must be a UUID.', 'request.factId.invalid', '/factId');
  }
  return factId;
}

function parseLimit(request: FastifyRequest): number | undefined {
  const limit = (request.query as { limit?: unknown }).limit;
  if (limit === undefined) {
    return undefined;
  }
  const parsed = Number(limit);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw invalid('limit must be a positive integer.', 'request.limit.invalid', '/limit');
  }
  return parsed;
}

export function registerSeasonalFactReviewRoutes(
  app: FastifyInstance,
  dependencies: SeasonalFactReviewRoutesDependencies,
): void {
  app.get('/plant-knowledge/seasonal-facts/awaiting-review', async (request, reply) => {
    const items = await dependencies.listTaxonomySeasonalFactsAwaitingReview.execute(
      request.actorContext,
      parseLimit(request),
    );

    return reply.status(200).send({
      items: items.map((item) => ({
        ...item.fact,
        createdAt: item.fact.createdAt.toISOString(),
        scientificName: item.scientificName,
        commonName: item.commonName,
      })),
    });
  });

  app.post('/plant-knowledge/seasonal-facts/:factId/approve', async (request, reply) => {
    const result = await dependencies.approveTaxonomySeasonalFactReview.execute(
      requireFactId(request),
      request.actorContext,
    );

    // 200 either way: "already reviewed or missing" is a legitimate outcome
    // of a retried or raced approval, not a client error, and the two are
    // deliberately indistinguishable.
    return reply.status(200).send(result);
  });
}
