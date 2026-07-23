/**
 * Plant HTTP routes.
 *
 * Request validation here is hand-written against the same rules the
 * OpenAPI document declares (`packages/api-contracts/openapi.yaml`, tag
 * `Plants`), not derived from it automatically — the same convention
 * `gardens-mapping/transport/garden-routes.ts`'s own header comment
 * describes. Reuses that file's exported `UUID_PATTERN`/`requireGardenId`/
 * `requireIdempotencyKey`/`requireExpectedRevision`/`invalid` rather than a
 * second copy of the same logic.
 *
 * Every command here already returns its own `PlantResource`/
 * `PlantPhotoResource`/`TaxonomyReferenceResource` view, built to match this
 * tag's schemas field-for-field (see each view file's own doc comment) —
 * so, unlike gardens-mapping's `toGardenListResult`, no per-response mapping
 * step is needed beyond wrapping a list in `{ items }`.
 *
 * Source: packages/api-contracts/openapi.yaml, tag `Plants`;
 * implementation-plan.md work package P4-CONTRACT-01.
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  UUID_PATTERN,
  invalid,
  requireExpectedRevision,
  requireGardenId,
  requireIdempotencyKey,
} from '../../gardens-mapping/transport/garden-routes.js';
import type { AddPlantFromPhoto } from '../application/add-plant-from-photo.js';
import type { AddPlant } from '../application/add-plant.js';
import type { AttachPlantPhoto } from '../application/attach-plant-photo.js';
import type { ConfirmPlantIdentification } from '../application/confirm-plant-identification.js';
import type { GetPlant } from '../application/get-plant.js';
import type { MovePlant } from '../application/move-plant.js';
import type { SearchTaxonomyReferences } from '../application/search-taxonomy-references.js';
import type { SetPlantStatus } from '../application/set-plant-status.js';
import type { SetPrimaryPlantPhoto } from '../application/set-primary-plant-photo.js';
import type { TransitionPlantLifecycleStage } from '../application/transition-plant-lifecycle-stage.js';
import type { UpdatePlantDetails } from '../application/update-plant-details.js';
import {
  parseAddPlantFromPhotoRequest,
  parseAddPlantRequest,
  parseAttachPlantPhotoRequest,
  parseLifecycleStageRequest,
  parseMovePlantRequest,
  parsePlantStatusRequest,
  parseUpdatePlantDetailsRequest,
} from './parse-plant-request.js';

export interface PlantRoutesDependencies {
  readonly addPlant: AddPlant;
  readonly addPlantFromPhoto: AddPlantFromPhoto;
  readonly getPlant: GetPlant;
  readonly updatePlantDetails: UpdatePlantDetails;
  readonly attachPlantPhoto: AttachPlantPhoto;
  readonly setPrimaryPlantPhoto: SetPrimaryPlantPhoto;
  readonly confirmPlantIdentification: ConfirmPlantIdentification;
  readonly transitionPlantLifecycleStage: TransitionPlantLifecycleStage;
  readonly setPlantStatus: SetPlantStatus;
  readonly movePlant: MovePlant;
  readonly searchTaxonomyReferences: SearchTaxonomyReferences;
}

const MAX_TAXONOMY_SEARCH_LIMIT = 100;

function requirePlantId(request: FastifyRequest): string {
  const { plantId } = request.params as { plantId?: unknown };

  if (typeof plantId !== 'string' || !UUID_PATTERN.test(plantId)) {
    throw invalid('plantId must be a UUID.', 'request.plant_id.invalid', '/plantId');
  }

  return plantId;
}

function requirePlantPhotoId(request: FastifyRequest): string {
  const { plantPhotoId } = request.params as { plantPhotoId?: unknown };

  if (typeof plantPhotoId !== 'string' || !UUID_PATTERN.test(plantPhotoId)) {
    throw invalid(
      'plantPhotoId must be a UUID.',
      'request.plant_photo_id.invalid',
      '/plantPhotoId',
    );
  }

  return plantPhotoId;
}

function requireIdentificationId(request: FastifyRequest): string {
  const { identificationId } = request.params as { identificationId?: unknown };

  if (typeof identificationId !== 'string' || !UUID_PATTERN.test(identificationId)) {
    throw invalid(
      'identificationId must be a UUID.',
      'request.identification_id.invalid',
      '/identificationId',
    );
  }

  return identificationId;
}

function parseTaxonomySearchQuery(request: FastifyRequest): {
  query: string | null;
  limit: number | undefined;
} {
  const raw = request.query as { query?: unknown; limit?: unknown };
  const query = typeof raw.query === 'string' && raw.query.length > 0 ? raw.query : null;

  if (raw.limit === undefined) {
    return { query, limit: undefined };
  }

  const limit = Number(raw.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_TAXONOMY_SEARCH_LIMIT) {
    throw invalid(
      `limit must be between 1 and ${String(MAX_TAXONOMY_SEARCH_LIMIT)}.`,
      'request.limit.invalid',
      '/limit',
    );
  }

  return { query, limit };
}

/**
 * Wraps a list in `{ items }`, matching the `TaxonomyReferenceListResult`
 * shape — untyped against the generated contract type on purpose, the same
 * way every other response here is sent without a compile-time JSON-schema
 * bridge (see this file's own header comment).
 */
function toItemsResult<T>(items: readonly T[]): { items: T[] } {
  return { items: [...items] };
}

