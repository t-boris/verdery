'use client';

import type { MediaAccess } from '@verdery/api-contracts';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import {
  ApiFailureError,
  createBrowserApiClient,
  createMediaGateway,
  isFailure,
  type ApiResult,
} from '@/core/api/public';

/**
 * TanStack Query hook for `GetMediaAccess` — the one Media read this feature
 * fits naturally into TanStack Query's ordinary cache-plus-refetch model.
 * (Upload orchestration itself is NOT a query/mutation pair: see
 * `media-upload-controller.ts`'s own doc comment for why a hand-rolled
 * controller fits chunked, pausable, resumable, polling upload state better
 * than TanStack Query's request-in-request-out mutation shape.)
 *
 * Source: architecture/web-application-design.md, section "8. API Access".
 */

const mediaAccessQueryKey = (gardenId: string, mediaId: string) =>
  ['media', gardenId, mediaId, 'access'] as const;

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
 * Only meaningful once a record reached `processingState === 'processed'`
 * (`GetMediaAccess` denies access before that — see `get-media-access.ts`'s
 * own doc comment) — callers pass `enabled` accordingly, typically
 * `processingState === 'processed'`.
 */
export function useMediaAccess(gardenId: string, mediaId: string, enabled: boolean) {
  const gateway = useMediaGateway();

  return useQuery<MediaAccess, ApiFailureError>({
    queryKey: mediaAccessQueryKey(gardenId, mediaId),
    queryFn: async ({ signal }) => unwrap(await gateway.getAccess(gardenId, mediaId, signal)),
    enabled,
    // The signed URL itself is short-lived (`MEDIA_SIGNED_DOWNLOAD_TTL_MS`,
    // 15 minutes by default — services/api/.../configuration-schema.ts).
    // Refetching a stale cached one before it actually expires keeps an
    // open preview from ever hitting a dead URL.
    staleTime: 5 * 60 * 1000,
  });
}
