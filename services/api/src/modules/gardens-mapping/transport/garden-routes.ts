/**
 * Garden HTTP routes.
 *
 * Request validation here is hand-written against the same rules the OpenAPI
 * document declares (`packages/api-contracts/openapi.yaml`), not derived
 * from it automatically: Phase 1 did not build an OpenAPI-to-Fastify-schema
 * bridge (`service-health`'s routes carry no `schema` option either), and
 * building one is a distinct piece of infrastructure this phase does not
 * need to take on to deliver the first-garden vertical slice. A future phase
 * can replace these checks with generated Fastify schemas without changing
 * any handler's behavior.
 *
 * Source: packages/api-contracts/openapi.yaml, tag `Gardens`;
 * implementation-plan.md work package P2-API-01.
 */

import type { GardenListResult, Garden as GardenResource } from '@verdery/api-contracts';
import { IDEMPOTENCY_KEY_HEADER, IF_MATCH_HEADER, SharedErrorCode } from '@verdery/api-contracts';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { ValidationError } from '../../../platform/errors/application-error.js';
import type { ArchiveGarden } from '../application/archive-garden.js';
import type { CreateGarden } from '../application/create-garden.js';
import type { GetGarden } from '../application/get-garden.js';
import type { ListGardens } from '../application/list-gardens.js';
import type { RenameGarden } from '../application/rename-garden.js';
import type { RequestGardenDeletion } from '../application/request-garden-deletion.js';

export interface GardenRoutesDependencies {
  readonly listGardens: ListGardens;
  readonly createGarden: CreateGarden;
  readonly getGarden: GetGarden;
  readonly renameGarden: RenameGarden;
  readonly archiveGarden: ArchiveGarden;
  readonly requestGardenDeletion: RequestGardenDeletion;
}

// Matches `components.schemas.Uuid` in packages/api-contracts/openapi.yaml exactly.
// Exported for reuse by transport/map-routes.ts, rather than a second copy of
// the same regex and parsing logic.
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 50;

export function invalid(message: string, code: string, pointer: string): ValidationError {
  return new ValidationError(SharedErrorCode.RequestInvalid, message, {
    details: [{ code, pointer }],
  });
}

export function requireGardenId(request: FastifyRequest): string {
  const { gardenId } = request.params as { gardenId?: unknown };

  if (typeof gardenId !== 'string' || !UUID_PATTERN.test(gardenId)) {
    throw invalid('gardenId must be a UUID.', 'request.garden_id.invalid', '/gardenId');
  }

  return gardenId;
}

export function requireIdempotencyKey(request: FastifyRequest): string {
  const header = request.headers[IDEMPOTENCY_KEY_HEADER];
  const key = Array.isArray(header) ? header[0] : header;

  if (typeof key !== 'string' || !UUID_PATTERN.test(key)) {
    throw invalid(
      `${IDEMPOTENCY_KEY_HEADER} header must be a UUID.`,
      'request.idempotency_key.invalid',
      `/headers/${IDEMPOTENCY_KEY_HEADER}`,
    );
  }

  return key;
}

/**
 * Unwraps the quoted revision the `If-Match` contract parameter documents
 * (`"7"`). Exported for reuse by the plants-inventory, observations-history,
 * and tasks-recommendations transport layers (P4-CONTRACT-01), the same
 * `import`-not-redeclare reuse `UUID_PATTERN`/`requireGardenId`/
 * `requireIdempotencyKey`/`invalid` already have.
 */
export function requireExpectedRevision(request: FastifyRequest): number {
  // Node's own http types name "if-match" as a single value, never an array
  // — unlike Idempotency-Key and other headers with no built-in type, there
  // is no `Array.isArray` case to unwrap here.
  const raw = request.headers[IF_MATCH_HEADER];
  const unquoted = typeof raw === 'string' ? raw.replace(/^"|"$/g, '') : '';
  const revision = Number(unquoted);

  if (typeof raw !== 'string' || !Number.isInteger(revision) || revision < 1) {
    throw invalid(
      `${IF_MATCH_HEADER} header must be a quoted positive integer revision.`,
      'request.if_match.invalid',
      `/headers/${IF_MATCH_HEADER}`,
    );
  }

  return revision;
}

