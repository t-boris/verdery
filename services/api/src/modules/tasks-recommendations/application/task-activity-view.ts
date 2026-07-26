/**
 * Maps a `TaskActivityEntry` to the shape `GetTaskActivity` returns —
 * `task-view.ts`'s own convention (a fixed application-layer resource shape,
 * not the domain/persistence type) applied to the activity read model.
 */

import type { TaskActivityEntry } from './task-activity-repository.js';

export interface TaskActivityResource {
  readonly revision: number;
  readonly commandType: string;
  readonly actorProfileId: string;
  readonly status: string | null;
  readonly dueDate: string | null;
  readonly assignedProfileId: string | null;
  readonly recordedAt: string;
}

export function toTaskActivityResource(entry: TaskActivityEntry): TaskActivityResource {
  return {
    revision: entry.revision,
    commandType: entry.commandType,
    actorProfileId: entry.actorProfileId,
    status: entry.status,
    dueDate: entry.dueDate,
    assignedProfileId: entry.assignedProfileId,
    recordedAt: entry.recordedAt.toISOString(),
  };
}
