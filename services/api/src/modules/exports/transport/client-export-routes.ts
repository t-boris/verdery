/**
 * `GET /client/gardens/{clientGardenId}/exports` (P9C-EXPORT-01) — a thin
 * transport wrapper around `GetClientExportManifest`, matching every other
 * `ClientPortal` route's own posture (`client-portal-routes.ts`'s header):
 * `clientGardenId` travels as an ordinary path parameter, validated only as
 * a well-formed UUID here, and is never trusted as authority — the command
 * itself re-resolves and re-authorizes it from the caller's own active
 * grant before reading anything.
 *
 * Registered from the EXPORTS module (not `collaboration/transport/
 * client-portal-routes.ts`) because this package's own instructions frame
 * it as the exports module's client-scoped equivalent, and because its
 * dependencies span gardens-mapping, plants-inventory, media, and
 * collaboration — the exports module is where that composition already
 * happens for the operational case. `app.ts` registers this alongside
 * `registerClientPortalRoutes` in the same authenticated encapsulation
 * context.
 *
 * `requireClientGardenId` mirrors `export-routes.ts`'s own
 * `requireExportRequestId` shape exactly (UUID-pattern validation only,
 * reusing `gardens-mapping/transport/garden-routes.js`'s `UUID_PATTERN` the
 * same way `export-routes.ts` already does) rather than importing
 * collaboration's own module-private `route-helpers.ts`, which is not part
 * of that module's public surface.
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { SharedErrorCode } from '@verdery/api-contracts';
import { ValidationError } from '../../../platform/errors/application-error.js';
import { UUID_PATTERN } from '../../gardens-mapping/transport/garden-routes.js';
import type { GetClientExportManifest } from '../application/get-client-export-manifest.js';

export interface ClientExportRoutesDependencies {
  readonly getClientExportManifest: GetClientExportManifest;
}

function requireClientGardenId(request: FastifyRequest): string {
  const { clientGardenId } = request.params as { clientGardenId?: unknown };

  if (typeof clientGardenId !== 'string' || !UUID_PATTERN.test(clientGardenId)) {
    throw new ValidationError(SharedErrorCode.RequestInvalid, 'clientGardenId must be a UUID.', {
      details: [{ code: 'request.client_garden_id.invalid', pointer: '/clientGardenId' }],
    });
  }

  return clientGardenId;
}

export function registerClientExportRoutes(
  app: FastifyInstance,
  dependencies: ClientExportRoutesDependencies,
): void {
  app.get('/client/gardens/:clientGardenId/exports', async (request, reply) => {
    const clientGardenId = requireClientGardenId(request);

    const manifest = await dependencies.getClientExportManifest.execute(
      request.actorContext.profileId,
      clientGardenId,
    );

    // Deliberately no manifest CONTENTS in the log — the same "ids and
    // outcomes only" posture `export-routes.ts` documents for the
    // operational export.
    request.log.info(
      {
        event: 'client_export.manifest_served',
        clientGardenId,
        publicationCount: manifest.publications.length,
        mediaCount: manifest.media.length,
      },
      'Client export manifest served',
    );

    return reply.status(200).send(manifest);
  });
}
