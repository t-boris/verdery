'use client';

import type { PlantListResult, SeasonalPlanResult } from '@verdery/api-contracts';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import {
  ApiFailureError,
  createBrowserApiClient,
  createPlantGateway,
  createSeasonalPlanGateway,
  isFailure,
  type ApiResult,
} from '@/core/api/public';

/**
 * TanStack Query hooks for the Seasonal plan section (P9D-UX-01):
 * `GET /gardens/{gardenId}/seasonal-plan` itself, plus a small read-only
 * plant-name lookup this view needs but `SeasonalPlanResult` does not carry
 * (`SeasonalPlanPlantEntry`/`SeasonalPlanRotationStatusEntry` only ever
 * expose `plantId`, never a resolved display name — checked directly
 * against `packages/api-contracts/src/seasonal-plan.ts`).
 *
 * `useActivePlantNamesLookup` is built directly on `core/api`'s
 * `createPlantGateway` rather than importing `features/plants` — "Features
 * import public Core and Shared interfaces only" (architecture/
 * web-application-design.md, section "20. Dependency Rules") — the same
 * "read-only lookup, own query wiring, no cross-feature import" shape
 * `features/tasks/assignable-members.ts` already establishes for an
 * identical problem. `{ status: ['active'] }` mirrors
 * `GetGardenSeasonalPlan`'s own "ACTIVE PLANTS ONLY" scan
 * (`services/api/.../get-garden-seasonal-plan.ts`), and the query key
 * matches `features/plants/queries.ts`'s own `useSearchPlants` shape, so
 * both features share one cache entry in practice for a garden whose
 * inventory list was already opened.
 *
 * First page only, no follow-up pagination: the same "covers any realistic
 * garden" judgment `features/map/media-queries.ts`'s own
 * `useGardenPlanMediaList` documents for its own single-page list. A plant
 * this lookup has not paged in yet falls back to `seasonalPlan.plantFallback`
 * (the raw id) at the render layer, never a broken or blank row.
 *
 * Source: architecture/web-application-design.md, section "8. API Access".
 */

const seasonalPlanQueryKey = (gardenId: string) => ['seasonal-plan', gardenId] as const;
const activePlantsQueryKey = (gardenId: string) =>
  ['plants', gardenId, 'search', { status: ['active'] }] as const;

function useSeasonalPlanGateway() {
  return useMemo(() => createSeasonalPlanGateway(createBrowserApiClient()), []);
}

function usePlantGateway() {
  return useMemo(() => createPlantGateway(createBrowserApiClient()), []);
}

function unwrap<TData>(result: ApiResult<TData>): TData {
  if (isFailure(result)) {
    throw new ApiFailureError(result);
  }
  return result.data;
}

export function useSeasonalPlan(gardenId: string) {
  const gateway = useSeasonalPlanGateway();

  return useQuery<SeasonalPlanResult, ApiFailureError>({
    queryKey: seasonalPlanQueryKey(gardenId),
    queryFn: async ({ signal }) => unwrap(await gateway.get(gardenId, signal)),
  });
}

/**
 * `plantId -> displayName` for this garden's active plants, first page only.
 * A lookup miss (a plant not on that first page) is the caller's decision to
 * make, not this hook's — it returns `undefined` for a missing entry rather
 * than substituting anything.
 */
export function useActivePlantNamesLookup(gardenId: string) {
  const gateway = usePlantGateway();

  return useQuery<PlantListResult, ApiFailureError>({
    queryKey: activePlantsQueryKey(gardenId),
    queryFn: async ({ signal }) =>
      unwrap(await gateway.search(gardenId, { status: ['active'] }, signal)),
  });
}
