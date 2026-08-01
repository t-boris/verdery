'use client';

import type { Media, MediaAccess } from '@verdery/api-contracts';
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
 * The plants feature's OWN media-access read, for resolving a
 * `PlantPhoto.mediaId` to a viewable signed URL in `plant-photo-gallery.tsx`.
 *
 * Built directly on `core/api`'s `createMediaGateway` rather than importing
 * `features/media` — "Features import public Core and Shared interfaces
 * only" (architecture/web-application-design.md, section "20. Dependency
 * Rules"), so one feature never imports another. Mirrors
 * `features/map/media-queries.ts`'s own identical precedent, including its
 * query key shape (matches `features/media/queries.ts`'s own
 * `mediaAccessQueryKey`), so every feature reading the same media record's
 * access shares one cache entry rather than fetching it twice.
 */

/** How often to re-ask while validation is still outstanding. */
const PROCESSING_POLL_INTERVAL_MS = 5000;

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
 * A photo's signed URL, gated on that photo actually being processed.
 *
 * This used to call `getAccess` unconditionally, on the stated reasoning that
 * "a photo row only exists once its upload confirmed, so it is always
 * processed." Confirmation and processing are different steps: the row is
 * written when the upload completes (section 7 step 6) and validation runs
 * afterwards (step 7), so between the two `GetMediaAccess` correctly refuses
 * with a `409` — and because that reached `unwrap`, every thumbnail fired the
 * request four times over as TanStack Query retried a refusal that retrying
 * cannot fix.
 *
 * Reads the status first and enables the access read only at `processed`, the
 * same two-step `features/map/use-background-image.ts` already uses. The
 * status query keeps polling while processing is outstanding, so a photo
 * appears on its own once it is ready rather than needing a reload.
 */
export function usePlantPhotoAccess(gardenId: string, mediaId: string) {
  const gateway = useMediaGateway();

  const statusQuery = useQuery<Media, ApiFailureError>({
    queryKey: ['media', gardenId, mediaId, 'status'] as const,
    queryFn: async ({ signal }) => unwrap(await gateway.getStatus(gardenId, mediaId, signal)),
    // Processing is asynchronous and has no push channel here; stop asking
    // once it has reached a terminal state.
    refetchInterval: (query) =>
      query.state.data?.processingState === 'processed' ||
      query.state.data?.processingState === 'processing_failed'
        ? false
        : PROCESSING_POLL_INTERVAL_MS,
  });

  const isProcessed = statusQuery.data?.processingState === 'processed';

  const accessQuery = useQuery<MediaAccess, ApiFailureError>({
    queryKey: ['media', gardenId, mediaId, 'access'] as const,
    queryFn: async ({ signal }) => unwrap(await gateway.getAccess(gardenId, mediaId, signal)),
    enabled: isProcessed,
    staleTime: 5 * 60 * 1000,
  });

  return {
    data: accessQuery.data,
    // Still processing is a pending state, not an error — the photo is coming.
    isPending: statusQuery.isPending || (!isProcessed && !statusQuery.isError),
    isError: statusQuery.isError || accessQuery.isError,
  };
}
