/**
 * Authenticated machine-to-machine trigger for the recommendation
 * evaluation sweep (P7-ASYNC-01). The worker's own interval scheduler
 * (`services/workers/src/sweeps/`), not an app user, calls this endpoint,
 * authenticating with the same Google-signed service-identity token the
 * processing-result callback verifies — the exact posture
 * `media-retention-sweep-route.ts` established: outside the Firebase
 * user-authenticated route group, outside public OpenAPI, verified inside
 * the handler.
 */

import type { FastifyInstance } from 'fastify';
import type { CloudTasksInvocationVerifier } from '../../../platform/tasks/cloud-tasks-invocation-verifier.js';
import type { RunRecommendationEvaluationSweep } from '../application/run-recommendation-evaluation-sweep.js';

export interface RecommendationEvaluationSweepRouteDependencies {
  readonly runRecommendationEvaluationSweep: RunRecommendationEvaluationSweep;
  readonly cloudTasksInvocationVerifier: CloudTasksInvocationVerifier;
}

export function registerRecommendationEvaluationSweepRoute(
  app: FastifyInstance,
  dependencies: RecommendationEvaluationSweepRouteDependencies,
): void {
  app.post('/internal/recommendation-evaluation/sweep', async (request, reply) => {
    await dependencies.cloudTasksInvocationVerifier.verify(request.headers.authorization);

    const result = await dependencies.runRecommendationEvaluationSweep.execute();

    return reply.status(200).send(result);
  });
}
