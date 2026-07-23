/**
 * Appends a `task_attachment` row. Does not touch `task` itself — no
 * `expectedRevision`, no `task_revision` journal entry — see
 * `task-revision-journal-writer.ts`'s doc comment on `TaskCommandType` for
 * why, the same carve-out `AttachPlantPhoto` documents for `plant`/
 * `plant_photo`.
 *
 * Still writes a `platform.sync_change` row for the *task* (not the
 * attachment, which has no sync record type of its own — see
 * `architecture/offline-synchronization.md` section 18), at
 * `task.revision` exactly as fetched by `requireTaskAndAuthorize` — never
 * bumped, since this command does not touch `task` — the same reasoning
 * `AttachPlantPhoto` documents for `plant`.
 */

import type { IdempotencyStore } from '../../../platform/idempotency/idempotency-store.js';
import { generateUuidV7 } from '../../../shared/identifiers/uuid.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { Clock } from '../../../shared/time/clock.js';
import type { GardenAuthorization } from '../../gardens-mapping/public.js';
import { createTaskAttachment } from '../domain/task-attachment.js';
import { invalidMediaReferenceError } from './task-errors.js';
import { requireTaskAndAuthorize } from './require-task-and-authorize.js';
import { runIdempotentCommand } from './run-idempotent-command.js';
import { toTaskAttachmentResource, type TaskAttachmentResource } from './task-attachment-view.js';
import type { TaskRepository } from './task-repository.js';
import type { TasksRecommendationsUnitOfWork } from './tasks-recommendations-unit-of-work.js';

const OPERATION = 'tasks.attachTaskFile';

export interface AttachTaskFileInput {
  readonly mediaId: Uuid;
}

export class AttachTaskFile {
  constructor(
    private readonly tasks: TaskRepository,
    private readonly idempotency: IdempotencyStore,
    private readonly unitOfWork: TasksRecommendationsUnitOfWork,
    private readonly authorization: GardenAuthorization,
    private readonly clock: Clock,
  ) {}

  async execute(
    taskId: Uuid,
    profileId: Uuid,
    input: AttachTaskFileInput,
    idempotencyKey: string,
  ): Promise<TaskAttachmentResource> {
    const task = await requireTaskAndAuthorize(this.tasks, this.authorization, taskId, profileId);

    const idempotencyInput = {
      actorProfileId: profileId,
      operation: OPERATION,
      idempotencyKey,
      requestFingerprint: JSON.stringify({ taskId, input }),
    };

    return runIdempotentCommand(
      this.idempotency,
      this.unitOfWork,
      idempotencyInput,
      201,
      async (context) => {
        const media = await context.media.get(input.mediaId);
        if (media === null) {
          throw invalidMediaReferenceError('/mediaId');
        }

        const now = this.clock.now();
        const attachment = createTaskAttachment(generateUuidV7(), taskId, input.mediaId, now);
        await context.taskAttachments.insert(attachment);
        await context.syncChanges.record({
          gardenId: task.gardenId,
          recordId: task.id,
          recordType: 'task',
          operation: 'upsert',
          recordRevision: task.revision,
        });

        return toTaskAttachmentResource(attachment);
      },
    );
  }
}
