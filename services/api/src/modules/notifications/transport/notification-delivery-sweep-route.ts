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

    // One structured line per run — notifications.md section 15's send
    // attempt / provider acceptance / invalid token / suppression counters
    // at their source. Counts only: no recipient identities, no tokens.
    request.log.info(
      { event: 'notifications.delivery_sweep_completed', ...result },
      'Notification delivery sweep completed',
    );

    return reply.status(200).send(result);
  });
}
