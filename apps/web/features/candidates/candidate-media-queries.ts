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
 * The candidates feature's OWN media-access read, for resolving a
 * `PlantCandidatePhoto.mediaId` to a viewable signed URL in
 * `candidate-photo-gallery.tsx`. Mirrors `features/plants/
 * plant-media-queries.ts`'s identical precedent and reasoning — built
 * directly on `core/api`'s `createMediaGateway` rather than importing
 * `features/plants`, per "Features import public Core and Shared interfaces
 * only" (architecture/web-application-design.md, section "20. Dependency
 * Rules"). Shares its query key shape, so a photo already resolved by the
 * plants feature is not fetched a second time.
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

/** A candidate photo's own `mediaId` is always already `processed` — a photo row only exists once its upload confirmed — so this is always `enabled`, unlike `features/media`'s own conditional `useMediaAccess`. */
export function useCandidatePhotoAccess(gardenId: string, mediaId: string) {
  const gateway = useMediaGateway();

  return useQuery<MediaAccess, ApiFailureError>({
    queryKey: ['media', gardenId, mediaId, 'access'] as const,
    queryFn: async ({ signal }) => unwrap(await gateway.getAccess(gardenId, mediaId, signal)),
    staleTime: 5 * 60 * 1000,
  });
}
