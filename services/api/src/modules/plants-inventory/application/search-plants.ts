/**
 * Garden-scoped plant search: trigram-fuzzy matching on `displayName` when a
 * `query` is given, combined with optional structured filters
 * (`lifecycleStage`, `status`, `groupingKind`), cursor-paginated exactly the
 * way `ListGardens` already paginates — same shape, same convention, not a
 * new pagination style.
 *
 * This closes a real, already-flagged gap. Both Phase 4 clients found there
 * was no way to list a garden's plants at all — only single-plant `GetPlant`
 * — and had to fall back to a create-then-navigate / open-by-id flow
 * instead: see the web client's own `apps/web/features/plants/
 * open-plant-by-id-form.tsx` ("The contract has no `GET /gardens/{gardenId}/
 * plants` list operation... this form is the honest alternative") and the
 * iOS client's own `apps/ios/Sources/FeaturePlants/PlantsHomeView.swift`
 * ("There is no `GET /gardens/{gardenId}/plants` list operation in the
 * contract... opening a plant whose id is already known"), plus
 * `docs/development/deferred-capabilities.md`'s note on the Phase 4 web
 * client. `SearchPlants` is that missing list operation.
 *
 * Authorization mirrors `GetPlant`'s own pattern: `viewGarden` is checked
 * against the path's own `gardenId` before any repository read.
 *
 * Source: implementation-plan.md work package P4-SEARCH-01.
 */

import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { GardenAuthorization } from '../../gardens-mapping/public.js';
import type { GroupingKind } from '../domain/plant.js';
import type { LifecycleStage, PlantStatus } from '../domain/plant-lifecycle.js';
import type { PlantRepository, PlantSearchFilters } from './plant-repository.js';
import { toPlantResource, type PlantResource } from './plant-view.js';

/**
 * Caller-facing filter shape: every field optional/undefined-friendly,
 * unlike `PlantSearchFilters` (the repository port), which always receives
 * an explicit `null` for "no restriction" — the same normalization boundary
 * `ListGardens`'s own `nameQuery?: string | null` parameter draws between
 * the route/use-case layer and the repository.
 */
export interface SearchPlantsFilters {
  readonly query?: string | null;
  readonly lifecycleStage?: readonly LifecycleStage[];
  readonly status?: readonly PlantStatus[];
  readonly groupingKind?: readonly GroupingKind[];
}

export interface PlantSearchResult {
  readonly items: readonly PlantResource[];
  readonly nextCursor: string | null;
}

function normalizeMultiValue<T>(values: readonly T[] | undefined): readonly T[] | null {
  return values !== undefined && values.length > 0 ? values : null;
}

export class SearchPlants {
  constructor(
    private readonly plants: PlantRepository,
    private readonly authorization: GardenAuthorization,
  ) {}

  async execute(
    gardenId: Uuid,
    profileId: Uuid,
    filters: SearchPlantsFilters,
    cursor: string | null,
    limit: number,
  ): Promise<PlantSearchResult> {
    await this.authorization.requireCapability(gardenId, profileId, 'viewGarden');

    const trimmedQuery =
      filters.query === undefined || filters.query === null ? null : filters.query.trim();
    const repositoryFilters: PlantSearchFilters = {
      query: trimmedQuery === null || trimmedQuery === '' ? null : trimmedQuery,
      lifecycleStage: normalizeMultiValue(filters.lifecycleStage),
      status: normalizeMultiValue(filters.status),
      groupingKind: normalizeMultiValue(filters.groupingKind),
    };

    const page = await this.plants.search(gardenId, repositoryFilters, cursor, limit);

    return {
      items: page.items.map(toPlantResource),
      nextCursor: page.nextCursor,
    };
  }
}
