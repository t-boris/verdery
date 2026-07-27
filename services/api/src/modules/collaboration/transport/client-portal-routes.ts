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
 * Source: packages/api-contracts/openapi.yaml, tag `ClientPortal`;
 * implementation-plan.md work package P9C-API-01.
 */

import type {
  ClientGardenListResult,
  ClientGardenOverview,
  ClientPublicationListResult,
  ClientTimelineResult,
} from '@verdery/api-contracts';
import type { FastifyInstance } from 'fastify';
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

    const overview: ClientGardenOverview = await dependencies.getClientGardenOverview.execute(
      request.actorContext.profileId,
      clientGardenId,
    );

    return reply.status(200).send(overview);
  });

  app.get('/client/gardens/:clientGardenId/publications', async (request, reply) => {
    const clientGardenId = requireClientGardenId(request);

    const result: ClientPublicationListResult = await dependencies.listClientPublications.execute(
      request.actorContext.profileId,
      clientGardenId,
    );

    return reply.status(200).send(result);
  });

  app.get('/client/gardens/:clientGardenId/timeline', async (request, reply) => {
    const clientGardenId = requireClientGardenId(request);

    const result: ClientTimelineResult = await dependencies.getClientTimeline.execute(
      request.actorContext.profileId,
      clientGardenId,
    );

    return reply.status(200).send(result);
  });
}
