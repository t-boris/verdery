/**
 * Client-invitation/access-grant HTTP routes (P9C-INVITE-01) — the
 * professional-side admin surface (list/create/revoke, engagement-scoped)
 * plus the client's own flat accept endpoint, mirroring
 * `invitation-routes.ts`'s identical create/list/revoke/accept shape for the
 * operational case.
 *
 * ACCEPTANCE TELEMETRY (P9C-OBS-01). `POST /client-invitations/accept` logs
 * exactly one structured line per call — `client_invitation.accept_completed`
 * on success (an outcome marker only — no content) or `authorization.denied`
 * on a denial, categorized by the grant's OWN error code
 * (`revoked`/`expired`/`already_accepted`/
 * `email_mismatch`/`engagement_not_active`/`not_found`) — UNLIKE
 * `client-portal-routes.ts`'s single `not_entitled` bucket, these codes are
 * not concealed from the client to begin with (`client-access-grant.ts`'s
 * own `assertClientAccessGrantAcceptable`/`assertClientEmailBindingSatisfied`
 * already return them distinctly — a client who holds a token already
 * knows the invitation exists), so reusing them here invents no new
 * distinction. Together these two events give BOTH "invitation acceptance
 * rate" (successes over attempts) and "invitation expiry rate"
 * (`reasonCategory: 'expired'` denials over attempts) from ONE
 * instrumentation point, per section 19 — no separate event is needed for
 * either. Never the token or the caller's email.
 *
 * Source: packages/api-contracts/openapi.yaml, tag `ClientAccess`;
 * implementation-plan.md work packages P9C-INVITE-01, P9C-OBS-01;
 * architecture/collaboration-and-client-sharing.md, section
 * "19. Audit and Observability".
 */

import {
  type AcceptClientInvitationRequest,
  ClientAccessGrantErrorCode,
  type ClientAccessGrant,
  type ClientAccessGrantListResult,
  type CreateClientInvitationRequest,
} from '@verdery/api-contracts';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { ApplicationError } from '../../../platform/errors/application-error.js';
import { logAuthorizationDenial } from '../../../platform/telemetry/authorization-denial-log.js';
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

/** Maps this surface's OWN (already client-visible, never concealed) error codes onto the shared denial vocabulary — `null` for anything this route does not treat as an authorization denial. */
function clientInvitationAcceptDenialReason(error: unknown): string | null {
  if (!(error instanceof ApplicationError)) {
    return null;
  }
  switch (error.code) {
    case ClientAccessGrantErrorCode.NotFound:
      return 'not_found';
    case ClientAccessGrantErrorCode.Revoked:
      return 'revoked';
    case ClientAccessGrantErrorCode.Expired:
      return 'expired';
    case ClientAccessGrantErrorCode.AlreadyAccepted:
      return 'already_accepted';
    case ClientAccessGrantErrorCode.EmailMismatch:
      return 'email_mismatch';
    case ClientAccessGrantErrorCode.EngagementNotActive:
      return 'engagement_not_active';
    default:
      return null;
  }
}

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

    let grant: ClientAccessGrant;
    try {
      grant = await dependencies.acceptClientInvitation.execute(
        {
          profileId: actorContext.profileId,
          email: actorContext.email,
          emailVerified: actorContext.emailVerified,
        },
        body.token,
        idempotencyKey,
      );
    } catch (error) {
      const reasonCategory = clientInvitationAcceptDenialReason(error);
      if (reasonCategory !== null) {
        logAuthorizationDenial(request.log, {
          surface: 'client_invitation_accept',
          reasonCategory,
          route: request.routeOptions?.url ?? request.url,
        });
      }
      throw error;
    }

    // P9C-OBS-01: "invitation acceptance ... rate" (section 19) — paired
    // with the denial log above (`reasonCategory: 'expired'` is the
    // "expiry rate" half), never the token or the caller's email.
    request.log.info(
      { event: 'client_invitation.accept_completed', engagementId: grant.engagementId },
      'Client invitation accepted',
    );

    return reply.status(200).send(grant);
  });
}
