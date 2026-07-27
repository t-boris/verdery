/**
 * Aggregates every P9C-PUBLISH-01 route-registration function — publisher
 * grants, engagement work-log reads, client-update lifecycle, and
 * client-update item staging — into one call, purely so `app.ts` needs only
 * one import/destructure/call instead of four to stay at or below the
 * repository's 600-line source-file limit. Each underlying
 * `register*Routes` function remains independently defined, documented, and
 * testable in its own file; nothing about their own behavior changes here.
 */

import type { FastifyInstance } from 'fastify';
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
}

export function registerPublicationRoutes(
  app: FastifyInstance,
  dependencies: PublicationRoutesDependencies,
): void {
  registerPublisherGrantRoutes(app, dependencies.publisherGrantRoutesDependencies);
  registerWorkLogRoutes(app, dependencies.workLogRoutesDependencies);
  registerClientUpdateRoutes(app, dependencies.clientUpdateRoutesDependencies);
  registerClientUpdateItemRoutes(app, dependencies.clientUpdateItemRoutesDependencies);
}