function requireName(request: FastifyRequest): string {
  const body = request.body as { name?: unknown } | undefined;

  if (typeof body?.name !== 'string') {
    throw invalid('name is required.', 'request.invalid', '/name');
  }

  return body.name;
}

function parseListQuery(request: FastifyRequest): {
  cursor: string | null;
  limit: number;
  nameQuery: string | null;
} {
  const query = request.query as { cursor?: unknown; limit?: unknown; nameQuery?: unknown };

  const cursor = typeof query.cursor === 'string' && query.cursor.length > 0 ? query.cursor : null;
  const nameQuery =
    typeof query.nameQuery === 'string' && query.nameQuery.length > 0 ? query.nameQuery : null;

  if (query.limit === undefined) {
    return { cursor, limit: DEFAULT_LIMIT, nameQuery };
  }

  const limit = Number(query.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw invalid(
      `limit must be between 1 and ${String(MAX_LIMIT)}.`,
      'request.limit.invalid',
      '/limit',
    );
  }

  return { cursor, limit, nameQuery };
}

function toGardenListResult(result: {
  items: readonly GardenResource[];
  nextCursor: string | null;
}): GardenListResult {
  return {
    items: [...result.items],
    ...(result.nextCursor === null ? {} : { nextCursor: result.nextCursor }),
  };
}

export function registerGardenRoutes(
  app: FastifyInstance,
  dependencies: GardenRoutesDependencies,
): void {
  app.get('/gardens', async (request, reply) => {
    const { cursor, limit, nameQuery } = parseListQuery(request);
    const result = await dependencies.listGardens.execute(
      request.actorContext.profileId,
      cursor,
      limit,
      nameQuery,
    );

    return reply.status(200).send(toGardenListResult(result));
  });

  app.post('/gardens', async (request, reply) => {
    const idempotencyKey = requireIdempotencyKey(request);
    const name = requireName(request);

    const garden = await dependencies.createGarden.execute(
      request.actorContext.profileId,
      name,
      idempotencyKey,
    );

    return reply.status(201).send(garden);
  });

  app.get('/gardens/:gardenId', async (request, reply) => {
    const gardenId = requireGardenId(request);
    const garden = await dependencies.getGarden.execute(gardenId, request.actorContext.profileId);

    return reply.status(200).send(garden);
  });

  app.patch('/gardens/:gardenId', async (request, reply) => {
    const gardenId = requireGardenId(request);
    const idempotencyKey = requireIdempotencyKey(request);
    const expectedRevision = requireExpectedRevision(request);
    const name = requireName(request);

    const garden = await dependencies.renameGarden.execute(
      gardenId,
      request.actorContext.profileId,
      name,
      expectedRevision,
      idempotencyKey,
    );

    return reply.status(200).send(garden);
  });

  app.post('/gardens/:gardenId/archive', async (request, reply) => {
    const gardenId = requireGardenId(request);
    const idempotencyKey = requireIdempotencyKey(request);
    const expectedRevision = requireExpectedRevision(request);

    const garden = await dependencies.archiveGarden.execute(
      gardenId,
      request.actorContext.profileId,
      expectedRevision,
      idempotencyKey,
    );

    return reply.status(200).send(garden);
  });

  app.post('/gardens/:gardenId/delete-request', async (request, reply) => {
    const gardenId = requireGardenId(request);
    const idempotencyKey = requireIdempotencyKey(request);
    const expectedRevision = requireExpectedRevision(request);

    const garden = await dependencies.requestGardenDeletion.execute(
      gardenId,
      request.actorContext.profileId,
      expectedRevision,
      idempotencyKey,
    );

    return reply.status(200).send(garden);
  });
}
