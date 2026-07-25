/**
 * Today and recommendation HTTP routes (P7-BE-01) — the `Recommendations`
 * tag: the Today query plus FR-24's four feedback controls and the task
 * conversion, hand-validated against the OpenAPI document like every
 * sibling transport (`garden-routes.ts`'s own header convention). Reuses
 * that file's exported `UUID_PATTERN`/`requireGardenId`/
 * `requireIdempotencyKey`/`requireExpectedRevision`/`invalid`.
 *
 * `GET /gardens/{gardenId}/today` is a query that records first
 * presentation as a side effect — see `get-today-view.ts`'s header for the
 * read-triggers-write decision and its idempotency/race reasoning; the
 * OpenAPI operation description says the same to clients.
 *
 * Source: packages/api-contracts/openapi.yaml, tag `Recommendations`;
 * implementation-plan.md work package P7-BE-01.
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  UUID_PATTERN,
  invalid,
  requireExpectedRevision,
  requireGardenId,
  requireIdempotencyKey,
} from '../../gardens-mapping/transport/garden-routes.js';
import type { ConvertRecommendationToTask } from '../application/convert-recommendation-to-task.js';
import type { GetTodayView } from '../application/get-today-view.js';
import { TODAY_DEFAULT_LIMIT, TODAY_MAX_LIMIT } from '../application/get-today-view.js';
import type {
  CompleteRecommendation,
  DismissRecommendation,
  MarkRecommendationIrrelevant,
  PostponeRecommendation,
} from '../application/recommendation-feedback-commands.js';

export interface RecommendationRoutesDependencies {
  readonly getTodayView: GetTodayView;
  readonly completeRecommendation: CompleteRecommendation;
  readonly postponeRecommendation: PostponeRecommendation;
  readonly dismissRecommendation: DismissRecommendation;
  readonly markRecommendationIrrelevant: MarkRecommendationIrrelevant;
  readonly convertRecommendationToTask: ConvertRecommendationToTask;
}

function requireRecommendationId(request: FastifyRequest): string {
  const { recommendationId } = request.params as { recommendationId?: unknown };

  if (typeof recommendationId !== 'string' || !UUID_PATTERN.test(recommendationId)) {
    throw invalid(
      'recommendationId must be a UUID.',
      'request.recommendation_id.invalid',
      '/recommendationId',
    );
  }

  return recommendationId;
}

/** Parses the bounded `limit` query parameter — default and maximum are the contract's own documented numbers. */
function parseTodayLimit(request: FastifyRequest): number {
  const { limit } = request.query as { limit?: unknown };
  if (limit === undefined) {
    return TODAY_DEFAULT_LIMIT;
  }
  const parsed = Number(limit);
  if (
    typeof limit !== 'string' ||
    !Number.isInteger(parsed) ||
    parsed < 1 ||
    parsed > TODAY_MAX_LIMIT
  ) {
    throw invalid(
      `limit must be an integer between 1 and ${String(TODAY_MAX_LIMIT)}.`,
      'request.invalid',
      '/limit',
    );
  }
  return parsed;
}

/** Parses the postpone body's optional `postponedUntil` — absent, `null`, and a valid RFC 3339 timestamp are all legal ("no document names a default or required postponement horizon"). */
function parsePostponedUntil(body: unknown): Date | null {
  if (body === undefined || body === null) {
    return null;
  }
  if (typeof body !== 'object' || Array.isArray(body)) {
    throw invalid('the request body must be an object.', 'request.invalid', '');
  }
  const { postponedUntil } = body as { postponedUntil?: unknown };
  if (postponedUntil === undefined || postponedUntil === null) {
    return null;
  }
  if (typeof postponedUntil !== 'string') {
    throw invalid(
      'postponedUntil must be an RFC 3339 timestamp.',
      'request.invalid',
      '/postponedUntil',
    );
  }
  const parsed = new Date(postponedUntil);
  if (Number.isNaN(parsed.getTime())) {
    throw invalid(
      'postponedUntil must be an RFC 3339 timestamp.',
      'request.invalid',
      '/postponedUntil',
    );
  }
  return parsed;
}

