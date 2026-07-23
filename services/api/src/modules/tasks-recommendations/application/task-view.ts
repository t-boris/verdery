/**
 * Maps the domain `Task` to the shape a command handler or query returns.
 *
 * Application code returns this view, not the domain entity, from every
 * command and query in this module, matching gardens-mapping's own
 * `toGardenResource` convention: the idempotency store caches the literal
 * response a retried request must replay, so what a use case returns must be
 * one fixed shape.
 *
 * This module has no HTTP route this pass (see `public.ts` — deliberately
 * absent, the same reason `media`'s and the other two Phase 4 siblings' own
 * `public.ts` files give), so there is no `@verdery/api-contracts` `Task`
 * schema to conform to yet. This resource shape is this module's own for
 * now, ready for that contract to adopt once a route exists — the same
 * simplicity `PlantResource`/`ObservationResource` use for the identical
 * reason, carrying every field directly (including nulls).
 */

import type { Task } from '../domain/task.js';

export interface TaskResource {
  readonly id: string;
  readonly gardenId: string;
  readonly targetKind: string;
  readonly targetGardenAreaMapObjectId: string | null;
  readonly targetPlantId: string | null;
  readonly title: string;
  readonly notes: string | null;
  readonly status: string;
  readonly dueDate: string | null;
  readonly timeWindowStart: string | null;
  readonly timeWindowEnd: string | null;
  readonly recurrenceRule: string | null;
  readonly urgency: string;
  readonly source: string;
  readonly originObservationId: string | null;
  readonly revision: number;
  readonly createdByProfileId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly completedAt: string | null;
}

export function toTaskResource(task: Task): TaskResource {
  return {
    id: task.id,
    gardenId: task.gardenId,
    targetKind: task.targetKind,
    targetGardenAreaMapObjectId: task.targetGardenAreaMapObjectId,
    targetPlantId: task.targetPlantId,
    title: task.title,
    notes: task.notes,
    status: task.status,
    dueDate: task.dueDate,
    timeWindowStart: task.timeWindowStart === null ? null : task.timeWindowStart.toISOString(),
    timeWindowEnd: task.timeWindowEnd === null ? null : task.timeWindowEnd.toISOString(),
    recurrenceRule: task.recurrenceRule,
    urgency: task.urgency,
    source: task.source,
    originObservationId: task.originObservationId,
    revision: task.revision,
    createdByProfileId: task.createdByProfileId,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
    completedAt: task.completedAt === null ? null : task.completedAt.toISOString(),
  };
}
