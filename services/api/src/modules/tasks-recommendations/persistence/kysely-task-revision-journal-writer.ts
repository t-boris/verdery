import type { Kysely } from 'kysely';
import type { DatabaseSchema } from '../../../platform/database/database-gateway.js';
import type {
  TaskRevisionJournalEntry,
  TaskRevisionJournalWriter,
} from '../application/task-revision-journal-writer.js';

export class KyselyTaskRevisionJournalWriter implements TaskRevisionJournalWriter {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  async record(entry: TaskRevisionJournalEntry): Promise<void> {
    await this.db
      .insertInto('tasks_recommendations.task_revision')
      .values({
        task_id: entry.taskId,
        revision: entry.revision,
        command_type: entry.commandType,
        status: entry.status,
        due_date: entry.dueDate,
        actor_profile_id: entry.actorProfileId,
      })
      .execute();
  }
}
