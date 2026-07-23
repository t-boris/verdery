/**
 * Routes one `recordType: 'task'` sync operation to tasks-recommendations'
 * eight task command classes.
 *
 * `attachTaskFile` returns a `TaskAttachmentResource`, not a `TaskResource` —
 * it does not touch `task` itself (see that command's own doc comment) — so
 * `recordRevisions` for it is built from a follow-up `TaskRepository.findById`
 * read of the task's own (unbumped) revision, the same pattern
 * `route-plant-operation.ts` uses for `attachPlantPhoto`/`setPrimaryPlantPhoto`.
 *
 * `operationId` reused as each command's own `idempotencyKey` argument for
 * the same reason `route-garden-operation.ts`'s own header comment gives.
 */

import type {
  SyncRecordReference,
  SyncTaskOperationPayload,
  Task as TaskResourceContract,
} from '@verdery/api-contracts';
import type {
  AttachTaskFile,
  CompleteTask,
  CreateManualTask,
  DeleteTask,
  DismissTask,
  EditTask,
  GetTask,
  RescheduleTask,
  SkipTask,
  TaskRepository,
} from '../../tasks-recommendations/public.js';
import type { TaskResource } from '../../tasks-recommendations/public.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import { InternalError } from '../../../platform/errors/application-error.js';
import { executeAndMapOutcome } from './execute-and-map-outcome.js';
import type { SyncOperationOutcome } from './sync-operation-outcome.js';

export interface TaskOperationRouterDependencies {
  readonly createManualTask: CreateManualTask;
  readonly editTask: EditTask;
  readonly rescheduleTask: RescheduleTask;
  readonly completeTask: CompleteTask;
  readonly dismissTask: DismissTask;
  readonly skipTask: SkipTask;
  readonly deleteTask: DeleteTask;
  readonly attachTaskFile: AttachTaskFile;
  readonly getTask: GetTask;
  readonly tasks: TaskRepository;
}

interface WireTimeWindow {
  readonly start?: string | null;
  readonly end?: string | null;
}

interface CommandTimeWindow {
  readonly start?: Date | null;
  readonly end?: Date | null;
}

/** `undefined` when the wire payload omitted `timeWindow` entirely — omitted from the built object below, not assigned `undefined`, to satisfy `exactOptionalPropertyTypes`. */
function toCommandTimeWindow(
  timeWindow: WireTimeWindow | undefined,
): CommandTimeWindow | undefined {
  if (timeWindow === undefined) {
    return undefined;
  }
  return {
    start:
      timeWindow.start === undefined || timeWindow.start === null
        ? null
        : new Date(timeWindow.start),
    end: timeWindow.end === undefined || timeWindow.end === null ? null : new Date(timeWindow.end),
  };
}

function toRecordRevisions(task: TaskResource | TaskResourceContract): SyncRecordReference[] {
  return [{ recordId: task.id, recordType: 'task', revision: task.revision }];
}

async function currentTaskRecordRevisions(
  deps: TaskOperationRouterDependencies,
  taskId: Uuid,
): Promise<SyncRecordReference[]> {
  const task = await deps.tasks.findById(taskId);
  if (task === null) {
    throw new InternalError(
      'synchronization.task.missing_after_write',
      'Task not found after a successful write.',
    );
  }
  return [{ recordId: task.id, recordType: 'task', revision: task.revision }];
}

