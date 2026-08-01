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
 * Every command here already returns its own resource shape, built to match
 * the corresponding contract schema field-for-field (see
 * `application/observation-view.ts`'s own doc comment) — `ObservationResource`
 * for every route but the disposition one, which returns
 * `ImageAnalysisResultResource` (P11-HEALTH-01) — so no per-response mapping
 * step is needed beyond wrapping a list in `{ items }`.
 *
 * Source: packages/api-contracts/openapi.yaml, tag `Observations`;
 * implementation-plan.md work packages P4-CONTRACT-01, P11-HEALTH-01.
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
import type { ObservationPhotoResource } from '../application/observation-view.js';
import type { RecordObservation } from '../application/record-observation.js';
import type { SetHealthSuggestionDisposition } from '../application/set-health-suggestion-disposition.js';
import {
  parseCorrectObservationRequest,
  parseRecordObservationRequest,
  parseSetHealthSuggestionDispositionRequest,
} from './parse-observation-request.js';

export interface ObservationRoutesDependencies {
  readonly recordObservation: RecordObservation;
  readonly correctObservation: CorrectObservation;
  readonly listObservationsForGarden: ListObservationsForGarden;
  readonly listObservationsForPlant: ListObservationsForPlant;
  readonly setHealthSuggestionDisposition: SetHealthSuggestionDisposition;
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

function requireAnalysisResultId(request: FastifyRequest): string {
  const { analysisResultId } = request.params as { analysisResultId?: unknown };

  if (typeof analysisResultId !== 'string' || !UUID_PATTERN.test(analysisResultId)) {
    throw invalid(
      'analysisResultId must be a UUID.',
      'request.analysis_result_id.invalid',
      '/analysisResultId',
    );
  }

  return analysisResultId;
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

/**
 * P11-OBS-01: "health-suggestion request, additional-view request" —
 * logged whenever an observation carries at least one photo, since a
 * photo's own analysis IS the (implicit, automatic) health-suggestion
 * request — there is no separate client-invoked "request a suggestion"
 * action. Counts and closed-vocabulary safety classes only: never
 * `suggestedLabel`, `evidenceSummary`, or `alternativeExplanations` (all
 * content), and never a raw `modelName` (a `hasModel` presence flag
 * instead — see `plant_condition_ai.result`'s own precedent for why the
 * model identifier itself stays out of telemetry).
 */
function logHealthSuggestionsProduced(
  request: FastifyRequest,
  photos: readonly ObservationPhotoResource[],
): void {
  const results = photos.flatMap((photo) => photo.analysisResults);
  if (results.length === 0) {
    return;
  }
  // Every key present, zero-valued ones included — the same "closed
  // vocabulary, always-all-keys" shape `suitabilityFindingCounts()`
  // (plants-inventory/transport/candidate-routes.ts) already establishes,
  // needed here so a log-based metric can extract any one class by a fixed
  // JSON path without that path being absent on lines where it didn't occur.
  const safetyClassCounts: Record<string, number> = {
    informational: 0,
    monitor: 0,
    expert_review_recommended: 0,
  };
  for (const result of results) {
    safetyClassCounts[result.safetyClass] = (safetyClassCounts[result.safetyClass] ?? 0) + 1;
  }
  request.log.info(
    {
      event: 'observations.health_suggestion_produced',
      analysisCount: results.length,
      requestedAdditionalEvidenceCount: results.filter((r) => r.requestedAdditionalEvidence).length,
      hasModelCount: results.filter((r) => r.modelName !== null).length,
      safetyClassCounts,
    },
    'Health suggestion(s) produced for attached photo(s)',
  );
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

    // P11-OBS-01: "journal capture completion" — counts and presence flags
    // only, never note/summary text, never a plant or garden-object id.
    request.log.info(
      {
        event: 'observations.recorded',
        hasPlant: observation.plantId !== null,
        photoCount: observation.photos.length,
        measurementCount: observation.measurements.length,
        hasNote: observation.noteText !== null,
        hasConditionSummary: observation.conditionSummary !== null,
        hasPhenologicalStage: observation.observedPhenologicalStage !== null,
      },
      'Observation recorded',
    );
    logHealthSuggestionsProduced(request, observation.photos);

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

    // P11-OBS-01: the correction half of `observations.recorded` — same
    // shape, distinguished by `correctionKind` (closed vocabulary:
    // `amendment`/`supersede`).
    request.log.info(
      {
        event: 'observations.corrected',
        correctionKind: correction.correctionKind,
        photoCount: correction.photos.length,
        measurementCount: correction.measurements.length,
      },
      'Observation correction recorded',
    );
    logHealthSuggestionsProduced(request, correction.photos);

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

  app.post(
    '/observations/analysis-results/:analysisResultId/disposition',
    async (request, reply) => {
      const analysisResultId = requireAnalysisResultId(request);
      const idempotencyKey = requireIdempotencyKey(request);
      const { disposition } = parseSetHealthSuggestionDispositionRequest(request.body);

      const result = await deps.setHealthSuggestionDisposition.execute(
        analysisResultId,
        request.actorContext.profileId,
        disposition,
        idempotencyKey,
      );

      // P11-OBS-01: "health-suggestion ... disposition" — closed vocabulary
      // only (`confirmed_externally`/`accepted_as_observation`/`rejected`/
      // `unresolved`), never the analysis result id or any content field.
      request.log.info(
        { event: 'observations.health_disposition_set', disposition: result.disposition },
        'Health-suggestion disposition set',
      );

      return reply.status(200).send(result);
    },
  );
}
