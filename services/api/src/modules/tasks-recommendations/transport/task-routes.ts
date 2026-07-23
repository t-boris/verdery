/**
 * Task HTTP routes.
 *
 * Request validation here is hand-written against the same rules the
 * OpenAPI document declares (`packages/api-contracts/openapi.yaml`, tag
 * `Tasks`), not derived from it automatically — the same convention
 * `gardens-mapping/transport/garden-routes.ts`'s own header comment
 * describes. Reuses that file's exported `UUID_PATTERN`/`requireGardenId`/
 * `requireIdempotencyKey`/`requireExpectedRevision`/`invalid`.
 *
 * `deleteTask` is `POST .../delete`, not HTTP `DELETE` — see the OpenAPI
 * operation's own description for the rationale (consistency with its four
 * `POST` terminal-transition siblings on this same resource).
 *
 * Every command here already returns its own `TaskResource`/
 * `TaskAttachmentResource`, built to match this tag's schemas
 * field-for-field (see `application/task-view.ts`'s own doc comment), so no
 * per-response mapping step is needed beyond wrapping a list in `{ items }`.
 *
 * Source: packages/api-contracts/openapi.yaml, tag `Tasks`;
 * implementation-plan.md work package P4-CONTRACT-01.
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  UUID_PATTERN,
  invalid,
  requireExpectedRevision,
  requireGardenId,
  requireIdempotencyKey,
} from '../../gardens-mapping/transport/garden-routes.js';
import type { AttachTaskFile } from '../application/attach-task-file.js';
import type { CompleteTask } from '../application/complete-task.js';
import type { CreateManualTask } from '../application/create-manual-task.js';
import type { DeleteTask } from '../application/delete-task.js';
import type { DismissTask } from '../application/dismiss-task.js';
import type { EditTask } from '../application/edit-task.js';
import type { ListTasksForGarden } from '../application/list-tasks-for-garden.js';
import type { RescheduleTask } from '../application/reschedule-task.js';
import type { SkipTask } from '../application/skip-task.js';
import type { TaskStatus } from '../domain/task-lifecycle.js';
import {
  TASK_STATUSES,
  parseAttachTaskFileRequest,
  parseCompletionNote,
  parseCreateManualTaskRequest,
  parseDismissReason,
  parseEditTaskRequest,
  parseRescheduleTaskRequest,
} from './parse-task-request.js';

export interface TaskRoutesDependencies {
  readonly createManualTask: CreateManualTask;
  readonly listTasksForGarden: ListTasksForGarden;
  readonly editTask: EditTask;
  readonly rescheduleTask: RescheduleTask;
  readonly completeTask: CompleteTask;
  readonly dismissTask: DismissTask;
  readonly skipTask: SkipTask;
  readonly deleteTask: DeleteTask;
  readonly attachTaskFile: AttachTaskFile;
}

function requireTaskId(request: FastifyRequest): string {
  const { taskId } = request.params as { taskId?: unknown };

  if (typeof taskId !== 'string' || !UUID_PATTERN.test(taskId)) {
    throw invalid('taskId must be a UUID.', 'request.task_id.invalid', '/taskId');
  }

  return taskId;
}

/** Parses the comma-separated `status` query parameter (OpenAPI `style: form, explode: false`). */
function parseStatusFilter(request: FastifyRequest): readonly TaskStatus[] | undefined {
  const { status } = request.query as { status?: unknown };
  if (status === undefined) {
    return undefined;
  }
  if (typeof status !== 'string' || status.length === 0) {
    throw invalid(
      'status must be a comma-separated list of statuses.',
      'request.invalid',
      '/status',
    );
  }

  return status.split(',').map((candidate) => {
    if (!(TASK_STATUSES as readonly string[]).includes(candidate)) {
      throw invalid(
        `status must be one of: ${TASK_STATUSES.join(', ')}.`,
        'request.enum.invalid',
        '/status',
      );
    }
    return candidate as TaskStatus;
  });
}

/**
 * Wraps a list in `{ items }`, matching the `TaskListResult` shape — untyped
 * against the generated contract type on purpose, the same way every other
 * response here is sent without a compile-time JSON-schema bridge (see this
 * file's own header comment).
 */
function toItemsResult<T>(items: readonly T[]): { items: T[] } {
  return { items: [...items] };
}

