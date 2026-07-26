import type {
  AssignTaskRequest,
  AttachTaskFileRequest,
  CompleteTaskRequest,
  CreateManualTaskRequest,
  DismissTaskRequest,
  EditTaskRequest,
  RescheduleTaskRequest,
  Task,
  TaskActivityListResult,
  TaskAttachment,
  TaskListResult,
  TaskStatus,
} from '@verdery/api-contracts';
import { IDEMPOTENCY_KEY_HEADER, IF_MATCH_HEADER } from '@verdery/api-contracts';

import type { ApiClient } from './client';
import { csrfHeader } from './csrf';
import type { ApiResult } from './result';

export interface TaskGateway {
  create(
    gardenId: string,
    input: CreateManualTaskRequest,
    idempotencyKey: string,
    signal?: AbortSignal,
  ): Promise<ApiResult<Task>>;
  list(
    gardenId: string,
    statuses: readonly TaskStatus[] | null,
    signal?: AbortSignal,
  ): Promise<ApiResult<TaskListResult>>;
  edit(
    gardenId: string,
    taskId: string,
    input: EditTaskRequest,
    expectedRevision: number,
    idempotencyKey: string,
    signal?: AbortSignal,
  ): Promise<ApiResult<Task>>;
  reschedule(
    gardenId: string,
    taskId: string,
    input: RescheduleTaskRequest,
    expectedRevision: number,
    idempotencyKey: string,
    signal?: AbortSignal,
  ): Promise<ApiResult<Task>>;
  complete(
    gardenId: string,
    taskId: string,
    input: CompleteTaskRequest,
    expectedRevision: number,
    idempotencyKey: string,
    signal?: AbortSignal,
  ): Promise<ApiResult<Task>>;
  dismiss(
    gardenId: string,
    taskId: string,
    input: DismissTaskRequest,
    expectedRevision: number,
    idempotencyKey: string,
    signal?: AbortSignal,
  ): Promise<ApiResult<Task>>;
  skip(
    gardenId: string,
    taskId: string,
    expectedRevision: number,
    idempotencyKey: string,
    signal?: AbortSignal,
  ): Promise<ApiResult<Task>>;
  delete(
    gardenId: string,
    taskId: string,
    expectedRevision: number,
    idempotencyKey: string,
    signal?: AbortSignal,
  ): Promise<ApiResult<Task>>;
  attachFile(
    gardenId: string,
    taskId: string,
    input: AttachTaskFileRequest,
    idempotencyKey: string,
    signal?: AbortSignal,
  ): Promise<ApiResult<TaskAttachment>>;
  assign(
    gardenId: string,
    taskId: string,
    input: AssignTaskRequest,
    expectedRevision: number,
    idempotencyKey: string,
    signal?: AbortSignal,
  ): Promise<ApiResult<Task>>;
  activity(
    gardenId: string,
    taskId: string,
    signal?: AbortSignal,
  ): Promise<ApiResult<TaskActivityListResult>>;
}

function revisionHeaders(expectedRevision: number, idempotencyKey: string): Record<string, string> {
  return {
    [IDEMPOTENCY_KEY_HEADER]: idempotencyKey,
    [IF_MATCH_HEADER]: `"${String(expectedRevision)}"`,
    ...csrfHeader(),
  };
}

function listQuery(statuses: readonly TaskStatus[] | null): string {
  if (statuses === null || statuses.length === 0) {
    return '';
  }
  return `?status=${statuses.map(encodeURIComponent).join(',')}`;
}

/**
 * Gateway for the tasks-recommendations manual-task endpoints.
 *
 * `attachFile` is implemented for contract completeness and covered by
 * `task-gateway.test.ts`, but no `features/tasks` hook or component calls it
 * this pass — the same media-upload gap `plant-gateway.ts`'s module doc
 * comment explains. `deleteTask` is a status transition (`POST`, not HTTP
 * `DELETE`) per the contract's own `deleteTask` operation description; this
 * gateway's `delete` method name reflects the UI action, not the verb.
 *
 * `assign`/`activity` are P9A-TASK-01's assignment and shared-activity-history
 * operations: `assign` shares `revisionHeaders` with every other
 * revision-guarded mutation on this tag, so a stale assignment surfaces the
 * identical `412`/`error.staleRevision` conflict `edit`/`reschedule` already
 * do. `activity` carries neither header — it is a plain read, open to every
 * garden role per the operation's own contract description.
 *
 * Source: packages/api-contracts/openapi.yaml, tag `Tasks`;
 * architecture/web-application-design.md, section "8. API Access".
 */
