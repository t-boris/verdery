'use client';

import type { MediaAccess, MediaListResult } from '@verdery/api-contracts';
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

/**
 * Whether this garden already holds a photograph with exactly these bytes.
 *
 * Runs against `checksumSha256`, which the browser computed before
 * registering the upload — so it answers "you have uploaded this same file
 * before", not "this looks like the same plant". A re-encoded or re-cropped
 * copy of the same scene has a different checksum and is deliberately not
 * found: recognising that needs a perceptual hash this system does not
 * compute, an owner decision recorded in tasks/todo.md.
 *
 * The just-uploaded record is excluded by id — it matches its own checksum,
 * and reporting it would make every upload look like a duplicate of itself.
 */
export function useExactDuplicateMedia(
  gardenId: string,
  checksumSha256: string | null,
  excludeMediaId: string | null,
) {
  const gateway = useMemo(() => createMediaGateway(createBrowserApiClient()), []);

  const query = useQuery<MediaListResult, ApiFailureError>({
    queryKey: ['media', gardenId, 'duplicates', checksumSha256] as const,
    queryFn: async ({ signal }) =>
      unwrap(
        // Non-null inside the query function: `enabled` keeps it from running
        // before a checksum exists.
        await gateway.list(gardenId, { checksumSha256: checksumSha256 as string }, signal),
      ),
    enabled: checksumSha256 !== null,
  });

  const duplicates = (query.data?.items ?? []).filter((media) => media.id !== excludeMediaId);

  return { duplicates, isPending: query.isPending };
}