export function registerTaskRoutes(app: FastifyInstance, deps: TaskRoutesDependencies): void {
  app.post('/gardens/:gardenId/tasks', async (request, reply) => {
    const gardenId = requireGardenId(request);
    const idempotencyKey = requireIdempotencyKey(request);
    const input = parseCreateManualTaskRequest(request.body);

    const task = await deps.createManualTask.execute(
      gardenId,
      request.actorContext.profileId,
      input,
      idempotencyKey,
    );

    return reply.status(201).send(task);
  });

  app.get('/gardens/:gardenId/tasks', async (request, reply) => {
    const gardenId = requireGardenId(request);
    const statusFilter = parseStatusFilter(request);

    const items = await deps.listTasksForGarden.execute(
      gardenId,
      request.actorContext.profileId,
      statusFilter,
    );

    return reply.status(200).send(toItemsResult(items));
  });

  app.patch('/gardens/:gardenId/tasks/:taskId', async (request, reply) => {
    requireGardenId(request);
    const taskId = requireTaskId(request);
    const idempotencyKey = requireIdempotencyKey(request);
    const expectedRevision = requireExpectedRevision(request);
    const changes = parseEditTaskRequest(request.body);

    const task = await deps.editTask.execute(
      taskId,
      request.actorContext.profileId,
      expectedRevision,
      changes,
      idempotencyKey,
    );

    return reply.status(200).send(task);
  });

  app.post('/gardens/:gardenId/tasks/:taskId/reschedule', async (request, reply) => {
    requireGardenId(request);
    const taskId = requireTaskId(request);
    const idempotencyKey = requireIdempotencyKey(request);
    const expectedRevision = requireExpectedRevision(request);
    const input = parseRescheduleTaskRequest(request.body);

    const task = await deps.rescheduleTask.execute(
      taskId,
      request.actorContext.profileId,
      expectedRevision,
      input,
      idempotencyKey,
    );

    return reply.status(200).send(task);
  });

  app.post('/gardens/:gardenId/tasks/:taskId/complete', async (request, reply) => {
    requireGardenId(request);
    const taskId = requireTaskId(request);
    const idempotencyKey = requireIdempotencyKey(request);
    const expectedRevision = requireExpectedRevision(request);
    const completionNote = parseCompletionNote(request.body);

    const task = await deps.completeTask.execute(
      taskId,
      request.actorContext.profileId,
      expectedRevision,
      completionNote,
      idempotencyKey,
    );

    return reply.status(200).send(task);
  });

  app.post('/gardens/:gardenId/tasks/:taskId/dismiss', async (request, reply) => {
    requireGardenId(request);
    const taskId = requireTaskId(request);
    const idempotencyKey = requireIdempotencyKey(request);
    const expectedRevision = requireExpectedRevision(request);
    const reason = parseDismissReason(request.body);

    const task = await deps.dismissTask.execute(
      taskId,
      request.actorContext.profileId,
      expectedRevision,
      reason,
      idempotencyKey,
    );

    return reply.status(200).send(task);
  });

  app.post('/gardens/:gardenId/tasks/:taskId/skip', async (request, reply) => {
    requireGardenId(request);
    const taskId = requireTaskId(request);
    const idempotencyKey = requireIdempotencyKey(request);
    const expectedRevision = requireExpectedRevision(request);

    const task = await deps.skipTask.execute(
      taskId,
      request.actorContext.profileId,
      expectedRevision,
      idempotencyKey,
    );

    return reply.status(200).send(task);
  });

  app.post('/gardens/:gardenId/tasks/:taskId/delete', async (request, reply) => {
    requireGardenId(request);
    const taskId = requireTaskId(request);
    const idempotencyKey = requireIdempotencyKey(request);
    const expectedRevision = requireExpectedRevision(request);

    const task = await deps.deleteTask.execute(
      taskId,
      request.actorContext.profileId,
      expectedRevision,
      idempotencyKey,
    );

    return reply.status(200).send(task);
  });

  app.post('/gardens/:gardenId/tasks/:taskId/attachments', async (request, reply) => {
    requireGardenId(request);
    const taskId = requireTaskId(request);
    const idempotencyKey = requireIdempotencyKey(request);
    const input = parseAttachTaskFileRequest(request.body);

    const attachment = await deps.attachTaskFile.execute(
      taskId,
      request.actorContext.profileId,
      input,
      idempotencyKey,
    );

    return reply.status(201).send(attachment);
  });
}
