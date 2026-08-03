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

import { parseSearchPlantsQuery } from './plant-search-query.js';
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
import type { GetPlantIdentification } from '../application/get-plant-identification.js';
import type { ListPlantPhotos } from '../application/list-plant-photos.js';
import type { MovePlant } from '../application/move-plant.js';
import type { RecordObservationFromIdentification } from '../application/record-observation-from-identification.js';
import type { SearchPlants } from '../application/search-plants.js';
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
  readonly getPlantIdentification: GetPlantIdentification;
  readonly listPlantPhotos: ListPlantPhotos;
  readonly searchPlants: SearchPlants;
  readonly updatePlantDetails: UpdatePlantDetails;
  readonly attachPlantPhoto: AttachPlantPhoto;
  readonly setPrimaryPlantPhoto: SetPrimaryPlantPhoto;
  readonly confirmPlantIdentification: ConfirmPlantIdentification;
  readonly recordObservationFromIdentification: RecordObservationFromIdentification;
  readonly transitionPlantLifecycleStage: TransitionPlantLifecycleStage;
  readonly setPlantStatus: SetPlantStatus;
  readonly movePlant: MovePlant;
  readonly searchTaxonomyReferences: SearchTaxonomyReferences;
}

const MAX_TAXONOMY_SEARCH_LIMIT = 100;
// Same bounds `garden-routes.ts`'s own `parseListQuery` uses for `ListGardens`
// — `SearchPlants` is cursor-paginated the identical way, per this module's
// own P4-SEARCH-01 conventions.

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

/** Matches the `PlantListResult` shape, the same `items`-plus-optional-`nextCursor` convention `garden-routes.ts`'s own `toGardenListResult` uses for `GardenListResult`. */
function toPlantListResult<T>(result: { items: readonly T[]; nextCursor: string | null }): {
  items: T[];
  nextCursor?: string;
} {
  return {
    items: [...result.items],
    ...(result.nextCursor === null ? {} : { nextCursor: result.nextCursor }),
  };
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

    // P11-OBS-01: "actual-versus-candidate additions" — this route only
    // ever creates an ACTUAL plant (candidates are `plants.candidate_added`
    // below), so `kind` is a constant, carried anyway so the two events
    // share one log-based-metric filter downstream. Never the display name
    // or any identifier.
    request.log.info(
      {
        event: 'plants.actual_created',
        kind: 'actual',
        groupingKind: plant.groupingKind,
        identified: plant.taxonomyReferenceId !== null,
      },
      'Actual plant created',
    );

    return reply.status(201).send(plant);
  });

  app.get('/gardens/:gardenId/plants', async (request, reply) => {
    const gardenId = requireGardenId(request);
    const { filters, cursor, limit } = parseSearchPlantsQuery(request);

    const result = await deps.searchPlants.execute(
      gardenId,
      request.actorContext.profileId,
      filters,
      cursor,
      limit,
    );

    // P11-OBS-01: "search success, zero results, filter use" — counts and
    // filter-presence flags only, never the query text itself (a common
    // name can be sensitive — plant-intelligence-and-visual-journal.md
    // section 17's own exclusion list).
    request.log.info(
      {
        event: 'plants.search_completed',
        resultCount: result.items.length,
        isZeroResult: result.items.length === 0,
        hasQueryText: filters.query !== undefined && filters.query !== null,
        hasLifecycleStageFilter: filters.lifecycleStage !== undefined,
        hasStatusFilter: filters.status !== undefined,
        hasGroupingKindFilter: filters.groupingKind !== undefined,
        hasIdentifiedFilter: filters.identified !== undefined && filters.identified !== null,
      },
      'Plant search completed',
    );

    return reply.status(200).send(toPlantListResult(result));
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

  app.get('/gardens/:gardenId/plants/:plantId/photos', async (request, reply) => {
    const gardenId = requireGardenId(request);
    const plantId = requirePlantId(request);

    const photos = await deps.listPlantPhotos.execute(
      gardenId,
      plantId,
      request.actorContext.profileId,
    );

    return reply.status(200).send({ items: photos });
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

  app.get('/gardens/:gardenId/plants/:plantId/identification', async (request, reply) => {
    const gardenId = requireGardenId(request);
    const plantId = requirePlantId(request);

    const identification = await deps.getPlantIdentification.execute(
      gardenId,
      plantId,
      request.actorContext.profileId,
    );

    return reply.status(200).send(identification);
  });

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

      // P11-OBS-01: "confirmation outcomes" — paired with
      // `plants.identification_suggested` (application layer, at the
      // moment of the photo-based suggestion), this is the OTHER half of
      // that funnel. `hasCatalogMatch` is read straight off the response
      // this route already sends: confirming an identification with a
      // catalog match sets `plant.taxonomyReferenceId`; a raw-guess-only
      // confirmation leaves it null — no second query.
      request.log.info(
        {
          event: 'plants.identification_confirmed',
          hasCatalogMatch: plant.taxonomyReferenceId !== null,
        },
        'Plant identification confirmed',
      );

      return reply.status(200).send(plant);
    },
  );

  app.post(
    '/gardens/:gardenId/plants/:plantId/identification/:identificationId/record-observation',
    async (request, reply) => {
      requireGardenId(request);
      const plantId = requirePlantId(request);
      const identificationId = requireIdentificationId(request);
      const idempotencyKey = requireIdempotencyKey(request);

      const observation = await deps.recordObservationFromIdentification.execute(
        plantId,
        request.actorContext.profileId,
        identificationId,
        idempotencyKey,
      );

      return reply.status(201).send(observation);
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
