'use client';

import type { Media, MediaAccess, MediaListResult } from '@verdery/api-contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';

import {
  ApiFailureError,
  createBrowserApiClient,
  createMediaGateway,
  generateIdempotencyKey,
  isFailure,
  type ApiResult,
} from '@/core/api/public';

/**
 * The map feature's OWN media reads (P6-PLAN-01): the imported-plan picker
 * list, a plan's status/derivatives, and short-lived derivative access.
 *
 * Built directly on `core/api`'s `createMediaGateway` rather than importing
 * `features/media` — "Features import public Core and Shared interfaces
 * only" (architecture/web-application-design.md, section "20. Dependency
 * Rules"), so one feature never imports another. Query keys deliberately
 * match `features/media/queries.ts`'s shapes for the overlapping reads, so
 * both features share one cache entry for the same endpoint rather than
 * fetching it twice.
 */

function useMediaGateway() {
  return useMemo(() => createMediaGateway(createBrowserApiClient()), []);
}

function unwrap<TData>(result: ApiResult<TData>): TData {
  if (isFailure(result)) {
    throw new ApiFailureError(result);
  }
  return result.data;
}

/**
 * `ListGardenMedia`, single-page: the imported-background panel lists a
 * garden's `imported_plan` documents. First page only — the contract
 * paginates (`nextCursor`), but a picker showing the 50 most recent plans
 * covers any realistic garden; a pagination UI is not built until a real
 * garden outgrows this.
 */
export function useGardenPlanMediaList(gardenId: string) {
  const gateway = useMediaGateway();

  return useQuery<MediaListResult, ApiFailureError>({
    queryKey: ['media', gardenId, 'list', 'imported_plan'] as const,
    queryFn: async ({ signal }) =>
      unwrap(await gateway.list(gardenId, { mediaClass: 'imported_plan' }, signal)),
  });
}

/**
 * `DeleteGardenMedia` for an imported plan.
 *
 * The capability existed on the server from P6-RET-01 and had no way in from
 * the web at all: a plan uploaded twice stayed in the list for ever, which is
 * exactly what an owner hit on 2026-08-06. A plan still placed on the map
 * answers `409 media.referenced` — the background is removed first, and the
 * panel says so rather than swallowing it.
 */
export function useDeleteGardenPlan(gardenId: string) {
  const gateway = useMediaGateway();
  const queryClient = useQueryClient();

  return useMutation<
    Media,
    ApiFailureError,
    { readonly mediaId: string; readonly revision: number }
  >({
    mutationFn: async ({ mediaId, revision }) =>
      unwrap(await gateway.delete(gardenId, mediaId, revision, generateIdempotencyKey())),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['media', gardenId] });
    },
  });
}

/**
 * `GetMediaStatus` as an ordinary query — distinct from
 * `features/media`'s upload controller polling, which owns the *upload*
 * lifecycle. This serves an imported background that holds a `planMediaId`
 * and needs its state and `derivatives` for display.
 */
export function useMediaStatus(gardenId: string, mediaId: string, enabled = true) {
  const gateway = useMediaGateway();

  return useQuery<Media, ApiFailureError>({
    queryKey: ['media', gardenId, mediaId, 'status'] as const,
    queryFn: async ({ signal }) => unwrap(await gateway.getStatus(gardenId, mediaId, signal)),
    enabled,
  });
}

/** Same contract and `staleTime` reasoning as `features/media/queries.ts`'s `useMediaAccess` — see that hook's own comment on the signed-URL TTL. */
export function useMediaAccess(gardenId: string, mediaId: string, enabled: boolean) {
  const gateway = useMediaGateway();

  return useQuery<MediaAccess, ApiFailureError>({
    queryKey: ['media', gardenId, mediaId, 'access'] as const,
    queryFn: async ({ signal }) => unwrap(await gateway.getAccess(gardenId, mediaId, signal)),
    enabled,
    staleTime: 5 * 60 * 1000,
  });
}
