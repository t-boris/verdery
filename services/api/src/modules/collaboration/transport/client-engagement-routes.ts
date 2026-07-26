/**
 * Client-engagement HTTP routes (P9B-API-01) — the organization-scoped
 * listing plus the flat `/client-engagements` lifecycle routes
 * (architecture/collaboration-and-client-sharing.md section 13's own API
 * surface list).
 *
 * Source: packages/api-contracts/openapi.yaml, tag `Organizations`;
 * implementation-plan.md work package P9B-API-01.
 */

import type {
  ClientEngagement,
  ClientEngagementListResult,
  CreateClientEngagementRequest,
  RevokeClientEngagementRequest,
} from '@verdery/api-contracts';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ActivateClientEngagement } from '../application/activate-client-engagement.js';
import type { CreateClientEngagementInput } from '../application/create-client-engagement.js';
import type { CreateClientEngagement } from '../application/create-client-engagement.js';
import type { EndClientEngagement } from '../application/end-client-engagement.js';
import type { ListClientEngagementsForOrganization } from '../application/list-client-engagements-for-organization.js';
import type { RevokeClientEngagement } from '../application/revoke-client-engagement.js';
import {
  invalid,
  requireEngagementId,
  requireIdempotencyKey,
  requireOrganizationId,
  UUID_PATTERN,
} from './route-helpers.js';

export interface ClientEngagementRoutesDependencies {
  readonly listClientEngagementsForOrganization: ListClientEngagementsForOrganization;
  readonly createClientEngagement: CreateClientEngagement;
  readonly activateClientEngagement: ActivateClientEngagement;
  readonly endClientEngagement: EndClientEngagement;
  readonly revokeClientEngagement: RevokeClientEngagement;
}

const STEWARDSHIP_POLICIES = new Set(['residential']);

function requireCreateEngagementBody(request: FastifyRequest): CreateClientEngagementInput {
  const body = request.body as Partial<CreateClientEngagementRequest> | undefined;

  if (typeof body?.gardenId !== 'string' || !UUID_PATTERN.test(body.gardenId)) {
    throw invalid('gardenId must be a UUID.', 'request.invalid', '/gardenId');
  }
  if (
    body.serviceOrganizationId !== undefined &&
    (typeof body.serviceOrganizationId !== 'string' ||
      !UUID_PATTERN.test(body.serviceOrganizationId))
  ) {
    throw invalid(
      'serviceOrganizationId must be a UUID.',
      'request.invalid',
      '/serviceOrganizationId',
    );
  }
  if (body.stewardshipPolicy !== undefined && !STEWARDSHIP_POLICIES.has(body.stewardshipPolicy)) {
    throw invalid(
      'stewardshipPolicy must be "residential".',
      'request.invalid',
      '/stewardshipPolicy',
    );
  }
  if (
    body.clientNotificationsEnabled !== undefined &&
    typeof body.clientNotificationsEnabled !== 'boolean'
  ) {
    throw invalid(
      'clientNotificationsEnabled must be a boolean.',
      'request.invalid',
      '/clientNotificationsEnabled',
    );
  }

  return {
    gardenId: body.gardenId,
    ...(body.serviceOrganizationId === undefined
      ? {}
      : { serviceOrganizationId: body.serviceOrganizationId }),
    ...(body.stewardshipPolicy === undefined ? {} : { stewardshipPolicy: body.stewardshipPolicy }),
    ...(body.clientNotificationsEnabled === undefined
      ? {}
      : { clientNotificationsEnabled: body.clientNotificationsEnabled }),
  };
}

function parseRevokeReason(request: FastifyRequest): string | null {
  const body = request.body as Partial<RevokeClientEngagementRequest> | undefined;

  if (body?.reason === undefined) {
    return null;
  }
  if (typeof body.reason !== 'string') {
    throw invalid('reason must be a string.', 'request.invalid', '/reason');
  }

  return body.reason;
}

export function registerClientEngagementRoutes(
  app: FastifyInstance,
  dependencies: ClientEngagementRoutesDependencies,
): void {
  app.get('/service-organizations/:organizationId/client-engagements', async (request, reply) => {
    const organizationId = requireOrganizationId(request);

    const result: ClientEngagementListResult =
      await dependencies.listClientEngagementsForOrganization.execute(
        organizationId,
        request.actorContext.profileId,
      );

    return reply.status(200).send(result);
  });

  app.post('/client-engagements', async (request, reply) => {
    const idempotencyKey = requireIdempotencyKey(request);
    const body = requireCreateEngagementBody(request);

    const engagement: ClientEngagement = await dependencies.createClientEngagement.execute(
      body,
      request.actorContext.profileId,
      idempotencyKey,
    );

    return reply.status(201).send(engagement);
  });

  app.post('/client-engagements/:engagementId/activate', async (request, reply) => {
    const engagementId = requireEngagementId(request);
    const idempotencyKey = requireIdempotencyKey(request);

    const engagement: ClientEngagement = await dependencies.activateClientEngagement.execute(
      engagementId,
      request.actorContext.profileId,
      idempotencyKey,
    );

    return reply.status(200).send(engagement);
  });

  app.post('/client-engagements/:engagementId/end', async (request, reply) => {
    const engagementId = requireEngagementId(request);
    const idempotencyKey = requireIdempotencyKey(request);

    const engagement: ClientEngagement = await dependencies.endClientEngagement.execute(
      engagementId,
      request.actorContext.profileId,
      idempotencyKey,
    );

    return reply.status(200).send(engagement);
  });

  app.post('/client-engagements/:engagementId/revoke', async (request, reply) => {
    const engagementId = requireEngagementId(request);
    const idempotencyKey = requireIdempotencyKey(request);
    const reason = parseRevokeReason(request);

    const engagement: ClientEngagement = await dependencies.revokeClientEngagement.execute(
      engagementId,
      request.actorContext.profileId,
      reason,
      idempotencyKey,
    );

    return reply.status(200).send(engagement);
  });
}
