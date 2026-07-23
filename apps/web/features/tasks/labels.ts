import type { TaskStatus, TaskTargetKind, TaskUrgency } from '@verdery/api-contracts';

import type { MessageKey } from '@/shared/localization/public';
import type { StatusTone } from '@/shared/ui/public';

/**
 * Message-key, presentation, and terminal-state mapping for the
 * tasks-recommendations enums.
 *
 * Source: packages/api-contracts/openapi.yaml, schemas `TaskTargetKind`,
 * `TaskStatus`, `TaskUrgency`.
 */

export const TASK_TARGET_KINDS: readonly TaskTargetKind[] = ['garden', 'garden_area', 'plant'];

export const TASK_STATUSES: readonly TaskStatus[] = [
  'planned',
  'suggested',
  'completed',
  'skipped',
  'dismissed',
  'deleted',
];

export const TASK_URGENCIES: readonly TaskUrgency[] = ['low', 'normal', 'high', 'urgent'];

export function targetKindLabel(kind: TaskTargetKind): MessageKey {
  switch (kind) {
    case 'garden':
      return 'tasks.enum.targetKind.garden';
    case 'garden_area':
      return 'tasks.enum.targetKind.gardenArea';
    case 'plant':
      return 'tasks.enum.targetKind.plant';
  }
}

export function taskStatusLabel(status: TaskStatus): MessageKey {
  switch (status) {
    case 'planned':
      return 'tasks.enum.status.planned';
    case 'suggested':
      return 'tasks.enum.status.suggested';
    case 'completed':
      return 'tasks.enum.status.completed';
    case 'skipped':
      return 'tasks.enum.status.skipped';
    case 'dismissed':
      return 'tasks.enum.status.dismissed';
    case 'deleted':
      return 'tasks.enum.status.deleted';
  }
}

export function taskStatusTone(status: TaskStatus): StatusTone {
  switch (status) {
    case 'planned':
    case 'suggested':
      return 'neutral';
    case 'completed':
      return 'positive';
    case 'skipped':
    case 'dismissed':
    case 'deleted':
      return 'negative';
  }
}

export function urgencyLabel(urgency: TaskUrgency): MessageKey {
  switch (urgency) {
    case 'low':
      return 'tasks.enum.urgency.low';
    case 'normal':
      return 'tasks.enum.urgency.normal';
    case 'high':
      return 'tasks.enum.urgency.high';
    case 'urgent':
      return 'tasks.enum.urgency.urgent';
  }
}

/**
 * `planned` and `suggested` are the only two statuses a task's status or
 * details may still be changed from — every edit, reschedule, complete,
 * dismiss, skip, and delete action is gated on this, so a terminal-status
 * task never offers a control that would only fail server-side.
 */
export function isTaskMutable(status: TaskStatus): boolean {
  return status === 'planned' || status === 'suggested';
}
