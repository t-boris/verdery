/**
 * The machine-to-machine route group: every endpoint whose caller is a
 * Google Cloud component (the workers relay, an interval-driven sweep
 * trigger, a Cloud Tasks worker) rather than a person with a session.
 *
 * Extracted from `app.ts` for the repository's own 600-line rule — this is
 * composition-root code that happens to live in its own file, not a module
 * boundary, exactly like the `compose-*.ts` helpers already split out of
 * that same file.
 *
 * WHAT UNITES THESE ROUTES, and why they are one encapsulation context:
 * none of them may go through the ordinary session pipeline. They are how
 * privileged background work reaches the API at all, so each verifies a
 * machine identity (OIDC, via `CloudTasksInvocationVerifier`) instead of a
 * Firebase credential — the same "this is how access is established in the
 * first place, so it cannot itself require the ordinary session pipeline"
 * reasoning the session routes apply with a different identity check.
 *
 * Every sweep here runs IN THIS SERVICE, never in `services/workers`: the
 * worker role deliberately has no access to garden, plant, recommendation
 * or integration tables, and widening that grant so a worker could iterate
 * rows itself would trade a held privilege boundary for one query. The
 * worker contributes its interval loop and its verified identity, nothing
 * more.
 */

import type { FastifyInstance } from 'fastify';
import type { DeletionSweepRouteDependencies } from './modules/deletion/public.js';
import { registerDeletionSweepRoute } from './modules/deletion/public.js';
import type { ExportInternalRoutesDependencies } from './modules/exports/public.js';
import { registerExportInternalRoutes } from './modules/exports/public.js';
import type { InvitationExpirySweepRouteDependencies } from './modules/gardens-mapping/public.js';
import { registerInvitationExpirySweepRoute } from './modules/gardens-mapping/public.js';
import type { TaxonEnrichmentSweepRouteDependencies } from './modules/integrations/public.js';
import { registerTaxonEnrichmentSweepRoute } from './modules/integrations/public.js';
import type { WeatherRefreshSweepRouteDependencies } from './modules/integrations/public.js';
import { registerWeatherRefreshSweepRoute } from './modules/integrations/public.js';
import type {
  MediaProcessingCallbackRouteDependencies,
  MediaRetentionSweepRouteDependencies,
} from './modules/media/public.js';
import {
  registerMediaProcessingCallbackRoute,
  registerMediaRetentionSweepRoute,
} from './modules/media/public.js';
import type {
  NotificationDeliverySweepRouteDependencies,
  NotificationEventsRouteDependencies,
} from './modules/notifications/public.js';
import {
  registerNotificationDeliverySweepRoute,
  registerNotificationEventsRoute,
} from './modules/notifications/public.js';
import type { RecommendationEvaluationSweepRouteDependencies } from './modules/tasks-recommendations/public.js';
import { registerRecommendationEvaluationSweepRoute } from './modules/tasks-recommendations/public.js';

export interface InternalRoutesDependencies {
  readonly mediaProcessingCallback: MediaProcessingCallbackRouteDependencies;
  readonly mediaRetentionSweep: MediaRetentionSweepRouteDependencies;
  readonly weatherRefreshSweep: WeatherRefreshSweepRouteDependencies;
  readonly recommendationEvaluationSweep: RecommendationEvaluationSweepRouteDependencies;
  readonly notificationEvents: NotificationEventsRouteDependencies;
  readonly notificationDeliverySweep: NotificationDeliverySweepRouteDependencies;
  readonly exportInternal: ExportInternalRoutesDependencies;
  readonly deletionSweep: DeletionSweepRouteDependencies;
  readonly invitationExpirySweep: InvitationExpirySweepRouteDependencies;
  readonly taxonEnrichmentSweep: TaxonEnrichmentSweepRouteDependencies;
}

export function registerInternalRoutes(
  instance: FastifyInstance,
  dependencies: InternalRoutesDependencies,
): void {
  // P6-ASYNC-01: the media-processing worker's own result callback.
  registerMediaProcessingCallbackRoute(instance, dependencies.mediaProcessingCallback);
  // P6-RET-01: the worker-triggered retention sweep, same machine-to-machine identity check as the callback above.
  registerMediaRetentionSweepRoute(instance, dependencies.mediaRetentionSweep);
  // P7-ASYNC-01: the worker-triggered weather-refresh and recommendation-evaluation sweeps — same identity check again.
  registerWeatherRefreshSweepRoute(instance, dependencies.weatherRefreshSweep);
  registerRecommendationEvaluationSweepRoute(instance, dependencies.recommendationEvaluationSweep);
  // P7-NOTIF-01: the workers outbox relay's notification-event endpoint — same identity check yet again.
  registerNotificationEventsRoute(instance, dependencies.notificationEvents);
  // P7-NOTIF-02: the worker-triggered notification delivery sweep — same identity check once more.
  registerNotificationDeliverySweepRoute(instance, dependencies.notificationDeliverySweep);
  // P8-EXPORT-01: the export-generation worker's snapshot/checkpoint/completion endpoints — same identity check again.
  registerExportInternalRoutes(instance, dependencies.exportInternal);
  // P8-DELETE-01: the deletion sweep — same identity check, fifth sweep.
  registerDeletionSweepRoute(instance, dependencies.deletionSweep);
  // P9A-API-01: the invitation expiry sweep — same identity check, sixth sweep. Not yet scheduled by a worker (see that route's own header for why) but callable the same way every sibling sweep is.
  registerInvitationExpirySweepRoute(instance, dependencies.invitationExpirySweep);
  // P11-ASYNC-01: the taxon-enrichment sweep — same identity check, seventh sweep.
  registerTaxonEnrichmentSweepRoute(instance, dependencies.taxonEnrichmentSweep);
}
