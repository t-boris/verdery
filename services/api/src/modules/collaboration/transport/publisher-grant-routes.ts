/**
 * Publisher-grant HTTP routes (P9C-PUBLISH-01) — the separate publisher
 * capability's own admin surface: list, grant, revoke.
 *
 * Source: packages/api-contracts/openapi.yaml, tag `Publications`;
 * implementation-plan.md work package P9C-PUBLISH-01.
 */

import type {
  GrantPublisherAccessRequest,
  PublisherGrant,
  PublisherGrantListResult,
} from '@verdery/api-contracts';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { GrantPublisherAccess } from '../application/grant-publisher-access.js';
import type { ListPublisherGrantsForEngagement } from '../application/list-publisher-grants-for-engagement.js';
import type { RevokePublisherAccess } from '../application/revoke-publisher-access.js';
import {
  invalid,
  requireEngagementId,
  requireIdempotencyKey,
  requireProfileId,
  UUID_PATTERN,
} from './route-helpers.js';

export interface PublisherGrantRoutesDependencies {
  readonly listPublisherGrants: ListPublisherGrantsForEngagement;
  readonly grantPublisherAccess: GrantPublisherAccess;
  readonly revokePublisherAccess: RevokePublisherAccess;
}

function requireGrantBody(request: FastifyRequest): GrantPublisherAccessRequest {
  const body = request.body as Partial<GrantPublisherAccessRequest> | undefined;

  if (typeof body?.profileId !== 'string' || !UUID_PATTERN.test(body.profileId)) {
    throw invalid('profileId must be a UUID.', 'request.invalid', '/profileId');
  }

  return { profileId: body.profileId };
}

export function registerPublisherGrantRoutes(
  app: FastifyInstance,
  dependencies: PublisherGrantRoutesDependencies,
): void {
  app.get('/client-engagements/:engagementId/publishers', async (request, reply) => {
    const engagementId = requireEngagementId(request);

    const result: PublisherGrantListResult = await dependencies.listPublisherGrants.execute(
      engagementId,
      request.actorContext.profileId,
    );

    return reply.status(200).send(result);
  });

  app.post('/client-engagements/:engagementId/publishers', async (request, reply) => {
    const engagementId = requireEngagementId(request);
    const idempotencyKey = requireIdempotencyKey(request);
    const body = requireGrantBody(request);

    const grant: PublisherGrant = await dependencies.grantPublisherAccess.execute(
      engagementId,
      body.profileId,
      request.actorContext.profileId,
      idempotencyKey,
    );

    return reply.status(201).send(grant);
  });

  app.delete('/client-engagements/:engagementId/publishers/:profileId', async (request, reply) => {
    const engagementId = requireEngagementId(request);
    const targetProfileId = requireProfileId(request);
    const idempotencyKey = requireIdempotencyKey(request);

    const grant: PublisherGrant = await dependencies.revokePublisherAccess.execute(
      engagementId,
      targetProfileId,
      request.actorContext.profileId,
      idempotencyKey,
    );

    return reply.status(200).send(grant);
  });
}
