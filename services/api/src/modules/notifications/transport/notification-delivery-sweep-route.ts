/**
 * Authenticated machine-to-machine trigger for the notification delivery
 * sweep (P7-NOTIF-02). The worker's own interval scheduler
 * (`services/workers/src/sweeps/`), not an app user, calls this endpoint,
 * authenticating with the same Google-signed service-identity token every
 * worker-to-API path presents — the exact posture
 * `recommendation-evaluation-sweep-route.ts` established: outside the
 * Firebase user-authenticated route group, outside public OpenAPI,
 * verified inside the handler.
 */

import type { FastifyInstance } from 'fastify';
import type { CloudTasksInvocationVerifier } from '../../../platform/tasks/cloud-tasks-invocation-verifier.js';
import type { RunNotificationDeliverySweep } from '../application/run-notification-delivery-sweep.js';

export interface NotificationDeliverySweepRouteDependencies {
  readonly runNotificationDeliverySweep: RunNotificationDeliverySweep;
  readonly cloudTasksInvocationVerifier: CloudTasksInvocationVerifier;
}

export function registerNotificationDeliverySweepRoute(
  app: FastifyInstance,
  dependencies: NotificationDeliverySweepRouteDependencies,
): void {
  app.post('/internal/notification-delivery/sweep', async (request, reply) => {
    await dependencies.cloudTasksInvocationVerifier.verify(request.headers.authorization);

    const result = await dependencies.runNotificationDeliverySweep.execute();

    // Deliberately NOT logged here: the worker's `GoogleApiSweepTrigger`
    // logs this summary as `notifications.delivery_sweep_completed` on
    // every successful round-trip, exactly as it does for the retention,
    // weather, and evaluation sweeps — one emitter per event name, so a
    // log-based metric on the event never double-counts a run
    // (P7-ANALYTICS-01 removed this route's duplicate emission of the
    // same name from a second service).
    return reply.status(200).send(result);
  });
}
