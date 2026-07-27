/**
 * `GET /client/publications/{publicationId}/media/{mediaId}/access`
 * (P9C-API-01) — a thin transport wrapper around the already-built, already-
 * tested `GetClientMediaAccess` command (P9C-MEDIA-01). This file adds NO
 * authorization logic: it validates that both path parameters are
 * well-formed UUIDs (this module's own established convention — see
 * `media-routes.ts`'s identical `requireGardenId`/`requireMediaId` inline
 * helpers) and calls the command with the caller's own authenticated
 * profile id plus `mediaId`, nothing else.
 *
 * `publicationId` IS NOT AN AUTHORIZATION INPUT, DELIBERATELY. It is
 * validated as a well-formed identifier so the URL matches architecture
 * section 13's own path shape, but it is never passed to
 * `GetClientMediaAccess.execute`, which takes only `(clientProfileId,
 * mediaId)` — read that command's own header, "CHECK 5 IS RESOLVED FIRST,
 * STRUCTURALLY" / "WHY THE ... READ IS ANCHORED ON THE ENTITLEMENT", before
 * changing this. The `media_entitlement` row `mediaId` resolves to already
 * names its OWN engagement and publication version unambiguously; a second
 * read to confirm `publicationId` matches would duplicate a fact that
 * command's own single query already establishes, and would not be a new
 * security property (the caller must already hold an active grant on
 * whichever engagement genuinely entitles this exact media object,
 * regardless of what `publicationId` claims). A stale, mismatched, or
 * fabricated `publicationId` alongside a genuinely entitled `mediaId`
 * therefore still succeeds — the identical "operational identifiers are
 * not accepted as authority" posture every other `ClientPortal` route
 * takes, applied here to a path segment that carries no authority at all.
 *
 * DENIAL TELEMETRY (P9C-OBS-01). A denied call — `MediaErrorCode.NotFound`
 * (checks 2-5 folded together, concealed by `GetClientMediaAccess`'s own
 * design — see that class's header) or `MediaErrorCode.NotAvailable`
 * (check 6) — logs one `authorization.denied` line before re-throwing,
 * never an audit row (see `platform/telemetry/authorization-denial-log.ts`
 * for why). No media id, engagement id, or other identifier is logged —
 * only the fixed `not_entitled`/`not_available` category.
 *
 * Source: packages/api-contracts/openapi.yaml, tag `ClientPortal`;
 * implementation-plan.md work packages P9C-MEDIA-01, P9C-API-01, P9C-OBS-01;
 * architecture/collaboration-and-client-sharing.md, sections
 * "16. Media Access", "19. Audit and Observability".
 */

import type { MediaAccess } from '@verdery/api-contracts';
import { MediaErrorCode, SharedErrorCode } from '@verdery/api-contracts';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { ApplicationError, ValidationError } from '../../../platform/errors/application-error.js';
import { logAuthorizationDenial } from '../../../platform/telemetry/authorization-denial-log.js';
import { UUID_PATTERN } from '../../gardens-mapping/transport/garden-routes.js';
import type { GetClientMediaAccess } from '../application/get-client-media-access.js';

export interface ClientMediaRoutesDependencies {
  readonly getClientMediaAccess: GetClientMediaAccess;
}

function invalid(message: string, code: string, pointer: string): ValidationError {
  return new ValidationError(SharedErrorCode.RequestInvalid, message, {
    details: [{ code, pointer }],
  });
}

function requirePublicationId(request: FastifyRequest): string {
  const { publicationId } = request.params as { publicationId?: unknown };

  if (typeof publicationId !== 'string' || !UUID_PATTERN.test(publicationId)) {
    throw invalid(
      'publicationId must be a UUID.',
      'request.publication_id.invalid',
      '/publicationId',
    );
  }

  return publicationId;
}

function requireMediaId(request: FastifyRequest): string {
  const { mediaId } = request.params as { mediaId?: unknown };

  if (typeof mediaId !== 'string' || !UUID_PATTERN.test(mediaId)) {
    throw invalid('mediaId must be a UUID.', 'request.media_id.invalid', '/mediaId');
  }

  return mediaId;
}

/** `null` for any error this route does not treat as an authorization denial (a malformed-request `ValidationError`, or a genuine infrastructure fault) — those propagate unlogged, exactly as before this package. */
function clientMediaDenialReason(error: unknown): string | null {
  if (!(error instanceof ApplicationError)) {
    return null;
  }
  if (error.code === MediaErrorCode.NotFound) {
    return 'not_entitled';
  }
  if (error.code === MediaErrorCode.NotAvailable) {
    return 'not_available';
  }
  return null;
}

export function registerClientMediaRoutes(
  app: FastifyInstance,
  dependencies: ClientMediaRoutesDependencies,
): void {
  app.get('/client/publications/:publicationId/media/:mediaId/access', async (request, reply) => {
    // Validated for a well-formed URL only — see this file's own header
    // for why it is never passed to the command below.
    requirePublicationId(request);
    const mediaId = requireMediaId(request);

    let access: MediaAccess;
    try {
      access = await dependencies.getClientMediaAccess.execute(
        request.actorContext.profileId,
        mediaId,
      );
    } catch (error) {
      const reasonCategory = clientMediaDenialReason(error);
      if (reasonCategory !== null) {
        logAuthorizationDenial(request.log, {
          surface: 'client_media',
          reasonCategory,
          route: request.routeOptions?.url ?? request.url,
        });
      }
      throw error;
    }

    return reply.status(200).send(access);
  });
}
