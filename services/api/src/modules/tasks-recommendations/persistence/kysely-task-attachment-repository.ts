import type { Kysely } from 'kysely';
import type { DatabaseSchema } from '../../../platform/database/database-gateway.js';
import type { TaskAttachmentRepository } from '../application/task-attachment-repository.js';
import type { TaskAttachment } from '../domain/task-attachment.js';

export class KyselyTaskAttachmentRepository implements TaskAttachmentRepository {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  async insert(attachment: TaskAttachment): Promise<void> {
    await this.db
      .insertInto('tasks_recommendations.task_attachment')
      .values({
        id: attachment.id,
        task_id: attachment.taskId,
        media_id: attachment.mediaId,
        created_at: attachment.createdAt,
      })
      .execute();
  }
}
