/**
 * Synchronization HTTP routes: client installation registration, batched
 * push, and acknowledge. Pull (`GET /v1/sync/changes`) is P5-BE-02's concern,
 * not built this stage — see this module's `public.ts` doc comment.
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
  readonly acknowledgeSyncOperations: AcknowledgeSyncOperations;
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

  app.post('/sync/acknowledge', async (request, reply) => {
    const body = parseSyncAcknowledgeRequest(request.body);

    const result = await dependencies.acknowledgeSyncOperations.execute(
      request.actorContext.profileId,
      body,
    );

    return reply.status(200).send(result);
  });
}
