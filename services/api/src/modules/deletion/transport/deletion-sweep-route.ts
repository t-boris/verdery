/**
 * Authenticated machine-to-machine trigger for the deletion sweep
 * (P8-DELETE-01) — the fifth sweep, identical in shape to the four before
 * it. The worker's interval scheduler, not an app user, calls this endpoint,
 * authenticating with the same Google-signed service-identity token every
 * other internal endpoint verifies; see `run-deletion-sweep.ts`'s header for
 * why the purge itself executes HERE while only its schedule lives in the
 * worker. Intentionally outside the Firebase user-authenticated route group
 * and outside public OpenAPI, the posture
 * `media-retention-sweep-route.ts` established.
 */

import type { FastifyInstance } from 'fastify';
import type { CloudTasksInvocationVerifier } from '../../../platform/tasks/cloud-tasks-invocation-verifier.js';
import type { RunDeletionSweep } from '../application/run-deletion-sweep.js';

export interface DeletionSweepRouteDependencies {
  readonly runDeletionSweep: RunDeletionSweep;
  readonly cloudTasksInvocationVerifier: CloudTasksInvocationVerifier;
}

export function registerDeletionSweepRoute(
  app: FastifyInstance,
  dependencies: DeletionSweepRouteDependencies,
): void {
  app.post('/internal/deletion/sweep', async (request, reply) => {
    await dependencies.cloudTasksInvocationVerifier.verify(request.headers.authorization);

    const result = await dependencies.runDeletionSweep.execute();

    return reply.status(200).send(result);
  });
}
