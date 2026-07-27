/**
 * Aggregates every P9C route-registration function this module's own
 * commands need beyond `client-engagement-routes.ts` — publisher grants,
 * engagement work-log reads, client-update lifecycle, client-update item
 * staging, and (P9C-INVITE-01) client invitations — into one call, purely so
 * `app.ts` needs only one import/destructure/call instead of five to stay at
 * or below the repository's 600-line source-file limit. Each underlying
 * `register*Routes` function remains independently defined, documented, and
 * testable in its own file; nothing about their own behavior changes here.
 * (The name predates P9C-INVITE-01's own addition; kept rather than churned,
 * since this file's only job is mechanical registration bundling, not a tag
 * boundary — client-invitation routes carry their own `ClientAccess` tag.)
 */

import type { FastifyInstance } from 'fastify';
import type { ClientInvitationRoutesDependencies } from './client-invitation-routes.js';
import { registerClientInvitationRoutes } from './client-invitation-routes.js';
import type { ClientUpdateItemRoutesDependencies } from './client-update-item-routes.js';
import { registerClientUpdateItemRoutes } from './client-update-item-routes.js';
import type { ClientUpdateRoutesDependencies } from './client-update-routes.js';
import { registerClientUpdateRoutes } from './client-update-routes.js';
import type { PublisherGrantRoutesDependencies } from './publisher-grant-routes.js';
import { registerPublisherGrantRoutes } from './publisher-grant-routes.js';
import type { WorkLogRoutesDependencies } from './work-log-routes.js';
import { registerWorkLogRoutes } from './work-log-routes.js';

export interface PublicationRoutesDependencies {
  readonly publisherGrantRoutesDependencies: PublisherGrantRoutesDependencies;
  readonly workLogRoutesDependencies: WorkLogRoutesDependencies;
  readonly clientUpdateRoutesDependencies: ClientUpdateRoutesDependencies;
  readonly clientUpdateItemRoutesDependencies: ClientUpdateItemRoutesDependencies;
  readonly clientInvitationRoutesDependencies: ClientInvitationRoutesDependencies;
}

export function registerPublicationRoutes(
  app: FastifyInstance,
  dependencies: PublicationRoutesDependencies,
): void {
  registerPublisherGrantRoutes(app, dependencies.publisherGrantRoutesDependencies);
  registerWorkLogRoutes(app, dependencies.workLogRoutesDependencies);
  registerClientUpdateRoutes(app, dependencies.clientUpdateRoutesDependencies);
  registerClientUpdateItemRoutes(app, dependencies.clientUpdateItemRoutesDependencies);
  registerClientInvitationRoutes(app, dependencies.clientInvitationRoutesDependencies);
}
