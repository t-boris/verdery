'use client';

import type {
  CompleteTaskRequest,
  CreateManualTaskRequest,
  DismissTaskRequest,
  EditTaskRequest,
  RescheduleTaskRequest,
  Task,
  TaskListResult,
  TaskStatus,
} from '@verdery/api-contracts';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';

import {
  ApiFailureError,
  createBrowserApiClient,
  createTaskGateway,
  generateIdempotencyKey,
  isFailure,
  type ApiResult,
} from '@/core/api/public';

/**
 * TanStack Query hooks for the tasks-recommendations manual-task endpoints.
 *
 * Mirrors `features/gardens/queries.ts`. The list query key includes the
 * status filter, so every mutation invalidates the whole `['tasks',
 * gardenId]` prefix — every filtered variant currently cached — rather than
 * only the one the mutating view happened to be showing, the same
 * broad-invalidation choice `features/gardens/queries.ts` makes for its own
 * single list query.
 *
 * Source: architecture/web-application-design.md, section "8. API Access".
 */

const tasksBaseQueryKey = (gardenId: string) => ['tasks', gardenId] as const;
const tasksQueryKey = (gardenId: string, statuses: readonly TaskStatus[] | null) =>
  [
    ...tasksBaseQueryKey(gardenId),
    statuses === null ? 'all' : [...statuses].sort().join(','),
  ] as const;

function useTaskGateway() {
  return useMemo(() => createTaskGateway(createBrowserApiClient()), []);
}

function unwrap<TData>(result: ApiResult<TData>): TData {
  if (isFailure(result)) {
    throw new ApiFailureError(result);
  }
  return result.data;
}

function invalidateTasks(queryClient: QueryClient, gardenId: string) {
  void queryClient.invalidateQueries({ queryKey: tasksBaseQueryKey(gardenId) });
}

export function useTasksForGarden(gardenId: string, statuses: readonly TaskStatus[] | null) {
  const gateway = useTaskGateway();

  return useQuery<TaskListResult, ApiFailureError>({
    queryKey: tasksQueryKey(gardenId, statuses),
    queryFn: async ({ signal }) => unwrap(await gateway.list(gardenId, statuses, signal)),
  });
}

export function useCreateManualTask(gardenId: string) {
  const gateway = useTaskGateway();
  const queryClient = useQueryClient();

  return useMutation<Task, ApiFailureError, CreateManualTaskRequest>({
    mutationFn: async (input) =>
      unwrap(await gateway.create(gardenId, input, generateIdempotencyKey())),
    onSuccess: () => invalidateTasks(queryClient, gardenId),
  });
}

export interface EditTaskVariables {
  readonly input: EditTaskRequest;
  readonly expectedRevision: number;
}

export function useEditTask(gardenId: string, taskId: string) {
  const gateway = useTaskGateway();
  const queryClient = useQueryClient();

  return useMutation<Task, ApiFailureError, EditTaskVariables>({
    mutationFn: async ({ input, expectedRevision }) =>
      unwrap(
        await gateway.edit(gardenId, taskId, input, expectedRevision, generateIdempotencyKey()),
      ),
    onSuccess: () => invalidateTasks(queryClient, gardenId),
  });
}

export interface RescheduleTaskVariables {
  readonly input: RescheduleTaskRequest;
  readonly expectedRevision: number;
}

export function useRescheduleTask(gardenId: string, taskId: string) {
  const gateway = useTaskGateway();
  const queryClient = useQueryClient();

  return useMutation<Task, ApiFailureError, RescheduleTaskVariables>({
    mutationFn: async ({ input, expectedRevision }) =>
      unwrap(
        await gateway.reschedule(
          gardenId,
          taskId,
          input,
          expectedRevision,
          generateIdempotencyKey(),
        ),
      ),
    onSuccess: () => invalidateTasks(queryClient, gardenId),
  });
}

export interface CompleteTaskVariables {
  readonly input: CompleteTaskRequest;
  readonly expectedRevision: number;
}

export function useCompleteTask(gardenId: string, taskId: string) {
  const gateway = useTaskGateway();
  const queryClient = useQueryClient();

  return useMutation<Task, ApiFailureError, CompleteTaskVariables>({
    mutationFn: async ({ input, expectedRevision }) =>
      unwrap(
        await gateway.complete(gardenId, taskId, input, expectedRevision, generateIdempotencyKey()),
      ),
    onSuccess: () => invalidateTasks(queryClient, gardenId),
  });
}

export interface DismissTaskVariables {
  readonly input: DismissTaskRequest;
  readonly expectedRevision: number;
}

export function useDismissTask(gardenId: string, taskId: string) {
  const gateway = useTaskGateway();
  const queryClient = useQueryClient();

  return useMutation<Task, ApiFailureError, DismissTaskVariables>({
    mutationFn: async ({ input, expectedRevision }) =>
      unwrap(
        await gateway.dismiss(gardenId, taskId, input, expectedRevision, generateIdempotencyKey()),
      ),
    onSuccess: () => invalidateTasks(queryClient, gardenId),
  });
}

export function useSkipTask(gardenId: string, taskId: string) {
  const gateway = useTaskGateway();
  const queryClient = useQueryClient();

  return useMutation<Task, ApiFailureError, number>({
    mutationFn: async (expectedRevision) =>
      unwrap(await gateway.skip(gardenId, taskId, expectedRevision, generateIdempotencyKey())),
    onSuccess: () => invalidateTasks(queryClient, gardenId),
  });
}

export function useDeleteTask(gardenId: string, taskId: string) {
  const gateway = useTaskGateway();
  const queryClient = useQueryClient();

  return useMutation<Task, ApiFailureError, number>({
    mutationFn: async (expectedRevision) =>
      unwrap(await gateway.delete(gardenId, taskId, expectedRevision, generateIdempotencyKey())),
    onSuccess: () => invalidateTasks(queryClient, gardenId),
  });
}
