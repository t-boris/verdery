/**
 * Authenticated machine-to-machine trigger for the invitation expiry sweep
 * (P9A-API-01). Outside the Firebase user-authenticated route group, outside
 * public OpenAPI — the exact posture every sibling internal sweep route
 * already established (`notification-delivery-sweep-route.ts`,
 * `recommendation-evaluation-sweep-route.ts`): a worker's interval
 * scheduler, not an app user, calls this endpoint, authenticating with the
 * same Google-signed service-identity token every worker-to-API path
 * presents, verified inside the handler.
 *
 * WHAT IS DELIBERATELY NOT DONE HERE, and why: this route exists so the
 * sweep is CALLABLE the way every other sweep is, but nothing outside
 * `services/api` schedules a call to it yet — `services/workers`' interval
 * scheduler, its configuration schema, and the deploy script's environment
 * variables are unchanged by this work package. Wiring a sixth scheduled
 * trigger touches five files outside this module's boundary (worker
 * `main.ts`, `configuration.ts`, `sweep-trigger.ts`, the deploy script, and
 * the observability event catalog) for a scheduling concern this API
 * package does not own — P9A-API-01's own scope is the endpoint, matching
 * every other command in this work package. Until a worker calls it, a
 * lapsed invitation is still caught correctly at accept time
 * (`AcceptInvitation`'s lazy self-heal); only a garden's read-only roster
 * of long-abandoned, never-touched invitations would show a stale `pending`
 * until the trigger is wired up. Scheduling it is a follow-up, not a defect
 * in this endpoint.
 */

import type { FastifyInstance } from 'fastify';
import type { CloudTasksInvocationVerifier } from '../../../platform/tasks/cloud-tasks-invocation-verifier.js';
import type { RunInvitationExpirySweep } from '../application/run-invitation-expiry-sweep.js';

export interface InvitationExpirySweepRouteDependencies {
  readonly runInvitationExpirySweep: RunInvitationExpirySweep;
  readonly cloudTasksInvocationVerifier: CloudTasksInvocationVerifier;
}

export function registerInvitationExpirySweepRoute(
  app: FastifyInstance,
  dependencies: InvitationExpirySweepRouteDependencies,
): void {
  app.post('/internal/invitation-expiry/sweep', async (request, reply) => {
    await dependencies.cloudTasksInvocationVerifier.verify(request.headers.authorization);

    const result = await dependencies.runInvitationExpirySweep.execute();

    return reply.status(200).send(result);
  });
}