export function createTaskGateway(client: ApiClient): TaskGateway {
  return {
    create(gardenId, input, idempotencyKey, signal) {
      return client.request<Task>({
        method: 'POST',
        path: `/gardens/${gardenId}/tasks`,
        body: input,
        headers: { [IDEMPOTENCY_KEY_HEADER]: idempotencyKey, ...csrfHeader() },
        ...(signal === undefined ? {} : { signal }),
      });
    },

    list(gardenId, statuses, signal) {
      return client.request<TaskListResult>({
        method: 'GET',
        path: `/gardens/${gardenId}/tasks${listQuery(statuses)}`,
        ...(signal === undefined ? {} : { signal }),
      });
    },

    edit(gardenId, taskId, input, expectedRevision, idempotencyKey, signal) {
      return client.request<Task>({
        method: 'PATCH',
        path: `/gardens/${gardenId}/tasks/${taskId}`,
        body: input,
        headers: revisionHeaders(expectedRevision, idempotencyKey),
        ...(signal === undefined ? {} : { signal }),
      });
    },

    reschedule(gardenId, taskId, input, expectedRevision, idempotencyKey, signal) {
      return client.request<Task>({
        method: 'POST',
        path: `/gardens/${gardenId}/tasks/${taskId}/reschedule`,
        body: input,
        headers: revisionHeaders(expectedRevision, idempotencyKey),
        ...(signal === undefined ? {} : { signal }),
      });
    },

    complete(gardenId, taskId, input, expectedRevision, idempotencyKey, signal) {
      return client.request<Task>({
        method: 'POST',
        path: `/gardens/${gardenId}/tasks/${taskId}/complete`,
        body: input,
        headers: revisionHeaders(expectedRevision, idempotencyKey),
        ...(signal === undefined ? {} : { signal }),
      });
    },

    dismiss(gardenId, taskId, input, expectedRevision, idempotencyKey, signal) {
      return client.request<Task>({
        method: 'POST',
        path: `/gardens/${gardenId}/tasks/${taskId}/dismiss`,
        body: input,
        headers: revisionHeaders(expectedRevision, idempotencyKey),
        ...(signal === undefined ? {} : { signal }),
      });
    },

    skip(gardenId, taskId, expectedRevision, idempotencyKey, signal) {
      return client.request<Task>({
        method: 'POST',
        path: `/gardens/${gardenId}/tasks/${taskId}/skip`,
        headers: revisionHeaders(expectedRevision, idempotencyKey),
        ...(signal === undefined ? {} : { signal }),
      });
    },

    delete(gardenId, taskId, expectedRevision, idempotencyKey, signal) {
      return client.request<Task>({
        method: 'POST',
        path: `/gardens/${gardenId}/tasks/${taskId}/delete`,
        headers: revisionHeaders(expectedRevision, idempotencyKey),
        ...(signal === undefined ? {} : { signal }),
      });
    },

    attachFile(gardenId, taskId, input, idempotencyKey, signal) {
      return client.request<TaskAttachment>({
        method: 'POST',
        path: `/gardens/${gardenId}/tasks/${taskId}/attachments`,
        body: input,
        headers: { [IDEMPOTENCY_KEY_HEADER]: idempotencyKey, ...csrfHeader() },
        ...(signal === undefined ? {} : { signal }),
      });
    },

    assign(gardenId, taskId, input, expectedRevision, idempotencyKey, signal) {
      return client.request<Task>({
        method: 'POST',
        path: `/gardens/${gardenId}/tasks/${taskId}/assign`,
        body: input,
        headers: revisionHeaders(expectedRevision, idempotencyKey),
        ...(signal === undefined ? {} : { signal }),
      });
    },

    activity(gardenId, taskId, signal) {
      return client.request<TaskActivityListResult>({
        method: 'GET',
        path: `/gardens/${gardenId}/tasks/${taskId}/activity`,
        ...(signal === undefined ? {} : { signal }),
      });
    },
  };
}
