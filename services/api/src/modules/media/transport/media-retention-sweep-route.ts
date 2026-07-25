/**
 * Authenticated machine-to-machine trigger for the retention sweep
 * (P6-RET-01). The worker's own interval scheduler
 * (`services/workers/src/retention/`), not an app user, calls this
 * endpoint, authenticating with the same Google-signed service-identity
 * token the processing-result callback verifies — see
 * `run-media-retention-sweep.ts`'s own header comment for why the sweep
 * executes HERE (privileged media reads and writes stay in `services/api`)
 * while only its schedule lives in the worker. Intentionally outside the
 * Firebase user-authenticated route group and outside public OpenAPI, the
 * exact posture `media-processing-callback-route.ts` established.
 */

import type { FastifyInstance } from 'fastify';
import type { CloudTasksInvocationVerifier } from '../../../platform/tasks/cloud-tasks-invocation-verifier.js';
import type { RunMediaRetentionSweep } from '../application/run-media-retention-sweep.js';

export interface MediaRetentionSweepRouteDependencies {
  readonly runMediaRetentionSweep: RunMediaRetentionSweep;
  readonly cloudTasksInvocationVerifier: CloudTasksInvocationVerifier;
}

export function registerMediaRetentionSweepRoute(
  app: FastifyInstance,
  dependencies: MediaRetentionSweepRouteDependencies,
): void {
  app.post('/internal/media-retention/sweep', async (request, reply) => {
    await dependencies.cloudTasksInvocationVerifier.verify(request.headers.authorization);

    const result = await dependencies.runMediaRetentionSweep.execute();

    return reply.status(200).send(result);
  });
}
