import type { TaskAttachment } from '../domain/task-attachment.js';

export interface TaskAttachmentRepository {
  insert(attachment: TaskAttachment): Promise<void>;
}
