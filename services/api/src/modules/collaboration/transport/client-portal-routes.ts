/**
 * Client-portal HTTP routes (P9C-API-01): `GET /client/gardens`,
 * `GET /client/gardens/{clientGardenId}/overview`,
 * `GET /client/gardens/{clientGardenId}/publications`,
 * `GET /client/gardens/{clientGardenId}/timeline`.
 *
 * Every route below reads `request.actorContext.profileId` as the caller's
 * own client profile and passes it FIRST into its command, exactly the way
 * `client-invitation-routes.ts`'s own flat `acceptClientInvitation`
 * resolves from the caller's own identity — never resolving from a
 * professional-supplied `engagementId` the way `client-update-routes.ts`/
 * `publication-routes.ts` do, which this package's own instructions name
 * explicitly as the wrong shape to copy here. `clientGardenId` travels as
 * an ordinary path parameter (`requireClientGardenId` validates only that
 * it is a well-formed UUID) but every command it reaches
 * (`GetClientGardenOverview`/`ListClientPublications`/`GetClientTimeline`)
 * re-resolves and re-authorizes it against the caller's own active grant
 * before reading anything — see `ClientPortalAuthorization`'s own header.
 *
 * The media-access route this tag's own architecture section also names
 * (`GET /client/publications/{publicationId}/media/{mediaId}/access`) lives
 * in `media/transport/client-media-routes.ts` instead: it wraps the media
 * module's own `GetClientMediaAccess` (P9C-MEDIA-01), owned by that module,
 * not this one.
 *
 * DENIAL TELEMETRY (P9C-OBS-01). The three `clientGardenId`-scoped reads
 * below log one `authorization.denied` line — `reasonCategory: 'not_entitled'`
 * always, never a finer category — before re-throwing the concealed
 * `client_portal.not_found` error, and NEVER on success: this is deliberately
 * NOT a full audit row per read (see `platform/telemetry/
 * authorization-denial-log.ts`'s own header), and successful reads are not
 * logged at all — "portal open rate" is served by Cloud Run's own built-in
 * `request_count`/`request_latencies`, grouped by route template, the
 * identical built-in-metric posture `docs/development/service-levels.md`'s
 * own SLI-1/SLI-2 already take for every other route group; adding a
 * bespoke log line for every ordinary, successful, high-volume portal read
 * would duplicate a signal Cloud Run already provides for free. `GET
 * /client/gardens` (no `clientGardenId`) is deliberately NOT instrumented
 * here: `ListClientGardens` has no denial path of its own to log — it
 * simply lists whatever engagements the caller's own grants resolve to.
 *
 * Source: packages/api-contracts/openapi.yaml, tag `ClientPortal`;
 * implementation-plan.md work packages P9C-API-01, P9C-OBS-01;
 * architecture/collaboration-and-client-sharing.md, section
 * "19. Audit and Observability".
 */

import {
  type ClientGardenListResult,
  type ClientGardenOverview,
  ClientPortalErrorCode,
  type ClientPublicationListResult,
  type ClientTimelineResult,
} from '@verdery/api-contracts';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { ApplicationError } from '../../../platform/errors/application-error.js';
import { logAuthorizationDenial } from '../../../platform/telemetry/authorization-denial-log.js';
import type { GetClientGardenOverview } from '../application/get-client-garden-overview.js';
import type { GetClientTimeline } from '../application/get-client-timeline.js';
import type { ListClientGardens } from '../application/list-client-gardens.js';
import type { ListClientPublications } from '../application/list-client-publications.js';
import { requireClientGardenId } from './route-helpers.js';

export interface ClientPortalRoutesDependencies {
  readonly listClientGardens: ListClientGardens;
  readonly getClientGardenOverview: GetClientGardenOverview;
  readonly listClientPublications: ListClientPublications;
  readonly getClientTimeline: GetClientTimeline;
}

/**
 * Every `clientGardenId`-scoped read's own denial is the identical
 * concealed `ClientPortalAuthorization` outcome (see this file's own
 * header) — logged once, here, rather than duplicating the try/catch three
 * times. Re-throws unchanged; the response the caller receives is not
 * affected in any way.
 */
async function runOrLogDenial<T>(request: FastifyRequest, execute: () => Promise<T>): Promise<T> {
  try {
    return await execute();
  } catch (error) {
    if (error instanceof ApplicationError && error.code === ClientPortalErrorCode.NotFound) {
      logAuthorizationDenial(request.log, {
        surface: 'client_portal',
        reasonCategory: 'not_entitled',
        route: request.routeOptions?.url ?? request.url,
      });
    }
    throw error;
  }
}

export function registerClientPortalRoutes(
  app: FastifyInstance,
  dependencies: ClientPortalRoutesDependencies,
): void {
  app.get('/client/gardens', async (request, reply) => {
    const result: ClientGardenListResult = await dependencies.listClientGardens.execute(
      request.actorContext.profileId,
    );

    return reply.status(200).send(result);
  });

  app.get('/client/gardens/:clientGardenId/overview', async (request, reply) => {
    const clientGardenId = requireClientGardenId(request);

    const overview: ClientGardenOverview = await runOrLogDenial(request, () =>
      dependencies.getClientGardenOverview.execute(request.actorContext.profileId, clientGardenId),
    );

    return reply.status(200).send(overview);
  });

  app.get('/client/gardens/:clientGardenId/publications', async (request, reply) => {
    const clientGardenId = requireClientGardenId(request);

    const result: ClientPublicationListResult = await runOrLogDenial(request, () =>
      dependencies.listClientPublications.execute(request.actorContext.profileId, clientGardenId),
    );

    return reply.status(200).send(result);
  });

  app.get('/client/gardens/:clientGardenId/timeline', async (request, reply) => {
    const clientGardenId = requireClientGardenId(request);

    const result: ClientTimelineResult = await runOrLogDenial(request, () =>
      dependencies.getClientTimeline.execute(request.actorContext.profileId, clientGardenId),
    );

    return reply.status(200).send(result);
  });
}
