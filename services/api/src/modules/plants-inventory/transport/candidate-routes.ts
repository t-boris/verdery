/**
 * Plant-candidate, conversion, suitability, and taxon-profile HTTP routes —
 * the same hand-written-validation convention `garden-routes.ts`'s own
 * header comment describes, reusing its exported `UUID_PATTERN`/`invalid`/
 * `requireGardenId`/`requireIdempotencyKey`/`requireExpectedRevision`
 * rather than a second copy of the same logic (see `plant-routes.ts`'s
 * identical precedent).
 *
 * `getTaxonProfile` is intentionally NOT `gardenId`-scoped: it lives under
 * `/plant-catalog/taxa/...`, a shared reference resource, not a garden's
 * own data — see `GetTaxonProfile`'s own doc comment.
 *
 * Source: packages/api-contracts/openapi.yaml, tags `PlantCandidates`,
 * `PlantCatalog`; implementation-plan.md work package P11-API-01.
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  UUID_PATTERN,
  invalid,
  requireExpectedRevision,
  requireGardenId,
  requireIdempotencyKey,
} from '../../gardens-mapping/transport/garden-routes.js';
import type { AddCandidateFromPhoto } from '../application/add-candidate-from-photo.js';
import type { AddCandidate } from '../application/add-candidate.js';
import type { ConvertCandidate } from '../application/convert-candidate.js';
import type { GetCandidate } from '../application/get-candidate.js';
import type { GetCandidateSuitability } from '../application/get-candidate-suitability.js';
import type { GetTaxonProfile } from '../application/get-taxon-profile.js';
import type { ListCandidatePhotos } from '../application/list-candidate-photos.js';
import type { ListCandidates } from '../application/list-candidates.js';
import type { RecalculateCandidateSuitability } from '../application/recalculate-candidate-suitability.js';
import type { SetCandidateStatus } from '../application/set-candidate-status.js';
import type { UpdateCandidateDetails } from '../application/update-candidate-details.js';
import type { CandidatePriority, CandidateStatus } from '../domain/plant-candidate.js';
import {
  CANDIDATE_PRIORITIES,
  parseAddCandidateFromPhotoRequest,
  parseAddCandidateRequest,
  parseConvertCandidateRequest,
  parseSetCandidateStatusRequest,
  parseUpdateCandidateDetailsRequest,
} from './parse-candidate-request.js';
import type { ListCandidatesFilters } from '../application/list-candidates.js';
import {
  findingsOfCategory,
  type SuitabilityAssessmentResult,
  type SuitabilityFinding,
} from '../domain/suitability-finding.js';

export interface CandidateRoutesDependencies {
  readonly addCandidate: AddCandidate;
  readonly addCandidateFromPhoto: AddCandidateFromPhoto;
  readonly listCandidates: ListCandidates;
  readonly listCandidatePhotos: ListCandidatePhotos;
  readonly getCandidate: GetCandidate;
  readonly updateCandidateDetails: UpdateCandidateDetails;
  readonly setCandidateStatus: SetCandidateStatus;
  readonly convertCandidate: ConvertCandidate;
  readonly getCandidateSuitability: GetCandidateSuitability;
  readonly recalculateCandidateSuitability: RecalculateCandidateSuitability;
  readonly getTaxonProfile: GetTaxonProfile;
}

const CANDIDATE_STATUSES: readonly CandidateStatus[] = [
  'active',
  'converted',
  'archived',
  'rejected',
];
const MAX_LIST_CANDIDATES_LIMIT = 100;
const DEFAULT_LIST_CANDIDATES_LIMIT = 50;

/** P11-OBS-01: per-category finding counts for `plants.candidate_suitability_reviewed` — a closed-vocabulary breakdown, never a finding's own axis/evidence text. */
function suitabilityFindingCounts(
  assessment: SuitabilityAssessmentResult,
): Record<SuitabilityFinding['category'], number> {
  return {
    match: findingsOfCategory(assessment, 'match').length,
    caution: findingsOfCategory(assessment, 'caution').length,
    blocker: findingsOfCategory(assessment, 'blocker').length,
    unknown: findingsOfCategory(assessment, 'unknown').length,
    assumption: findingsOfCategory(assessment, 'assumption').length,
  };
}

