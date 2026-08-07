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
 * Persistent property-plan library for garden settings and the map picker.
 * The key deliberately matches `features/map/media-queries.ts`, so an upload
 * becoming ready refreshes one shared server-backed list across both routes.
 */
export function useGardenPlanMediaList(gardenId: string) {
  const gateway = useMediaGateway();

  return useQuery<MediaListResult, ApiFailureError>({
    queryKey: ['media', gardenId, 'list', 'imported_plan'] as const,
    queryFn: async ({ signal }) =>
      unwrap(await gateway.list(gardenId, { mediaClass: 'imported_plan' }, signal)),
    refetchOnMount: 'always',
    refetchInterval: (query) =>
      query.state.data?.items.some(
        (media) => media.uploadState !== 'available' || media.processingState === 'processing',
      ) === true
        ? 2_000
        : false,
  });
}

/** Deletes an uploaded property plan and reconciles every media-backed plan list. */
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
    onSuccess: (_deleted, { mediaId }) => {
      const planListKey = ['media', gardenId, 'list', 'imported_plan'] as const;
      queryClient.setQueryData<MediaListResult>(planListKey, (current) =>
        current === undefined
          ? undefined
          : { ...current, items: current.items.filter((media) => media.id !== mediaId) },
      );
      return queryClient.invalidateQueries({ queryKey: ['media', gardenId] });
    },
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
 *
 * For a re-encoded or resized copy, whose bytes differ, see
 * `useSimilarMedia` below.
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

/**
 * Which of this garden's photographs LOOK like the one just uploaded.
 *
 * Where `useExactDuplicateMedia` compares bytes, this compares pixels: the
 * server holds a perceptual hash of every processed image and answers with
 * the ones within a fixed distance. That catches the case a checksum
 * cannot — the same shot re-encoded by a phone gallery, resized, or saved
 * to a different format.
 *
 * A probability, never a certainty, and the wording that presents it must
 * say so. The server excludes the reference record itself, and answers an
 * empty list rather than an error when it has no hash yet — so this stays
 * quiet during the window between upload and derivative processing instead
 * of claiming there is nothing similar.
 */
export function useSimilarMedia(gardenId: string, mediaId: string | null) {
  const gateway = useMemo(() => createMediaGateway(createBrowserApiClient()), []);

  const query = useQuery<MediaListResult, ApiFailureError>({
    queryKey: ['media', gardenId, 'similar', mediaId] as const,
    queryFn: async ({ signal }) =>
      unwrap(await gateway.list(gardenId, { similarToMediaId: mediaId as string }, signal)),
    enabled: mediaId !== null,
  });

  return { similar: query.data?.items ?? [], isPending: query.isPending };
}
