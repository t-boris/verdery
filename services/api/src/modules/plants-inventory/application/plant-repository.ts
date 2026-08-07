import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { GroupingKind, Plant } from '../domain/plant.js';
import type { LifecycleStage, PlantStatus } from '../domain/plant-lifecycle.js';
import type {
  ImageAnalysisKind,
  PlantDistributionStatus,
  PlantProfileCompleteness,
  TaxonSeasonalActivity,
} from './plant-search-filter-values.js';

/**
 * Structured filters `SearchPlants`/`search()` combine. `null` means "no
 * restriction on this field" — the same convention `TaskRepository.
 * listForGarden`'s own `statusFilter: readonly TaskStatus[] | null` uses,
 * extended to three independent fields here instead of one.
 */
export interface PlantSearchFilters {
  /** Trigram-fuzzy match against `displayName`. `null` means no text query — every plant matching the other filters, most recently created first. */
  readonly query: string | null;
  readonly lifecycleStage: readonly LifecycleStage[] | null;
  readonly status: readonly PlantStatus[] | null;
  readonly groupingKind: readonly GroupingKind[] | null;
  /** `true` = has a resolved `taxonomyReferenceId`; `false` = does not; `null` = no restriction (P11-SEARCH-01's "identity" filter). */
  readonly identified: boolean | null;
  /** `true` = linked to any map object; `false` = still unassigned; `null` = no restriction. */
  readonly hasMapPlacement: boolean | null;
  /** Exact map object reverse lookup. `null` means no restriction. */
  readonly placementMapObjectId: Uuid | null;

  /**
   * Journal recency, as two independent bounds rather than one range.
   *
   * `observedWithinDays` needs an observation to exist; `notObservedForDays`
   * deliberately matches a plant with NO observation at all, because "never
   * recorded" is the strongest case of "not recorded lately" and is precisely
   * what a neglect filter is for. Making them complements of each other would
   * have cost that case silently.
   */
  readonly observedWithinDays: number | null;
  readonly notObservedForDays: number | null;

  /** At least one image-analysis SUGGESTION of a listed kind. Never a finding — see the contract's own note. */
  readonly healthConcern: readonly ImageAnalysisKind[] | null;

  /** Taxon seasonal windows. `seasonalMonth` narrows to windows open in that month; without it, to taxa recording the window at all. */
  readonly seasonalActivity: readonly TaxonSeasonalActivity[] | null;
  readonly seasonalMonth: number | null;

  /** Taxon distribution standing, scoped to `distributionRegion` when given. */
  readonly distributionStatus: readonly PlantDistributionStatus[] | null;
  readonly distributionRegion: string | null;

  /** How complete the taxon's materialized knowledge profile is. */
  readonly profileCompleteness: PlantProfileCompleteness | null;
}

/**
 * Every filter off.
 *
 * Call sites that want "all plants in this garden" spread this instead of
 * writing out each field, so adding a filter is a change in one file rather
 * than in every caller that never cared about filtering. The type stays
 * exhaustive on purpose — `Partial` here would let a real filter go silently
 * unset at a call site that meant to set it.
 */
export const NO_PLANT_SEARCH_FILTERS: PlantSearchFilters = {
  query: null,
  lifecycleStage: null,
  status: null,
  groupingKind: null,
  identified: null,
  hasMapPlacement: null,
  placementMapObjectId: null,
  observedWithinDays: null,
  notObservedForDays: null,
  healthConcern: null,
  seasonalActivity: null,
  seasonalMonth: null,
  distributionStatus: null,
  distributionRegion: null,
  profileCompleteness: null,
};

export interface PlantSearchPage {
  readonly items: readonly Plant[];
  /** Opaque. `null` means no further page exists. */
  readonly nextCursor: string | null;
}

export interface PlantRepository {
  findById(plantId: Uuid): Promise<Plant | null>;
  insert(plant: Plant): Promise<void>;

  /**
   * Writes the plant's new state guarded by `expectedRevision`. Returns
   * `false` when the stored revision no longer matches, without throwing —
   * the same `boolean`-return contract `GardenRepository.update` and
   * `MapObjectRepository.update` already follow, letting the caller (`
   * apply-plant-revision-guarded-update.ts`) decide how to report it.
   */
  update(plant: Plant, expectedRevision: number): Promise<boolean>;

  /**
   * Every plant in the garden matching `filters`, cursor-paginated exactly
   * like `GardenRepository.listForProfile` — ranked most-similar first when
   * `filters.query` is set, most recently created first otherwise.
   */
  search(
    gardenId: Uuid,
    filters: PlantSearchFilters,
    cursor: string | null,
    limit: number,
  ): Promise<PlantSearchPage>;
}
