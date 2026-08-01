'use client';

import type {
  AddClientUpdateItemRequest,
  ClientUpdate,
  ClientUpdateItem,
  ClientUpdateListResult,
  GrantPublisherAccessRequest,
  PublicationVersion,
  PublisherGrant,
  PublisherGrantListResult,
  PublishClientUpdateRequest,
  UpdateClientUpdateContentRequest,
  WithdrawClientUpdateRequest,
  WorkLogListResult,
} from '@verdery/api-contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';

import {
  ApiFailureError,
  createBrowserApiClient,
  createClientUpdateGateway,
  createPublisherGrantGateway,
  generateIdempotencyKey,
  isFailure,
  type ApiResult,
} from '@/core/api/public';

/**
 * TanStack Query hooks for the client-publication domain (P9C-PUBLISH-01):
 * publisher grants, the work-log candidate read, and the client-update
 * workflow — the same gateway-wrapped-in-`useMemo`,
 * `unwrap`-turns-failure-into-`ApiFailureError`,
 * fold-the-authoritative-response-back-with-`setQueryData` shape
 * `features/candidates/queries.ts` and `features/organizations/queries.ts`
 * already establish.
 *
 * Source: architecture/web-application-design.md, section "8. API Access";
 * packages/api-contracts/openapi.yaml, tag `Publications`.
 */

const publisherGrantsQueryKey = (engagementId: string) =>
  ['publisher-grants', engagementId] as const;
const workLogsQueryKey = (engagementId: string) => ['work-logs', engagementId] as const;
const clientUpdatesQueryKey = (engagementId: string) => ['client-updates', engagementId] as const;
const clientUpdateQueryKey = (engagementId: string, clientUpdateId: string) =>
  ['client-updates', engagementId, clientUpdateId] as const;

function useClientUpdateGateway() {
  return useMemo(() => createClientUpdateGateway(createBrowserApiClient()), []);
}

function usePublisherGrantGateway() {
  return useMemo(() => createPublisherGrantGateway(createBrowserApiClient()), []);
}

function unwrap<TData>(result: ApiResult<TData>): TData {
  if (isFailure(result)) {
    throw new ApiFailureError(result);
  }
  return result.data;
}

// --- Publisher grants --------------------------------------------------------

export function usePublisherGrants(engagementId: string) {
  const gateway = usePublisherGrantGateway();

  return useQuery<PublisherGrantListResult, ApiFailureError>({
    queryKey: publisherGrantsQueryKey(engagementId),
    queryFn: async ({ signal }) => unwrap(await gateway.list(engagementId, signal)),
  });
}

export function useGrantPublisherAccess(engagementId: string) {
  const gateway = usePublisherGrantGateway();
  const queryClient = useQueryClient();

  return useMutation<PublisherGrant, ApiFailureError, GrantPublisherAccessRequest>({
    mutationFn: async (input) =>
      unwrap(await gateway.grant(engagementId, input, generateIdempotencyKey())),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: publisherGrantsQueryKey(engagementId) });
    },
  });
}

export function useRevokePublisherAccess(engagementId: string) {
  const gateway = usePublisherGrantGateway();
  const queryClient = useQueryClient();

  return useMutation<PublisherGrant, ApiFailureError, string>({
    mutationFn: async (profileId) =>
      unwrap(await gateway.revoke(engagementId, profileId, generateIdempotencyKey())),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: publisherGrantsQueryKey(engagementId) });
    },
  });
}

// --- Work logs (the staging candidate list) ----------------------------------

export function useEngagementWorkLogs(engagementId: string) {
  const gateway = usePublisherGrantGateway();

  return useQuery<WorkLogListResult, ApiFailureError>({
    queryKey: workLogsQueryKey(engagementId),
    queryFn: async ({ signal }) => unwrap(await gateway.listWorkLogs(engagementId, signal)),
  });
}

// --- Client updates -----------------------------------------------------------

export function useClientUpdates(engagementId: string) {
  const gateway = useClientUpdateGateway();

  return useQuery<ClientUpdateListResult, ApiFailureError>({
    queryKey: clientUpdatesQueryKey(engagementId),
    queryFn: async ({ signal }) => unwrap(await gateway.list(engagementId, signal)),
  });
}

export function useClientUpdate(engagementId: string, clientUpdateId: string) {
  const gateway = useClientUpdateGateway();

  return useQuery<ClientUpdate, ApiFailureError>({
    queryKey: clientUpdateQueryKey(engagementId, clientUpdateId),
    queryFn: async ({ signal }) => unwrap(await gateway.get(engagementId, clientUpdateId, signal)),
  });
}

