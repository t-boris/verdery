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
import type { AddCandidate } from '../application/add-candidate.js';
import type { ConvertCandidate } from '../application/convert-candidate.js';
import type { GetCandidate } from '../application/get-candidate.js';
import type { GetCandidateSuitability } from '../application/get-candidate-suitability.js';
import type { GetTaxonProfile } from '../application/get-taxon-profile.js';
import type { ListCandidates } from '../application/list-candidates.js';
import type { RecalculateCandidateSuitability } from '../application/recalculate-candidate-suitability.js';
import type { SetCandidateStatus } from '../application/set-candidate-status.js';
import type { UpdateCandidateDetails } from '../application/update-candidate-details.js';
import type { CandidateStatus } from '../domain/plant-candidate.js';
import {
  parseAddCandidateRequest,
  parseConvertCandidateRequest,
  parseSetCandidateStatusRequest,
  parseUpdateCandidateDetailsRequest,
} from './parse-candidate-request.js';

export interface CandidateRoutesDependencies {
  readonly addCandidate: AddCandidate;
  readonly listCandidates: ListCandidates;
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
function parseStatusFilter(request: FastifyRequest): readonly CandidateStatus[] | null {
  const raw = (request.query as { status?: unknown }).status;
  if (raw === undefined) {
    return null;
  }
  if (typeof raw !== 'string' || raw.length === 0) {
    throw invalid('/status must be a comma-separated list.', 'request.invalid', '/status');
  }

  return raw.split(',').map((candidate) => {
    if (!(CANDIDATE_STATUSES as readonly string[]).includes(candidate)) {
      throw invalid(
        `/status must be one of: ${CANDIDATE_STATUSES.join(', ')}.`,
        'request.enum.invalid',
        '/status',
      );
    }
    return candidate as CandidateStatus;
  });
}

function parseListCandidatesQuery(request: FastifyRequest): {
  status: readonly CandidateStatus[] | null;
  cursor: string | null;
  limit: number;
} {
  const status = parseStatusFilter(request);
  const raw = request.query as { cursor?: unknown; limit?: unknown };
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

  return { status, cursor, limit };
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

    return reply.status(201).send(candidate);
  });

  app.get('/gardens/:gardenId/plant-candidates', async (request, reply) => {
    const gardenId = requireGardenId(request);
    const { status, cursor, limit } = parseListCandidatesQuery(request);

    const page = await deps.listCandidates.execute(
      gardenId,
      request.actorContext.profileId,
      { status },
      cursor,
      limit,
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

      return reply.status(201).send(assessment);
    },
  );

  app.get('/plant-catalog/taxa/:taxonomyReferenceId/profile', async (request, reply) => {
    const taxonomyReferenceId = requireTaxonomyReferenceId(request);

    const profile = await deps.getTaxonProfile.execute(taxonomyReferenceId);

    return reply.status(200).send(profile);
  });
}
