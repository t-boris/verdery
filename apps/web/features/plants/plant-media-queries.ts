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

function useMediaGateway() {
  return useMemo(() => createMediaGateway(createBrowserApiClient()), []);
}

function unwrap<TData>(result: ApiResult<TData>): TData {
  if (isFailure(result)) {
    throw new ApiFailureError(result);
  }
  return result.data;
}

/** A plant photo's own `mediaId` is always already `processed` — a photo row only exists once its upload confirmed — so this is always `enabled`, unlike `features/media`'s own conditional `useMediaAccess`. */
export function usePlantPhotoAccess(gardenId: string, mediaId: string) {
  const gateway = useMediaGateway();

  return useQuery<MediaAccess, ApiFailureError>({
    queryKey: ['media', gardenId, mediaId, 'access'] as const,
    queryFn: async ({ signal }) => unwrap(await gateway.getAccess(gardenId, mediaId, signal)),
    staleTime: 5 * 60 * 1000,
  });
}
