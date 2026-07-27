/**
 * Garden context fact HTTP routes (P9D-CONTEXT-01).
 *
 * Hand-written request validation against the same rules
 * `packages/api-contracts/openapi.yaml` declares, matching this module's
 * existing transport layer (`garden-routes.ts`'s own header comment).
 *
 * `PUT /gardens/{gardenId}/context/{contextKind}` deliberately reads neither
 * `Idempotency-Key` nor `If-Match` — see `RecordGardenContextFact`'s own
 * header for why this natural-key upsert does not need either.
 *
 * Source: packages/api-contracts/openapi.yaml, tag `GardenContext`;
 * implementation-plan.md §18.2, work package P9D-CONTEXT-01.
 */

import type {
  GardenContextFact as GardenContextFactResource,
  GardenContextFactListResult,
  RecordGardenContextFactRequest,
} from '@verdery/api-contracts';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { GARDEN_CONTEXT_KINDS } from '../domain/garden-context-fact.js';
import type {
  GardenContextKind,
  RecordGardenContextFactInput,
} from '../domain/garden-context-fact.js';
import type { ListGardenContextFacts } from '../application/list-garden-context-facts.js';
import type { RecordGardenContextFact } from '../application/record-garden-context-fact.js';
import { toGardenContextFactResource } from '../application/garden-context-fact-view.js';
import { requireGardenId } from './garden-routes.js';
import { requireEnum, requireOptionalString, requireString } from './parse-primitives.js';

export interface GardenContextRoutesDependencies {
  readonly listGardenContextFacts: ListGardenContextFacts;
  readonly recordGardenContextFact: RecordGardenContextFact;
}

function requireContextKind(request: FastifyRequest): GardenContextKind {
  const { contextKind } = request.params as { contextKind?: unknown };
  return requireEnum(contextKind, GARDEN_CONTEXT_KINDS, '/contextKind');
}

function requireRecordBody(
  request: FastifyRequest,
  contextKind: GardenContextKind,
): RecordGardenContextFactInput {
  const body = request.body as Partial<RecordGardenContextFactRequest> | undefined;

  const value = requireString(body?.value, '/value');
  const source = requireString(body?.source, '/source');
  const reviewedBy = requireOptionalString(body?.reviewedBy, '/reviewedBy');
  const reviewedOn = requireOptionalString(body?.reviewedOn, '/reviewedOn');

  return {
    contextKind,
    value,
    source,
    ...(reviewedBy === undefined ? {} : { reviewedBy }),
    ...(reviewedOn === undefined ? {} : { reviewedOn }),
  } as RecordGardenContextFactInput;
}

function toListResult(items: readonly GardenContextFactResource[]): GardenContextFactListResult {
  return { items: [...items] };
}

export function registerGardenContextRoutes(
  app: FastifyInstance,
  dependencies: GardenContextRoutesDependencies,
): void {
  app.get('/gardens/:gardenId/context', async (request, reply) => {
    const gardenId = requireGardenId(request);

    const facts = await dependencies.listGardenContextFacts.execute(
      gardenId,
      request.actorContext.profileId,
    );

    return reply.status(200).send(toListResult(facts.map(toGardenContextFactResource)));
  });

  app.put('/gardens/:gardenId/context/:contextKind', async (request, reply) => {
    const gardenId = requireGardenId(request);
    const contextKind = requireContextKind(request);
    const input = requireRecordBody(request, contextKind);

    const fact = await dependencies.recordGardenContextFact.execute(
      gardenId,
      request.actorContext.profileId,
      input,
    );

    return reply.status(200).send(toGardenContextFactResource(fact));
  });
}
