/**
 * Authenticated machine-to-machine trigger for the taxon-enrichment sweep
 * (P11-ASYNC-01) — the exact `weather-refresh-sweep-route.ts` shape, sixth
 * instance of the pattern. The worker's own interval scheduler
 * (`services/workers/src/sweeps/`), not an app user, calls this endpoint.
 */

import type { FastifyInstance } from 'fastify';
import type { CloudTasksInvocationVerifier } from '../../../platform/tasks/cloud-tasks-invocation-verifier.js';
import type { RunTaxonEnrichmentSweep } from '../application/run-taxon-enrichment-sweep.js';

export interface TaxonEnrichmentSweepRouteDependencies {
  readonly runTaxonEnrichmentSweep: RunTaxonEnrichmentSweep;
  readonly cloudTasksInvocationVerifier: CloudTasksInvocationVerifier;
}

export function registerTaxonEnrichmentSweepRoute(
  app: FastifyInstance,
  dependencies: TaxonEnrichmentSweepRouteDependencies,
): void {
  app.post('/internal/taxon-enrichment/sweep', async (request, reply) => {
    await dependencies.cloudTasksInvocationVerifier.verify(request.headers.authorization);

    const result = await dependencies.runTaxonEnrichmentSweep.execute();

    return reply.status(200).send(result);
  });
}
