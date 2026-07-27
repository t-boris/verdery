/**
 * Maps a `WorkLogDetail` to the exact `WorkLog` contract shape — the same
 * "application code returns the contract-shaped view" rule
 * `organization-view.ts` documents.
 */

import type { WorkLog } from '@verdery/api-contracts';
import type { WorkLogDetail } from './work-log-repository.js';

export function toWorkLogResource(workLog: WorkLogDetail): WorkLog {
  const resource: WorkLog = {
    id: workLog.id,
    gardenId: workLog.gardenId,
    actorProfileId: workLog.actorProfileId,
    description: workLog.description,
    occurredAt: workLog.occurredAt.toISOString(),
    createdAt: workLog.createdAt.toISOString(),
  };

  if (workLog.assignmentId !== null) {
    resource.assignmentId = workLog.assignmentId;
  }
  if (workLog.taskId !== null) {
    resource.taskId = workLog.taskId;
  }

  return resource;
}
