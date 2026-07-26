import type { Kysely } from 'kysely';
import type { DatabaseSchema } from '../../../platform/database/database-gateway.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type {
  TaskActivityEntry,
  TaskActivityRepository,
} from '../application/task-activity-repository.js';
import type { TaskCommandType } from '../application/task-revision-journal-writer.js';
import type { TaskStatus } from '../domain/task-lifecycle.js';

export class KyselyTaskActivityRepository implements TaskActivityRepository {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  async listForTask(taskId: Uuid): Promise<TaskActivityEntry[]> {
    const rows = await this.db
      .selectFrom('tasks_recommendations.task_revision')
      .select([
        'revision',
        'command_type',
        'actor_profile_id',
        'status',
        'due_date',
        'assigned_profile_id',
        'recorded_at',
      ])
      .where('task_id', '=', taskId)
      .orderBy('revision', 'asc')
      .execute();

    return rows.map((row) => ({
      revision: row.revision,
      commandType: row.command_type as TaskCommandType,
      actorProfileId: row.actor_profile_id,
      status: row.status as TaskStatus | null,
      dueDate: row.due_date,
      assignedProfileId: row.assigned_profile_id,
      recordedAt: row.recorded_at,
    }));
  }
}
