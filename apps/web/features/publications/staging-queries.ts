'use client';

import type { MediaListResult, ObservationListResult } from '@verdery/api-contracts';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import {
  ApiFailureError,
  createBrowserApiClient,
  createMediaGateway,
  createObservationGateway,
  isFailure,
  type ApiResult,
} from '@/core/api/public';

/**
 * What a publisher can stage onto a draft update: the garden's photographs,
 * and its observations.
 *
 * Both reads are this feature's own, built directly on `core/api` rather than
 * importing `features/media` or `features/observations` — "Features import
 * public Core and Shared interfaces only"
 * (architecture/web-application-design.md, section "20. Dependency Rules") —
 * and both use the same query keys those features use, so a garden's media
 * list is fetched once no matter which screen asks.
 *
 * Source: packages/api-contracts/openapi.yaml, operations `listGardenMedia`
 * and `listObservationsForGarden`.
 */

/** Enough recent history to pick from without asking the publisher to scroll a page of ids. */
const STAGING_PAGE_LIMIT = 50;

function unwrap<TData>(result: ApiResult<TData>): TData {
  if (isFailure(result)) {
    throw new ApiFailureError(result);
  }
  return result.data;
}

export function useGardenMediaForStaging(gardenId: string) {
  const gateway = useMemo(() => createMediaGateway(createBrowserApiClient()), []);

  return useQuery<MediaListResult, ApiFailureError>({
    queryKey: ['media', gardenId, 'list', 'garden_photo', STAGING_PAGE_LIMIT] as const,
    queryFn: async ({ signal }) =>
      unwrap(
        await gateway.list(
          gardenId,
          { mediaClass: 'garden_photo', limit: STAGING_PAGE_LIMIT },
          signal,
        ),
      ),
  });
}

export function useGardenObservationsForStaging(gardenId: string) {
  const gateway = useMemo(() => createObservationGateway(createBrowserApiClient()), []);

  return useQuery<ObservationListResult, ApiFailureError>({
    queryKey: ['observations', 'garden', gardenId] as const,
    queryFn: async ({ signal }) => unwrap(await gateway.listForGarden(gardenId, signal)),
  });
}

/** One media option a publisher may stage: a DERIVATIVE's id, with the original it came from named for recognition. */
export interface StageableMediaOption {
  readonly mediaId: string;
  readonly label: string;
}

/**
 * The derivatives of a garden's photographs, which are the only media a
 * publication may carry.
 *
 * `isMediaClientSafe` requires `derivedFromMediaId !== null` — an original's
 * Cloud Storage bytes can hold embedded EXIF and GPS, and a client is never
 * entitled to those. `ListGardenMedia` returns originals, each naming its own
 * derivatives, so the option list is built from those: a publisher picks a
 * photograph and stages the safe copy of it without having to know that the
 * distinction exists.
 *
 * An original whose derivatives have not been produced yet contributes no
 * option. It is not hidden silently — see the caller's own empty-state
 * message — because "the photo I just uploaded is not in the list" needs an
 * answer, and "it is still being processed" is the true one.
 */
export function stageableMediaOptions(result: MediaListResult | undefined): StageableMediaOption[] {
  return (result?.items ?? []).flatMap((media) =>
    // `derivatives` is optional on the contract, so an older or partial
    // response contributes no options rather than throwing.
    (media.derivatives ?? []).map((derivative) => ({
      mediaId: derivative.mediaId,
      label: `${media.displayFilename} — ${derivative.derivativeKind}`,
    })),
  );
}