export async function routeTaskOperation(
  deps: TaskOperationRouterDependencies,
  profileId: Uuid,
  operationId: Uuid,
  payload: SyncTaskOperationPayload,
): Promise<SyncOperationOutcome> {
  const { gardenId, command } = payload;

  // See `route-plant-operation.ts`'s own identical comment on why this cast
  // through `unknown` is correct, not a structural mismatch papered over.
  const fetchCurrentRecordFor = (taskId: Uuid) => async () => ({
    recordType: 'task' as const,
    data: (await deps.getTask.execute(
      gardenId,
      taskId,
      profileId,
    )) as unknown as TaskResourceContract,
  });

  switch (command.commandType) {
    case 'tasks.createManualTask':
      return executeAndMapOutcome(async () => {
        const timeWindow = toCommandTimeWindow(command.request.timeWindow);
        const task = await deps.createManualTask.execute(
          gardenId,
          profileId,
          {
            taskId: command.taskId,
            target: {
              kind: command.request.target.kind,
              ...(command.request.target.gardenAreaMapObjectId === undefined
                ? {}
                : { gardenAreaMapObjectId: command.request.target.gardenAreaMapObjectId }),
              ...(command.request.target.plantId === undefined
                ? {}
                : { plantId: command.request.target.plantId }),
            },
            title: command.request.title,
            notes: command.request.notes ?? null,
            dueDate: command.request.dueDate ?? null,
            ...(timeWindow === undefined ? {} : { timeWindow }),
            ...(command.request.urgency === undefined ? {} : { urgency: command.request.urgency }),
            originObservationId: command.request.originObservationId ?? null,
          },
          operationId,
        );
        return toRecordRevisions(task);
      }, null);

    case 'tasks.editTask':
      return executeAndMapOutcome(async () => {
        const timeWindow = toCommandTimeWindow(command.request.timeWindow);
        const task = await deps.editTask.execute(
          command.taskId,
          profileId,
          command.expectedRevision,
          {
            ...(command.request.title === undefined ? {} : { title: command.request.title }),
            ...(command.request.notes === undefined ? {} : { notes: command.request.notes }),
            ...(command.request.dueDate === undefined ? {} : { dueDate: command.request.dueDate }),
            ...(timeWindow === undefined ? {} : { timeWindow }),
            ...(command.request.urgency === undefined ? {} : { urgency: command.request.urgency }),
            ...(command.request.recurrenceRule === undefined
              ? {}
              : { recurrenceRule: command.request.recurrenceRule }),
          },
          operationId,
        );
        return toRecordRevisions(task);
      }, fetchCurrentRecordFor(command.taskId));

    case 'tasks.rescheduleTask':
      return executeAndMapOutcome(async () => {
        const timeWindow = toCommandTimeWindow(command.request.timeWindow);
        const task = await deps.rescheduleTask.execute(
          command.taskId,
          profileId,
          command.expectedRevision,
          {
            ...(command.request.dueDate === undefined ? {} : { dueDate: command.request.dueDate }),
            ...(timeWindow === undefined ? {} : { timeWindow }),
          },
          operationId,
        );
        return toRecordRevisions(task);
      }, fetchCurrentRecordFor(command.taskId));

    case 'tasks.completeTask':
      return executeAndMapOutcome(async () => {
        const task = await deps.completeTask.execute(
          command.taskId,
          profileId,
          command.expectedRevision,
          command.request.completionNote ?? null,
          operationId,
        );
        return toRecordRevisions(task);
      }, fetchCurrentRecordFor(command.taskId));

    case 'tasks.dismissTask':
      return executeAndMapOutcome(async () => {
        const task = await deps.dismissTask.execute(
          command.taskId,
          profileId,
          command.expectedRevision,
          command.request.reason ?? null,
          operationId,
        );
        return toRecordRevisions(task);
      }, fetchCurrentRecordFor(command.taskId));

    case 'tasks.skipTask':
      return executeAndMapOutcome(async () => {
        const task = await deps.skipTask.execute(
          command.taskId,
          profileId,
          command.expectedRevision,
          operationId,
        );
        return toRecordRevisions(task);
      }, fetchCurrentRecordFor(command.taskId));

    case 'tasks.deleteTask':
      return executeAndMapOutcome(async () => {
        const task = await deps.deleteTask.execute(
          command.taskId,
          profileId,
          command.expectedRevision,
          operationId,
        );
        return toRecordRevisions(task);
      }, fetchCurrentRecordFor(command.taskId));

    case 'tasks.attachTaskFile':
      return executeAndMapOutcome(async () => {
        await deps.attachTaskFile.execute(
          command.taskId,
          profileId,
          { mediaId: command.request.mediaId, taskAttachmentId: command.taskAttachmentId },
          operationId,
        );
        return currentTaskRecordRevisions(deps, command.taskId);
      }, null);
  }
}
