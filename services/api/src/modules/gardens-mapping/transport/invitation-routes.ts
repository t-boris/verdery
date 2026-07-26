/**
 * Invitation HTTP routes (P9A-API-01).
 *
 * Hand-written request validation against the same rules
 * `packages/api-contracts/openapi.yaml` declares, matching this module's
 * existing transport layer (`garden-routes.ts`'s own header comment).
 *
 * Source: packages/api-contracts/openapi.yaml, tag `Collaboration`;
 * implementation-plan.md work package P9A-API-01.
 */

import type {
  AcceptInvitationRequest,
  CreateInvitationRequest,
  CreateInvitationResult,
  Invitation as InvitationResource,
  InvitationListResult,
} from '@verdery/api-contracts';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AcceptInvitation } from '../application/accept-invitation.js';
import type { CreateInvitation } from '../application/create-invitation.js';
import type { ListGardenInvitations } from '../application/list-garden-invitations.js';
import type { RevokeInvitation } from '../application/revoke-invitation.js';
import { invalid, requireGardenId, requireIdempotencyKey, UUID_PATTERN } from './garden-routes.js';

export interface InvitationRoutesDependencies {
  readonly createInvitation: CreateInvitation;
  readonly listGardenInvitations: ListGardenInvitations;
  readonly revokeInvitation: RevokeInvitation;
  readonly acceptInvitation: AcceptInvitation;
}

const INTENDED_ROLES = new Set(['editor', 'viewer']);

function requireInvitationId(request: FastifyRequest): string {
  const { invitationId } = request.params as { invitationId?: unknown };

  if (typeof invitationId !== 'string' || !UUID_PATTERN.test(invitationId)) {
    throw invalid('invitationId must be a UUID.', 'request.invitation_id.invalid', '/invitationId');
  }

  return invitationId;
}

function requireCreateInvitationBody(request: FastifyRequest): CreateInvitationRequest {
  const body = request.body as Partial<CreateInvitationRequest> | undefined;

  if (typeof body?.intendedRole !== 'string' || !INTENDED_ROLES.has(body.intendedRole)) {
    throw invalid('intendedRole must be "editor" or "viewer".', 'request.invalid', '/intendedRole');
  }
  if (body.intendedEmail !== undefined && typeof body.intendedEmail !== 'string') {
    throw invalid('intendedEmail must be a string.', 'request.invalid', '/intendedEmail');
  }

  return body as CreateInvitationRequest;
}

function requireAcceptInvitationBody(request: FastifyRequest): AcceptInvitationRequest {
  const body = request.body as Partial<AcceptInvitationRequest> | undefined;

  if (typeof body?.token !== 'string' || body.token.length === 0) {
    throw invalid('token is required.', 'request.invalid', '/token');
  }

  return body as AcceptInvitationRequest;
}

export function registerInvitationRoutes(
  app: FastifyInstance,
  dependencies: InvitationRoutesDependencies,
): void {
  app.post('/gardens/:gardenId/invitations', async (request, reply) => {
    const gardenId = requireGardenId(request);
    const idempotencyKey = requireIdempotencyKey(request);
    const body = requireCreateInvitationBody(request);

    const result: CreateInvitationResult = await dependencies.createInvitation.execute(
      gardenId,
      request.actorContext.profileId,
      body,
      idempotencyKey,
    );

    return reply.status(201).send(result);
  });

  app.get('/gardens/:gardenId/invitations', async (request, reply) => {
    const gardenId = requireGardenId(request);

    const result: InvitationListResult = await dependencies.listGardenInvitations.execute(
      gardenId,
      request.actorContext.profileId,
    );

    return reply.status(200).send(result);
  });

  app.post('/gardens/:gardenId/invitations/:invitationId/revoke', async (request, reply) => {
    const gardenId = requireGardenId(request);
    const invitationId = requireInvitationId(request);
    const idempotencyKey = requireIdempotencyKey(request);

    const result: InvitationResource = await dependencies.revokeInvitation.execute(
      gardenId,
      invitationId,
      request.actorContext.profileId,
      idempotencyKey,
    );

    return reply.status(200).send(result);
  });

  app.post('/invitations/accept', async (request, reply) => {
    const idempotencyKey = requireIdempotencyKey(request);
    const body = requireAcceptInvitationBody(request);
    const { actorContext } = request;

    const member = await dependencies.acceptInvitation.execute(
      {
        profileId: actorContext.profileId,
        email: actorContext.email,
        emailVerified: actorContext.emailVerified,
      },
      body.token,
      idempotencyKey,
    );

    return reply.status(200).send(member);
  });
}
