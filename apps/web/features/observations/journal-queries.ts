'use client';

import type { Media, MediaAccess, PlantJournalFrameListResult } from '@verdery/api-contracts';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import {
  ApiFailureError,
  createBrowserApiClient,
  createMediaGateway,
  createObservationGateway,
  isFailure,
  type ApiResult,
  type PlantJournalFramesParams,
} from '@/core/api/public';

/**
 * The journal sequence's reads: the frames themselves, and the signed URL each
 * frame's media resolves to.
 *
 * The media-access hook is this feature's OWN, built directly on `core/api`'s
 * `createMediaGateway` rather than importing `features/media` or
 * `features/plants` — "Features import public Core and Shared interfaces only"
 * (architecture/web-application-design.md, section "20. Dependency Rules"). It
 * is the third copy of that hook, after `features/plants/plant-media-queries.ts`
 * and `features/map/media-queries.ts`, and deliberately keeps their query-key
 * shape so all three share one cache entry per media record instead of
 * fetching the same access three times.
 *
 * Source: packages/api-contracts/openapi.yaml, operation
 * `listPlantJournalFrames`; implementation-plan.md work package P11-MEDIA-01.
 */

/** How often to re-ask while validation is still outstanding. */
const PROCESSING_POLL_INTERVAL_MS = 5000;

const journalFramesQueryKey = (
  gardenId: string,
  plantId: string,
  params: PlantJournalFramesParams,
) => ['observations', 'journal-frames', gardenId, plantId, params.purpose ?? 'all'] as const;

function unwrap<TData>(result: ApiResult<TData>): TData {
  if (isFailure(result)) {
    throw new ApiFailureError(result);
  }
  return result.data;
}

export function usePlantJournalFrames(
  gardenId: string,
  plantId: string,
  params: PlantJournalFramesParams,
) {
  const gateway = useMemo(() => createObservationGateway(createBrowserApiClient()), []);

  return useQuery<PlantJournalFrameListResult, ApiFailureError>({
    queryKey: journalFramesQueryKey(gardenId, plantId, params),
    queryFn: async ({ signal }) =>
      unwrap(await gateway.listJournalFrames(gardenId, plantId, params, signal)),
  });
}

/**
 * A frame's signed URL, gated on its media actually being processed — the same
 * two-step read `features/plants/plant-media-queries.ts` documents at length:
 * `GetMediaAccess` refuses with a `409` between upload confirmation and the end
 * of validation, and asking anyway made every thumbnail retry a refusal that
 * retrying cannot fix.
 */
export function useJournalFrameAccess(gardenId: string, mediaId: string) {
  const gateway = useMemo(() => createMediaGateway(createBrowserApiClient()), []);

  const statusQuery = useQuery<Media, ApiFailureError>({
    queryKey: ['media', gardenId, mediaId, 'status'] as const,
    queryFn: async ({ signal }) => unwrap(await gateway.getStatus(gardenId, mediaId, signal)),
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
