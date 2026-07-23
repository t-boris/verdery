/**
 * Synchronization HTTP routes: client installation registration, batched
 * push, pull, and acknowledge.
 *
 * `GET /sync/changes`'s query-parameter parsing is hand-written inline here,
 * not in `parse-sync-request.ts`: that file's own header comment scopes
 * itself to the three *body*-carrying routes (`PUT`/`POST`); a `GET` route
 * with only query parameters follows `garden-routes.ts`'s own
 * `parseListQuery` precedent instead — a small parser local to the route
 * file that owns it.
 *
 * Source: packages/api-contracts/openapi.yaml, tag `Synchronization`.
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  invalid,
  requireIdempotencyKey,
  UUID_PATTERN,
} from '../../gardens-mapping/transport/garden-routes.js';
import type { AcknowledgeSyncOperations } from '../application/acknowledge-sync-operations.js';
import type { GetSyncChanges, GetSyncChangesRequest } from '../application/get-sync-changes.js';
import type { PushSyncOperations } from '../application/push-sync-operations.js';
import type { RegisterSyncClient } from '../application/register-sync-client.js';
import {
  parseSyncAcknowledgeRequest,
  parseSyncClientRegistrationRequest,
  parseSyncPushRequest,
} from './parse-sync-request.js';

export interface SyncRoutesDependencies {
  readonly registerSyncClient: RegisterSyncClient;
  readonly pushSyncOperations: PushSyncOperations;
  readonly getSyncChanges: GetSyncChanges;
  readonly acknowledgeSyncOperations: AcknowledgeSyncOperations;
}

// Matches `#/components/parameters/Limit` in packages/api-contracts/openapi.yaml.
const MAX_CHANGES_LIMIT = 100;
const DEFAULT_CHANGES_LIMIT = 50;

function parseSyncChangesQuery(request: FastifyRequest): GetSyncChangesRequest {
  const query = request.query as { after?: unknown; limit?: unknown; protocolVersion?: unknown };

  const after = typeof query.after === 'string' && query.after.length > 0 ? query.after : null;

  if (query.protocolVersion === undefined) {
    throw invalid(
      'protocolVersion is required.',
      'request.protocol_version.invalid',
      '/protocolVersion',
    );
  }
  const protocolVersion = Number(query.protocolVersion);
  if (!Number.isInteger(protocolVersion) || protocolVersion < 1) {
    throw invalid(
      'protocolVersion must be a positive integer.',
      'request.protocol_version.invalid',
      '/protocolVersion',
    );
  }

  if (query.limit === undefined) {
    return { after, limit: DEFAULT_CHANGES_LIMIT, protocolVersion };
  }
  const limit = Number(query.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_CHANGES_LIMIT) {
    throw invalid(
      `limit must be between 1 and ${String(MAX_CHANGES_LIMIT)}.`,
      'request.limit.invalid',
      '/limit',
    );
  }

  return { after, limit, protocolVersion };
}

function requireClientInstallationId(request: FastifyRequest): string {
  const { clientInstallationId } = request.params as { clientInstallationId?: unknown };

  if (typeof clientInstallationId !== 'string' || !UUID_PATTERN.test(clientInstallationId)) {
    throw invalid(
      'clientInstallationId must be a UUID.',
      'request.client_installation_id.invalid',
      '/clientInstallationId',
    );
  }

  return clientInstallationId;
}

export function registerSyncRoutes(
  app: FastifyInstance,
  dependencies: SyncRoutesDependencies,
): void {
  app.put('/sync/clients/:clientInstallationId', async (request, reply) => {
    const clientInstallationId = requireClientInstallationId(request);
    const idempotencyKey = requireIdempotencyKey(request);
    const body = parseSyncClientRegistrationRequest(request.body);

    const { statusCode, installation } = await dependencies.registerSyncClient.execute(
      clientInstallationId,
      request.actorContext.profileId,
      body,
      idempotencyKey,
    );

    return reply.status(statusCode).send(installation);
  });

  app.post('/sync/push', async (request, reply) => {
    const body = parseSyncPushRequest(request.body);

    const result = await dependencies.pushSyncOperations.execute(
      request.actorContext.profileId,
      body,
    );

    // Always `200` — an individual operation conflicting, being rejected, or
    // being blocked never fails the whole batch, per the OpenAPI operation's
    // own description.
    return reply.status(200).send(result);
  });

  app.get('/sync/changes', async (request, reply) => {
    const query = parseSyncChangesQuery(request);

    const result = await dependencies.getSyncChanges.execute(request.actorContext.profileId, query);

    return reply.status(200).send(result);
  });

  app.post('/sync/acknowledge', async (request, reply) => {
    const body = parseSyncAcknowledgeRequest(request.body);

    const result = await dependencies.acknowledgeSyncOperations.execute(
      request.actorContext.profileId,
      body,
    );

    return reply.status(200).send(result);
  });
}
