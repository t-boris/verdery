import type { Kysely } from 'kysely';
import type { DatabaseSchema } from '../../../platform/database/database-gateway.js';
import type { WorkLogDetail, WorkLogRepository } from '../application/work-log-repository.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';

interface WorkLogRowShape {
  id: string;
  garden_id: string;
  assignment_id: string | null;
  task_id: string | null;
  actor_profile_id: string;
  description: string;
  occurred_at: Date;
  created_at: Date;
}

function toDetail(row: WorkLogRowShape): WorkLogDetail {
  return {
    id: row.id,
    gardenId: row.garden_id,
    assignmentId: row.assignment_id,
    taskId: row.task_id,
    actorProfileId: row.actor_profile_id,
    description: row.description,
    occurredAt: row.occurred_at,
    createdAt: row.created_at,
  };
}

const SELECTED_COLUMNS = [
  'id',
  'garden_id',
  'assignment_id',
  'task_id',
  'actor_profile_id',
  'description',
  'occurred_at',
  'created_at',
] as const;

export class KyselyWorkLogRepository implements WorkLogRepository {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  async findById(id: Uuid): Promise<WorkLogDetail | null> {
    const row = await this.db
      .selectFrom('collaboration.work_log')
      .select(SELECTED_COLUMNS)
      .where('id', '=', id)
      .executeTakeFirst();

    return row === undefined ? null : toDetail(row);
  }

  async listForGarden(gardenId: Uuid): Promise<readonly WorkLogDetail[]> {
    const rows = await this.db
      .selectFrom('collaboration.work_log')
      .select(SELECTED_COLUMNS)
      .where('garden_id', '=', gardenId)
      .orderBy('occurred_at', 'desc')
      .execute();

    return rows.map(toDetail);
  }
}
