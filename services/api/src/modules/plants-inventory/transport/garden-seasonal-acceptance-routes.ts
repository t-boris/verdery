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
import {
  CATALOG_UUID_PATTERN,
  invalid,
  UUID_PATTERN,
} from '../../gardens-mapping/transport/garden-routes.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { TaxonomySeasonalFactReviewItem } from '../application/taxonomy-seasonal-fact-repository.js';

export interface GardenSeasonalAcceptanceRoutesDependencies {
  readonly listGardenSeasonalFactsAwaitingAcceptance: ListGardenSeasonalFactsAwaitingAcceptance;
  readonly acceptGardenSeasonalFact: AcceptGardenSeasonalFact;
}

/**
 * The wire shape of one queue entry, per
 * `GardenSeasonalFactAwaitingAcceptance` in the contract.
 *
 * The twelve month/duration fields are grouped under `timing` rather than
 * spread flat beside the provenance columns, so the object a person is
 * asked to accept is the SAME `SeasonalPlanTaxonomyTiming` the seasonal
 * plan already renders for timing that is in use. One month vocabulary,
 * one renderer, on both sides of the decision.
 *
 * `sourceCitation` / `reviewedBy` / `reviewedOn` are spread from the fact's
 * own discriminated unions, so each is present exactly when its
 * discriminator says it is — absent, never `null`.
 */
function toQueueItemResource(item: TaxonomySeasonalFactReviewItem) {
  const { fact } = item;
  return {
    id: fact.id,
    taxonomyReferenceId: fact.taxonomyReferenceId,
    scientificName: item.scientificName,
    commonName: item.commonName,
    hemisphere: fact.hemisphere,
    timing: {
      sowIndoorsStartMonth: fact.sowIndoorsStartMonth,
      sowIndoorsEndMonth: fact.sowIndoorsEndMonth,
      sowOutdoorsStartMonth: fact.sowOutdoorsStartMonth,
      sowOutdoorsEndMonth: fact.sowOutdoorsEndMonth,
      transplantStartMonth: fact.transplantStartMonth,
      transplantEndMonth: fact.transplantEndMonth,
      harvestStartMonth: fact.harvestStartMonth,
      harvestEndMonth: fact.harvestEndMonth,
      daysToMaturityMin: fact.daysToMaturityMin,
      daysToMaturityMax: fact.daysToMaturityMax,
      successionIntervalDays: fact.successionIntervalDays,
      rotationRestSeasons: fact.rotationRestSeasons,
    },
    authoringMethod: fact.authoringMethod,
    ...(fact.authoringMethod === 'ai_extracted_from_source'
      ? { sourceCitation: fact.sourceCitation }
      : {}),
    reviewStatus: fact.reviewStatus,
    ...(fact.reviewStatus === 'horticulturally_reviewed'
      ? { reviewedBy: fact.reviewedBy, reviewedOn: fact.reviewedOn }
      : {}),
    createdAt: fact.createdAt.toISOString(),
  };
}

function requireGardenId(request: FastifyRequest): Uuid {
  const gardenId = (request.params as Record<string, unknown>)['gardenId'];
  if (typeof gardenId !== 'string' || !UUID_PATTERN.test(gardenId)) {
    throw invalid('gardenId must be a UUID.', 'request.gardenId.invalid', '/gardenId');
  }
  return gardenId;
}

/**
 * `CATALOG_UUID_PATTERN`, not `UUID_PATTERN`: this id names a
 * `taxonomy_seasonal_fact` row seeded by a SQL migration with
 * `gen_random_uuid()` (version 4), and the client is handing back an id the
 * acceptance queue itself gave it. Demanding version 7 here rejected every
 * real fact with `400`, so no client could ever have accepted anything.
 */
function requireFactId(request: FastifyRequest): Uuid {
  const factId = (request.params as Record<string, unknown>)['factId'];
  if (typeof factId !== 'string' || !CATALOG_UUID_PATTERN.test(factId)) {
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
      items: queue.items.map(toQueueItemResource),
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
