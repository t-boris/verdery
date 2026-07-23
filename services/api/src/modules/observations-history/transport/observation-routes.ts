/**
 * Observation HTTP routes.
 *
 * Request validation here is hand-written against the same rules the
 * OpenAPI document declares (`packages/api-contracts/openapi.yaml`, tag
 * `Observations`), not derived from it automatically — the same convention
 * `gardens-mapping/transport/garden-routes.ts`'s own header comment
 * describes. Reuses that file's exported `UUID_PATTERN`/`requireGardenId`/
 * `requireIdempotencyKey`/`invalid`. No route here needs `If-Match`:
 * `observation` carries no revision — see `domain/observation.ts`'s own
 * header comment.
 *
 * Every command here already returns its own `ObservationResource`, built to
 * match this tag's `Observation` schema field-for-field (see
 * `application/observation-view.ts`'s own doc comment), so no per-response
 * mapping step is needed beyond wrapping a list in `{ items }`.
 *
 * Source: packages/api-contracts/openapi.yaml, tag `Observations`;
 * implementation-plan.md work package P4-CONTRACT-01.
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  UUID_PATTERN,
  invalid,
  requireGardenId,
  requireIdempotencyKey,
} from '../../gardens-mapping/transport/garden-routes.js';
import type { CorrectObservation } from '../application/correct-observation.js';
import type { ListObservationsForGarden } from '../application/list-observations-for-garden.js';
import type { ListObservationsForPlant } from '../application/list-observations-for-plant.js';
import type { RecordObservation } from '../application/record-observation.js';
import {
  parseCorrectObservationRequest,
  parseRecordObservationRequest,
} from './parse-observation-request.js';

export interface ObservationRoutesDependencies {
  readonly recordObservation: RecordObservation;
  readonly correctObservation: CorrectObservation;
  readonly listObservationsForGarden: ListObservationsForGarden;
  readonly listObservationsForPlant: ListObservationsForPlant;
}

function requirePlantId(request: FastifyRequest): string {
  const { plantId } = request.params as { plantId?: unknown };

  if (typeof plantId !== 'string' || !UUID_PATTERN.test(plantId)) {
    throw invalid('plantId must be a UUID.', 'request.plant_id.invalid', '/plantId');
  }

  return plantId;
}

function requireObservationId(request: FastifyRequest): string {
  const { observationId } = request.params as { observationId?: unknown };

  if (typeof observationId !== 'string' || !UUID_PATTERN.test(observationId)) {
    throw invalid(
      'observationId must be a UUID.',
      'request.observation_id.invalid',
      '/observationId',
    );
  }

  return observationId;
}

/**
 * Wraps a list in `{ items }`, matching the `ObservationListResult` shape —
 * untyped against the generated contract type on purpose, the same way
 * every other response here is sent without a compile-time JSON-schema
 * bridge (see this file's own header comment).
 */
function toItemsResult<T>(items: readonly T[]): { items: T[] } {
  return { items: [...items] };
}

export function registerObservationRoutes(
  app: FastifyInstance,
  deps: ObservationRoutesDependencies,
): void {
  app.post('/gardens/:gardenId/observations', async (request, reply) => {
    const gardenId = requireGardenId(request);
    const idempotencyKey = requireIdempotencyKey(request);
    const input = parseRecordObservationRequest(request.body);

    const observation = await deps.recordObservation.execute(
      gardenId,
      request.actorContext.profileId,
      input,
      idempotencyKey,
    );

    return reply.status(201).send(observation);
  });

  app.get('/gardens/:gardenId/observations', async (request, reply) => {
    const gardenId = requireGardenId(request);

    const items = await deps.listObservationsForGarden.execute(
      gardenId,
      request.actorContext.profileId,
    );

    return reply.status(200).send(toItemsResult(items));
  });

  app.post('/observations/:observationId/corrections', async (request, reply) => {
    const observationId = requireObservationId(request);
    const idempotencyKey = requireIdempotencyKey(request);
    const input = parseCorrectObservationRequest(request.body);

    const correction = await deps.correctObservation.execute(
      observationId,
      request.actorContext.profileId,
      input,
      idempotencyKey,
    );

    return reply.status(201).send(correction);
  });

  app.get('/gardens/:gardenId/plants/:plantId/observations', async (request, reply) => {
    const gardenId = requireGardenId(request);
    const plantId = requirePlantId(request);

    const items = await deps.listObservationsForPlant.execute(
      gardenId,
      plantId,
      request.actorContext.profileId,
    );

    return reply.status(200).send(toItemsResult(items));
  });
}
