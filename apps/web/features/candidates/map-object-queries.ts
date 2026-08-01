'use client';

import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import {
  ApiFailureError,
  createBrowserApiClient,
  createMapGateway,
  isFailure,
  type ApiResult,
  type WireGardenObject,
} from '@/core/api/public';

/**
 * The candidates feature's OWN read of a garden's map objects, for the
 * `proposedGardenAreaMapObjectId`/`proposedPlacementMapObjectId` picker in
 * `add-candidate-form.tsx`.
 *
 * Built directly on `core/api`'s `createMapGateway` rather than importing
 * `features/map` — "Features import public Core and Shared interfaces
 * only" (architecture/web-application-design.md, section "20. Dependency
 * Rules"). Duplicates `features/plants/map-object-queries.ts` verbatim, same
 * as that file's own doc comment already documents this class of problem.
 */

function useMapGateway() {
  return useMemo(() => createMapGateway(createBrowserApiClient()), []);
}

function unwrap<TData>(result: ApiResult<TData>): TData {
  if (isFailure(result)) {
    throw new ApiFailureError(result);
  }
  return result.data;
}

export function useGardenMapObjects(gardenId: string) {
  const gateway = useMapGateway();

  return useQuery<readonly WireGardenObject[], ApiFailureError>({
    queryKey: ['candidates', gardenId, 'mapObjects'] as const,
    queryFn: async ({ signal }) => {
      const document = unwrap(await gateway.getMap(gardenId, undefined, signal));
      return document.objects.filter((object) => object.lifecycleState === 'active');
    },
  });
}
