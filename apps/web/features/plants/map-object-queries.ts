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
 * The plants feature's OWN read of a garden's map objects, for the
 * `gardenAreaMapObjectId`/`placementMapObjectId` picker in
 * `add-plant-form.tsx`/`plant-move-form.tsx`.
 *
 * Built directly on `core/api`'s `createMapGateway` rather than importing
 * `features/map` — "Features import public Core and Shared interfaces
 * only" (architecture/web-application-design.md, section "20. Dependency
 * Rules"), so one feature never imports another. Mirrors
 * `features/map/media-queries.ts`'s own identical "rebuild a thin query
 * directly on `core/api`" precedent.
 *
 * No category filter: the backend places none on either placement field
 * (`requirePlacementReferencesGardenObjects`, plants-inventory/application/
 * require-plant-placement-in-garden.ts, only requires the object be
 * `active`), so the same full list is offered for both fields.
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
    queryKey: ['plants', gardenId, 'mapObjects'] as const,
    queryFn: async ({ signal }) => {
      const document = unwrap(await gateway.getMap(gardenId, undefined, signal));
      return document.objects.filter((object) => object.lifecycleState === 'active');
    },
  });
}