function requireCandidateId(request: FastifyRequest): string {
  const { candidateId } = request.params as { candidateId?: unknown };

  if (typeof candidateId !== 'string' || !UUID_PATTERN.test(candidateId)) {
    throw invalid('candidateId must be a UUID.', 'request.candidate_id.invalid', '/candidateId');
  }

  return candidateId;
}

function requireTaxonomyReferenceId(request: FastifyRequest): string {
  const { taxonomyReferenceId } = request.params as { taxonomyReferenceId?: unknown };

  if (typeof taxonomyReferenceId !== 'string' || !UUID_PATTERN.test(taxonomyReferenceId)) {
    throw invalid(
      'taxonomyReferenceId must be a UUID.',
      'request.taxonomy_reference_id.invalid',
      '/taxonomyReferenceId',
    );
  }

  return taxonomyReferenceId;
}

/** Mirrors `plant-routes.ts`'s own `parseCommaSeparatedEnum`, kept local since it is this file's only caller. */
function parseCommaSeparatedEnum<T extends string>(
  raw: unknown,
  allowed: readonly T[],
  pointer: string,
): readonly T[] | undefined {
  if (raw === undefined) {
    return undefined;
  }
  if (typeof raw !== 'string' || raw.length === 0) {
    throw invalid(`${pointer} must be a comma-separated list.`, 'request.invalid', pointer);
  }

  return raw.split(',').map((candidate) => {
    if (!(allowed as readonly string[]).includes(candidate)) {
      throw invalid(
        `${pointer} must be one of: ${allowed.join(', ')}.`,
        'request.enum.invalid',
        pointer,
      );
    }
    return candidate as T;
  });
}

function parseIdentifiedFilter(raw: unknown): boolean | undefined {
  if (raw === undefined) {
    return undefined;
  }
  if (raw !== 'true' && raw !== 'false') {
    throw invalid('/identified must be "true" or "false".', 'request.invalid', '/identified');
  }
  return raw === 'true';
}

function parseListCandidatesQuery(request: FastifyRequest): {
  filters: ListCandidatesFilters;
  cursor: string | null;
  limit: number;
} {
  const raw = request.query as {
    query?: unknown;
    status?: unknown;
    priority?: unknown;
    identified?: unknown;
    cursor?: unknown;
    limit?: unknown;
  };

  const query = typeof raw.query === 'string' && raw.query.length > 0 ? raw.query : null;
  const status = parseCommaSeparatedEnum<CandidateStatus>(
    raw.status,
    CANDIDATE_STATUSES,
    '/status',
  );
  const priority = parseCommaSeparatedEnum<CandidatePriority>(
    raw.priority,
    CANDIDATE_PRIORITIES,
    '/priority',
  );
  const identified = parseIdentifiedFilter(raw.identified);
  const cursor = typeof raw.cursor === 'string' && raw.cursor.length > 0 ? raw.cursor : null;

  let limit = DEFAULT_LIST_CANDIDATES_LIMIT;
  if (raw.limit !== undefined) {
    const parsedLimit = Number(raw.limit);
    if (
      !Number.isInteger(parsedLimit) ||
      parsedLimit < 1 ||
      parsedLimit > MAX_LIST_CANDIDATES_LIMIT
    ) {
      throw invalid(
        `limit must be between 1 and ${String(MAX_LIST_CANDIDATES_LIMIT)}.`,
        'request.limit.invalid',
        '/limit',
      );
    }
    limit = parsedLimit;
  }

  return {
    filters: {
      query,
      ...(status === undefined ? {} : { status }),
      ...(priority === undefined ? {} : { priority }),
      ...(identified === undefined ? {} : { identified }),
    },
    cursor,
    limit,
  };
}

