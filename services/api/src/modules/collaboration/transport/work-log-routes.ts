/**
 * The engagement-scoped work-log read (P9C-PUBLISH-01) — the candidate list
 * a publisher selects completed work from.
 *
 * Source: packages/api-contracts/openapi.yaml, tag `Publications`;
 * implementation-plan.md work package P9C-PUBLISH-01.
 */

import type { WorkLogListResult } from '@verdery/api-contracts';
import type { FastifyInstance } from 'fastify';
import type { ListEngagementWorkLogs } from '../application/list-engagement-work-logs.js';
import { requireEngagementId } from './route-helpers.js';

export interface WorkLogRoutesDependencies {
  readonly listEngagementWorkLogs: ListEngagementWorkLogs;
}

export function registerWorkLogRoutes(
  app: FastifyInstance,
  dependencies: WorkLogRoutesDependencies,
): void {
  app.get('/client-engagements/:engagementId/work-logs', async (request, reply) => {
    const engagementId = requireEngagementId(request);

    const result: WorkLogListResult = await dependencies.listEngagementWorkLogs.execute(
      engagementId,
      request.actorContext.profileId,
    );

    return reply.status(200).send(result);
  });
}