export function registerPlantRoutes(app: FastifyInstance, deps: PlantRoutesDependencies): void {
  app.post('/gardens/:gardenId/plants', async (request, reply) => {
    const gardenId = requireGardenId(request);
    const idempotencyKey = requireIdempotencyKey(request);
    const input = parseAddPlantRequest(request.body);

    const plant = await deps.addPlant.execute(
      gardenId,
      request.actorContext.profileId,
      input,
      idempotencyKey,
    );

    return reply.status(201).send(plant);
  });

  app.post('/gardens/:gardenId/plants/from-photo', async (request, reply) => {
    const gardenId = requireGardenId(request);
    const idempotencyKey = requireIdempotencyKey(request);
    const input = parseAddPlantFromPhotoRequest(request.body);

    const plant = await deps.addPlantFromPhoto.execute(
      gardenId,
      request.actorContext.profileId,
      input,
      idempotencyKey,
    );

    return reply.status(201).send(plant);
  });

  app.get('/gardens/:gardenId/plants/:plantId', async (request, reply) => {
    const gardenId = requireGardenId(request);
    const plantId = requirePlantId(request);

    const plant = await deps.getPlant.execute(gardenId, plantId, request.actorContext.profileId);

    return reply.status(200).send(plant);
  });

  app.patch('/gardens/:gardenId/plants/:plantId', async (request, reply) => {
    requireGardenId(request);
    const plantId = requirePlantId(request);
    const idempotencyKey = requireIdempotencyKey(request);
    const expectedRevision = requireExpectedRevision(request);
    const changes = parseUpdatePlantDetailsRequest(request.body);

    const plant = await deps.updatePlantDetails.execute(
      plantId,
      request.actorContext.profileId,
      expectedRevision,
      changes,
      idempotencyKey,
    );

    return reply.status(200).send(plant);
  });

  app.post('/gardens/:gardenId/plants/:plantId/photos', async (request, reply) => {
    requireGardenId(request);
    const plantId = requirePlantId(request);
    const idempotencyKey = requireIdempotencyKey(request);
    const input = parseAttachPlantPhotoRequest(request.body);

    const photo = await deps.attachPlantPhoto.execute(
      plantId,
      request.actorContext.profileId,
      input,
      idempotencyKey,
    );

    return reply.status(201).send(photo);
  });

  app.post(
    '/gardens/:gardenId/plants/:plantId/photos/:plantPhotoId/primary',
    async (request, reply) => {
      requireGardenId(request);
      const plantId = requirePlantId(request);
      const plantPhotoId = requirePlantPhotoId(request);
      const idempotencyKey = requireIdempotencyKey(request);

      const photo = await deps.setPrimaryPlantPhoto.execute(
        plantId,
        request.actorContext.profileId,
        plantPhotoId,
        idempotencyKey,
      );

      return reply.status(200).send(photo);
    },
  );

  app.post(
    '/gardens/:gardenId/plants/:plantId/identification/:identificationId/confirm',
    async (request, reply) => {
      requireGardenId(request);
      const plantId = requirePlantId(request);
      const identificationId = requireIdentificationId(request);
      const idempotencyKey = requireIdempotencyKey(request);
      const expectedRevision = requireExpectedRevision(request);

      const plant = await deps.confirmPlantIdentification.execute(
        plantId,
        request.actorContext.profileId,
        identificationId,
        expectedRevision,
        idempotencyKey,
      );

      return reply.status(200).send(plant);
    },
  );

  app.post('/gardens/:gardenId/plants/:plantId/lifecycle-stage', async (request, reply) => {
    requireGardenId(request);
    const plantId = requirePlantId(request);
    const idempotencyKey = requireIdempotencyKey(request);
    const expectedRevision = requireExpectedRevision(request);
    const stage = parseLifecycleStageRequest(request.body);

    const plant = await deps.transitionPlantLifecycleStage.execute(
      plantId,
      request.actorContext.profileId,
      expectedRevision,
      stage,
      idempotencyKey,
    );

    return reply.status(200).send(plant);
  });

  app.post('/gardens/:gardenId/plants/:plantId/status', async (request, reply) => {
    requireGardenId(request);
    const plantId = requirePlantId(request);
    const idempotencyKey = requireIdempotencyKey(request);
    const expectedRevision = requireExpectedRevision(request);
    const status = parsePlantStatusRequest(request.body);

    const plant = await deps.setPlantStatus.execute(
      plantId,
      request.actorContext.profileId,
      expectedRevision,
      status,
      idempotencyKey,
    );

    return reply.status(200).send(plant);
  });

  app.post('/gardens/:gardenId/plants/:plantId/move', async (request, reply) => {
    requireGardenId(request);
    const plantId = requirePlantId(request);
    const idempotencyKey = requireIdempotencyKey(request);
    const expectedRevision = requireExpectedRevision(request);
    const input = parseMovePlantRequest(request.body);

    const plant = await deps.movePlant.execute(
      plantId,
      request.actorContext.profileId,
      expectedRevision,
      input,
      idempotencyKey,
    );

    return reply.status(200).send(plant);
  });

  app.get('/gardens/:gardenId/taxonomy-references', async (request, reply) => {
    requireGardenId(request);
    const { query, limit } = parseTaxonomySearchQuery(request);

    const items = await deps.searchTaxonomyReferences.execute(query, limit);

    return reply.status(200).send(toItemsResult(items));
  });
}
