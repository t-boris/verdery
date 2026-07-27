/**
 * Client-invitation/access-grant HTTP routes (P9C-INVITE-01) — the
 * professional-side admin surface (list/create/revoke, engagement-scoped)
 * plus the client's own flat accept endpoint, mirroring
 * `invitation-routes.ts`'s identical create/list/revoke/accept shape for the
 * operational case.
 *
 * Source: packages/api-contracts/openapi.yaml, tag `ClientAccess`;
 * implementation-plan.md work package P9C-INVITE-01.
 */

import type {
  AcceptClientInvitationRequest,
  ClientAccessGrant,
  ClientAccessGrantListResult,
  CreateClientInvitationRequest,
} from '@verdery/api-contracts';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AcceptClientInvitation } from '../application/accept-client-invitation.js';
import type { CreateClientInvitation } from '../application/create-client-invitation.js';
import type { ListClientInvitationsForEngagement } from '../application/list-client-invitations-for-engagement.js';
import type { RevokeClientInvitation } from '../application/revoke-client-invitation.js';
import {
  invalid,
  requireEngagementId,
  requireGrantId,
  requireIdempotencyKey,
} from './route-helpers.js';

export interface ClientInvitationRoutesDependencies {
  readonly listClientInvitations: ListClientInvitationsForEngagement;
  readonly createClientInvitation: CreateClientInvitation;
  readonly revokeClientInvitation: RevokeClientInvitation;
  readonly acceptClientInvitation: AcceptClientInvitation;
}

function requireCreateInvitationBody(request: FastifyRequest): CreateClientInvitationRequest {
  const body = request.body as Partial<CreateClientInvitationRequest> | undefined;

  if (typeof body?.email !== 'string' || body.email.trim().length === 0) {
    throw invalid('email is required.', 'request.invalid', '/email');
  }

  return { email: body.email };
}

function requireAcceptInvitationBody(request: FastifyRequest): AcceptClientInvitationRequest {
  const body = request.body as Partial<AcceptClientInvitationRequest> | undefined;

  if (typeof body?.token !== 'string' || body.token.length === 0) {
    throw invalid('token is required.', 'request.invalid', '/token');
  }

  return { token: body.token };
}

export function registerClientInvitationRoutes(
  app: FastifyInstance,
  dependencies: ClientInvitationRoutesDependencies,
): void {
  app.get('/client-engagements/:engagementId/client-invitations', async (request, reply) => {
    const engagementId = requireEngagementId(request);

    const result: ClientAccessGrantListResult = await dependencies.listClientInvitations.execute(
      engagementId,
      request.actorContext.profileId,
    );

    return reply.status(200).send(result);
  });

  app.post('/client-engagements/:engagementId/client-invitations', async (request, reply) => {
    const engagementId = requireEngagementId(request);
    const idempotencyKey = requireIdempotencyKey(request);
    const body = requireCreateInvitationBody(request);

    const grant: ClientAccessGrant = await dependencies.createClientInvitation.execute(
      engagementId,
      body.email,
      request.actorContext.profileId,
      idempotencyKey,
    );

    return reply.status(201).send(grant);
  });

  app.post(
    '/client-engagements/:engagementId/client-invitations/:grantId/revoke',
    async (request, reply) => {
      const engagementId = requireEngagementId(request);
      const grantId = requireGrantId(request);
      const idempotencyKey = requireIdempotencyKey(request);

      const grant: ClientAccessGrant = await dependencies.revokeClientInvitation.execute(
        engagementId,
        grantId,
        request.actorContext.profileId,
        idempotencyKey,
      );

      return reply.status(200).send(grant);
    },
  );

  app.post('/client-invitations/accept', async (request, reply) => {
    const idempotencyKey = requireIdempotencyKey(request);
    const body = requireAcceptInvitationBody(request);
    const { actorContext } = request;

    const grant = await dependencies.acceptClientInvitation.execute(
      {
        profileId: actorContext.profileId,
        email: actorContext.email,
        emailVerified: actorContext.emailVerified,
      },
      body.token,
      idempotencyKey,
    );

    return reply.status(200).send(grant);
  });
}