export function registerCandidateRoutes(
  app: FastifyInstance,
  deps: CandidateRoutesDependencies,
): void {
  app.post('/gardens/:gardenId/plant-candidates', async (request, reply) => {
    const gardenId = requireGardenId(request);
    const idempotencyKey = requireIdempotencyKey(request);
    const input = parseAddCandidateRequest(request.body);

    const candidate = await deps.addCandidate.execute(
      gardenId,
      request.actorContext.profileId,
      input,
      idempotencyKey,
    );

    // P11-OBS-01: "actual-versus-candidate additions" — the candidate half
    // of the pair `plants.actual_created` establishes for actual plants.
    request.log.info(
      {
        event: 'plants.candidate_added',
        kind: 'candidate',
        groupingKind: candidate.groupingKind,
        identified: candidate.taxonomyReferenceId !== null,
        hasPriority: candidate.priority !== null,
        isAlternative: candidate.alternativeToCandidateId !== null,
      },
      'Plant candidate added',
    );

    return reply.status(201).send(candidate);
  });

  app.post('/gardens/:gardenId/plant-candidates/from-photo', async (request, reply) => {
    const gardenId = requireGardenId(request);
    const idempotencyKey = requireIdempotencyKey(request);
    const input = parseAddCandidateFromPhotoRequest(request.body);

    const candidate = await deps.addCandidateFromPhoto.execute(
      gardenId,
      request.actorContext.profileId,
      input,
      idempotencyKey,
    );

    request.log.info(
      {
        event: 'plants.candidate_added',
        kind: 'candidate',
        groupingKind: candidate.groupingKind,
        identified: candidate.taxonomyReferenceId !== null,
        hasPriority: candidate.priority !== null,
        isAlternative: candidate.alternativeToCandidateId !== null,
      },
      'Plant candidate added from photo',
    );

    return reply.status(201).send(candidate);
  });

  app.get('/gardens/:gardenId/plant-candidates', async (request, reply) => {
    const gardenId = requireGardenId(request);
    const { filters, cursor, limit } = parseListCandidatesQuery(request);

    const page = await deps.listCandidates.execute(
      gardenId,
      request.actorContext.profileId,
      filters,
      cursor,
      limit,
    );

    // P11-OBS-01: "search success, zero results, filter use" — the
    // candidate-list half of the pair `plants.search_completed` establishes
    // for the plant search route.
    request.log.info(
      {
        event: 'plants.candidates_listed',
        resultCount: page.items.length,
        isZeroResult: page.items.length === 0,
        hasQueryText: filters.query !== undefined && filters.query !== null,
        hasStatusFilter: filters.status !== undefined,
        hasPriorityFilter: filters.priority !== undefined,
        hasIdentifiedFilter: filters.identified !== undefined && filters.identified !== null,
      },
      'Plant candidates listed',
    );

    return reply.status(200).send({
      items: [...page.items],
      ...(page.nextCursor === null ? {} : { nextCursor: page.nextCursor }),
    });
  });

  app.get('/gardens/:gardenId/plant-candidates/:candidateId', async (request, reply) => {
    const gardenId = requireGardenId(request);
    const candidateId = requireCandidateId(request);

    const candidate = await deps.getCandidate.execute(
      gardenId,
      candidateId,
      request.actorContext.profileId,
    );

    return reply.status(200).send(candidate);
  });

  app.get('/gardens/:gardenId/plant-candidates/:candidateId/photos', async (request, reply) => {
    const gardenId = requireGardenId(request);
    const candidateId = requireCandidateId(request);

    const photos = await deps.listCandidatePhotos.execute(
      gardenId,
      candidateId,
      request.actorContext.profileId,
    );

    return reply.status(200).send({ items: [...photos] });
  });

  app.patch('/gardens/:gardenId/plant-candidates/:candidateId', async (request, reply) => {
    requireGardenId(request);
    const candidateId = requireCandidateId(request);
    const idempotencyKey = requireIdempotencyKey(request);
    const expectedRevision = requireExpectedRevision(request);
    const changes = parseUpdateCandidateDetailsRequest(request.body);

    const candidate = await deps.updateCandidateDetails.execute(
      candidateId,
      request.actorContext.profileId,
      expectedRevision,
      changes,
      idempotencyKey,
    );

    return reply.status(200).send(candidate);
  });

  app.post('/gardens/:gardenId/plant-candidates/:candidateId/status', async (request, reply) => {
    requireGardenId(request);
    const candidateId = requireCandidateId(request);
    const idempotencyKey = requireIdempotencyKey(request);
    const expectedRevision = requireExpectedRevision(request);
    const newStatus = parseSetCandidateStatusRequest(request.body);

    const candidate = await deps.setCandidateStatus.execute(
      candidateId,
      request.actorContext.profileId,
      expectedRevision,
      newStatus,
      idempotencyKey,
    );

    return reply.status(200).send(candidate);
  });

  app.post('/gardens/:gardenId/plant-candidates/:candidateId/convert', async (request, reply) => {
    requireGardenId(request);
    const candidateId = requireCandidateId(request);
    const idempotencyKey = requireIdempotencyKey(request);
    const expectedRevision = requireExpectedRevision(request);
    const input = parseConvertCandidateRequest(request.body);

    const result = await deps.convertCandidate.execute(
      candidateId,
      request.actorContext.profileId,
      expectedRevision,
      input,
      idempotencyKey,
    );

    // P11-OBS-01: "candidate suitability review and conversion" — the
    // conversion half. `hasPriority` is the same signal
    // `plants.candidate_added` already records, carried through to see
    // whether higher-priority candidates convert at a different rate.
    request.log.info(
      {
        event: 'plants.candidate_converted',
        groupingKind: result.candidate.groupingKind,
        hasPriority: result.candidate.priority !== null,
      },
      'Plant candidate converted',
    );

    return reply.status(201).send(result);
  });

  app.get(
    '/gardens/:gardenId/plant-candidates/:candidateId/suitability',
    async (request, reply) => {
      const gardenId = requireGardenId(request);
      const candidateId = requireCandidateId(request);

      const assessment = await deps.getCandidateSuitability.execute(
        gardenId,
        candidateId,
        request.actorContext.profileId,
      );

      // P11-OBS-01: "candidate suitability review" — the read half. Finding
      // counts per closed category only, never a finding's own axis/
      // evidence text or the candidate/garden id.
      request.log.info(
        {
          event: 'plants.candidate_suitability_reviewed',
          recalculated: false,
          findingCounts: suitabilityFindingCounts(assessment),
        },
        'Candidate suitability assessment read',
      );

      return reply.status(200).send(assessment);
    },
  );

  app.post(
    '/gardens/:gardenId/plant-candidates/:candidateId/suitability',
    async (request, reply) => {
      requireGardenId(request);
      const candidateId = requireCandidateId(request);

      const assessment = await deps.recalculateCandidateSuitability.execute(
        candidateId,
        request.actorContext.profileId,
      );

      request.log.info(
        {
          event: 'plants.candidate_suitability_reviewed',
          recalculated: true,
          findingCounts: suitabilityFindingCounts(assessment),
        },
        'Candidate suitability assessment recalculated',
      );

      return reply.status(201).send(assessment);
    },
  );

  app.get('/plant-catalog/taxa/:taxonomyReferenceId/profile', async (request, reply) => {
    const taxonomyReferenceId = requireTaxonomyReferenceId(request);

    const profile = await deps.getTaxonProfile.execute(taxonomyReferenceId);

    return reply.status(200).send(profile);
  });
}