export function registerRecommendationRoutes(
  app: FastifyInstance,
  deps: RecommendationRoutesDependencies,
): void {
  app.get('/gardens/:gardenId/today', async (request, reply) => {
    const gardenId = requireGardenId(request);
    const limit = parseTodayLimit(request);

    const today = await deps.getTodayView.execute(gardenId, request.actorContext.profileId, limit);

    // One structured line per Today read (P7-ANALYTICS-01) —
    // recommendations-and-ai.md section 17's presentation measure at its
    // source: `presented_at` rows carry every first presentation durably,
    // but a Today read that served nothing (or nothing NEW) leaves no row
    // behind, so only this request can count it. Counts only — no garden
    // or candidate ids, no user identity, never explanation text; this is
    // an operational service log, not a consented product-analytics event
    // (observability-and-analytics.md, sections 10-11).
    request.log.info(
      {
        event: 'recommendations.today_served',
        itemsServed: today.result.items.length,
        firstPresentations: today.firstPresentations,
        limit,
      },
      'Today view served',
    );

    return reply.status(200).send(today.result);
  });

  app.post(
    '/gardens/:gardenId/recommendations/:recommendationId/complete',
    async (request, reply) => {
      const gardenId = requireGardenId(request);
      const recommendationId = requireRecommendationId(request);
      const idempotencyKey = requireIdempotencyKey(request);
      const expectedRevision = requireExpectedRevision(request);

      const recommendation = await deps.completeRecommendation.execute(
        gardenId,
        recommendationId,
        request.actorContext.profileId,
        expectedRevision,
        idempotencyKey,
      );

      return reply.status(200).send(recommendation);
    },
  );

  app.post(
    '/gardens/:gardenId/recommendations/:recommendationId/postpone',
    async (request, reply) => {
      const gardenId = requireGardenId(request);
      const recommendationId = requireRecommendationId(request);
      const idempotencyKey = requireIdempotencyKey(request);
      const expectedRevision = requireExpectedRevision(request);
      const postponedUntil = parsePostponedUntil(request.body);

      const recommendation = await deps.postponeRecommendation.execute(
        gardenId,
        recommendationId,
        request.actorContext.profileId,
        expectedRevision,
        postponedUntil,
        idempotencyKey,
      );

      return reply.status(200).send(recommendation);
    },
  );

  app.post(
    '/gardens/:gardenId/recommendations/:recommendationId/dismiss',
    async (request, reply) => {
      const gardenId = requireGardenId(request);
      const recommendationId = requireRecommendationId(request);
      const idempotencyKey = requireIdempotencyKey(request);
      const expectedRevision = requireExpectedRevision(request);

      const recommendation = await deps.dismissRecommendation.execute(
        gardenId,
        recommendationId,
        request.actorContext.profileId,
        expectedRevision,
        idempotencyKey,
      );

      return reply.status(200).send(recommendation);
    },
  );

  app.post(
    '/gardens/:gardenId/recommendations/:recommendationId/mark-irrelevant',
    async (request, reply) => {
      const gardenId = requireGardenId(request);
      const recommendationId = requireRecommendationId(request);
      const idempotencyKey = requireIdempotencyKey(request);
      const expectedRevision = requireExpectedRevision(request);

      const recommendation = await deps.markRecommendationIrrelevant.execute(
        gardenId,
        recommendationId,
        request.actorContext.profileId,
        expectedRevision,
        idempotencyKey,
      );

      return reply.status(200).send(recommendation);
    },
  );

  app.post(
    '/gardens/:gardenId/recommendations/:recommendationId/convert-to-task',
    async (request, reply) => {
      const gardenId = requireGardenId(request);
      const recommendationId = requireRecommendationId(request);
      const idempotencyKey = requireIdempotencyKey(request);
      const expectedRevision = requireExpectedRevision(request);

      const result = await deps.convertRecommendationToTask.execute(
        gardenId,
        recommendationId,
        request.actorContext.profileId,
        expectedRevision,
        idempotencyKey,
      );

      return reply.status(201).send(result);
    },
  );
}