export function useCreateClientUpdate(engagementId: string) {
  const gateway = useClientUpdateGateway();
  const queryClient = useQueryClient();

  return useMutation<ClientUpdate, ApiFailureError, string>({
    mutationFn: async (title) =>
      unwrap(await gateway.create(engagementId, { title }, generateIdempotencyKey())),
    onSuccess: (update) => {
      queryClient.setQueryData(clientUpdateQueryKey(engagementId, update.id), update);
      void queryClient.invalidateQueries({ queryKey: clientUpdatesQueryKey(engagementId) });
    },
  });
}

export interface UpdateClientUpdateContentVariables {
  readonly input: UpdateClientUpdateContentRequest;
  readonly expectedRevision: number;
}

export function useUpdateClientUpdateContent(engagementId: string, clientUpdateId: string) {
  const gateway = useClientUpdateGateway();
  const queryClient = useQueryClient();

  return useMutation<ClientUpdate, ApiFailureError, UpdateClientUpdateContentVariables>({
    mutationFn: async ({ input, expectedRevision }) =>
      unwrap(
        await gateway.updateContent(
          engagementId,
          clientUpdateId,
          input,
          expectedRevision,
          generateIdempotencyKey(),
        ),
      ),
    onSuccess: (update) => {
      queryClient.setQueryData(clientUpdateQueryKey(engagementId, clientUpdateId), update);
    },
  });
}

export function useSubmitClientUpdate(engagementId: string, clientUpdateId: string) {
  const gateway = useClientUpdateGateway();
  const queryClient = useQueryClient();

  return useMutation<ClientUpdate, ApiFailureError, number>({
    mutationFn: async (expectedRevision) =>
      unwrap(
        await gateway.submit(
          engagementId,
          clientUpdateId,
          expectedRevision,
          generateIdempotencyKey(),
        ),
      ),
    onSuccess: (update) => {
      queryClient.setQueryData(clientUpdateQueryKey(engagementId, clientUpdateId), update);
    },
  });
}

export interface PublishClientUpdateVariables {
  readonly input: PublishClientUpdateRequest;
  readonly expectedRevision: number;
}

/**
 * Publishing produces a `PublicationVersion`, not the `ClientUpdate` itself
 * — the caller refetches the update afterward (its `state` moved to
 * `published`) rather than this hook guessing the new shape from the
 * version response, the same "don't fabricate a cache entry from a
 * different resource's response" discipline `useConvertCandidate` documents
 * for its own two-resource response.
 */
export function usePublishClientUpdate(engagementId: string, clientUpdateId: string) {
  const gateway = useClientUpdateGateway();
  const queryClient = useQueryClient();

  return useMutation<PublicationVersion, ApiFailureError, PublishClientUpdateVariables>({
    mutationFn: async ({ input, expectedRevision }) =>
      unwrap(
        await gateway.publish(
          engagementId,
          clientUpdateId,
          input,
          expectedRevision,
          generateIdempotencyKey(),
        ),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: clientUpdateQueryKey(engagementId, clientUpdateId),
      });
    },
  });
}

export interface WithdrawClientUpdateVariables {
  readonly input: WithdrawClientUpdateRequest;
  readonly expectedRevision: number;
}

export function useWithdrawClientUpdate(engagementId: string, clientUpdateId: string) {
  const gateway = useClientUpdateGateway();
  const queryClient = useQueryClient();

  return useMutation<ClientUpdate, ApiFailureError, WithdrawClientUpdateVariables>({
    mutationFn: async ({ input, expectedRevision }) =>
      unwrap(
        await gateway.withdraw(
          engagementId,
          clientUpdateId,
          input,
          expectedRevision,
          generateIdempotencyKey(),
        ),
      ),
    onSuccess: (update) => {
      queryClient.setQueryData(clientUpdateQueryKey(engagementId, clientUpdateId), update);
    },
  });
}

export function useAddClientUpdateItem(engagementId: string, clientUpdateId: string) {
  const gateway = useClientUpdateGateway();
  const queryClient = useQueryClient();

  return useMutation<ClientUpdateItem, ApiFailureError, AddClientUpdateItemRequest>({
    mutationFn: async (input) =>
      unwrap(await gateway.addItem(engagementId, clientUpdateId, input, generateIdempotencyKey())),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: clientUpdateQueryKey(engagementId, clientUpdateId),
      });
    },
  });
}

export function useRemoveClientUpdateItem(engagementId: string, clientUpdateId: string) {
  const gateway = useClientUpdateGateway();
  const queryClient = useQueryClient();

  return useMutation<ClientUpdateItem, ApiFailureError, string>({
    mutationFn: async (itemId) =>
      unwrap(
        await gateway.removeItem(engagementId, clientUpdateId, itemId, generateIdempotencyKey()),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: clientUpdateQueryKey(engagementId, clientUpdateId),
      });
    },
  });
}
