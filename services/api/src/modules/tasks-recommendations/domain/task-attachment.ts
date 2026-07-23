/**
 * A task's attached file. Append-only, like `media.media_record` and
 * `plants_inventory.plant_photo` itself — no update function exists here,
 * and no `is_primary`-style flag either: unlike `plant_photo`, the migration
 * gives `task_attachment` no such column, so there is nothing for one to
 * flip.
 *
 * Source: migrations/1784900000000_plants-observations-tasks-baseline.sql,
 * `tasks_recommendations.task_attachment`.
 */

import type { Uuid } from '../../../shared/identifiers/uuid.js';

export interface TaskAttachment {
  readonly id: Uuid;
  readonly taskId: Uuid;
  readonly mediaId: Uuid;
  readonly createdAt: Date;
}

export function createTaskAttachment(
  id: Uuid,
  taskId: Uuid,
  mediaId: Uuid,
  now: Date,
): TaskAttachment {
  return { id, taskId, mediaId, createdAt: now };
}
