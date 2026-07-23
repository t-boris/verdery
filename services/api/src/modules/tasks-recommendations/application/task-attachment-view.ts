/**
 * Maps the domain `TaskAttachment` to the shape `AttachTaskFile` returns — a
 * `toXxxResource(...)`-style view for the attachment aggregate, the same
 * convention `toPlantPhotoResource` follows for `plant_photo`, since
 * `AttachTaskFile` never changes `task` itself (see
 * `task-revision-journal-writer.ts`'s doc comment).
 */

import type { TaskAttachment } from '../domain/task-attachment.js';

export interface TaskAttachmentResource {
  readonly id: string;
  readonly taskId: string;
  readonly mediaId: string;
  readonly createdAt: string;
}

export function toTaskAttachmentResource(attachment: TaskAttachment): TaskAttachmentResource {
  return {
    id: attachment.id,
    taskId: attachment.taskId,
    mediaId: attachment.mediaId,
    createdAt: attachment.createdAt.toISOString(),
  };
}
