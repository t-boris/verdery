import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import type { DatabaseSchema } from '../../../platform/database/database-gateway.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { TaskRepository } from '../application/task-repository.js';
import type { Task, TaskSource, TaskTargetKind, TaskUrgency } from '../domain/task.js';
import type { TaskStatus } from '../domain/task-lifecycle.js';
import { translateCheckViolation } from './translate-check-violation.js';

interface TaskRowLike {
  id: string;
  garden_id: string;
  target_kind: string;
  target_garden_area_id: string | null;
  target_plant_id: string | null;
  title: string;
  notes: string | null;
  status: string;
  due_date: string | null;
  time_window_start: Date | null;
  time_window_end: Date | null;
  recurrence_rule: string | null;
  urgency: string;
  source: string;
  origin_observation_id: string | null;
  revision: number;
  created_by_profile_id: string;
  created_at: Date;
  updated_at: Date;
  completed_at: Date | null;
}

function toTask(row: TaskRowLike): Task {
  return {
    id: row.id,
    gardenId: row.garden_id,
    targetKind: row.target_kind as TaskTargetKind,
    targetGardenAreaMapObjectId: row.target_garden_area_id,
    targetPlantId: row.target_plant_id,
    title: row.title,
    notes: row.notes,
    status: row.status as TaskStatus,
    dueDate: row.due_date,
    timeWindowStart: row.time_window_start,
    timeWindowEnd: row.time_window_end,
    recurrenceRule: row.recurrence_rule,
    urgency: row.urgency as TaskUrgency,
    source: row.source as TaskSource,
    originObservationId: row.origin_observation_id,
    revision: row.revision,
    createdByProfileId: row.created_by_profile_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}

export class KyselyTaskRepository implements TaskRepository {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  async findById(taskId: Uuid): Promise<Task | null> {
    const row = await this.db
      .selectFrom('tasks_recommendations.task')
      .selectAll()
      .where('id', '=', taskId)
      .executeTakeFirst();

    return row === undefined ? null : toTask(row);
  }

  async insert(task: Task): Promise<void> {
    try {
      await this.db
        .insertInto('tasks_recommendations.task')
        .values({
          id: task.id,
          garden_id: task.gardenId,
          target_kind: task.targetKind,
          target_garden_area_id: task.targetGardenAreaMapObjectId,
          target_plant_id: task.targetPlantId,
          title: task.title,
          notes: task.notes,
          status: task.status,
          due_date: task.dueDate,
          time_window_start: task.timeWindowStart,
          time_window_end: task.timeWindowEnd,
          recurrence_rule: task.recurrenceRule,
          urgency: task.urgency,
          source: task.source,
          origin_observation_id: task.originObservationId,
          revision: task.revision,
          created_by_profile_id: task.createdByProfileId,
          created_at: task.createdAt,
          updated_at: task.updatedAt,
          completed_at: task.completedAt,
        })
        .execute();
    } catch (error) {
      const translated = translateCheckViolation(error, '/title');
      if (translated !== null) {
        throw translated;
      }
      throw error;
    }
  }

  async update(task: Task, expectedRevision: number): Promise<boolean> {
    try {
      const result = await this.db
        .updateTable('tasks_recommendations.task')
        .set({
          title: task.title,
          notes: task.notes,
          status: task.status,
          due_date: task.dueDate,
          time_window_start: task.timeWindowStart,
          time_window_end: task.timeWindowEnd,
          recurrence_rule: task.recurrenceRule,
          urgency: task.urgency,
          revision: task.revision,
          updated_at: task.updatedAt,
          completed_at: task.completedAt,
        })
        .where('id', '=', task.id)
        .where('revision', '=', expectedRevision)
        .executeTakeFirst();

      return (result?.numUpdatedRows ?? 0n) === 1n;
    } catch (error) {
      const translated = translateCheckViolation(error, '/title');
      if (translated !== null) {
        throw translated;
      }
      throw error;
    }
  }

  async listForGarden(gardenId: Uuid, statusFilter: readonly TaskStatus[] | null): Promise<Task[]> {
    let query = this.db
      .selectFrom('tasks_recommendations.task')
      .selectAll()
      .where('garden_id', '=', gardenId);

    if (statusFilter !== null && statusFilter.length > 0) {
      query = query.where('status', 'in', [...statusFilter]);
    }

    // Ordering: see `ListTasksForGarden`'s own doc comment for the
    // reasoning — soonest due date first (undated tasks last), then by
    // urgency descending, then by creation order as a stable tiebreaker.
    const rows = await query
      .orderBy(sql`due_date asc nulls last`)
      .orderBy(
        sql`case urgency when 'urgent' then 1 when 'high' then 2 when 'normal' then 3 else 4 end`,
      )
      .orderBy('created_at', 'asc')
      .execute();

    return rows.map(toTask);
  }
}
