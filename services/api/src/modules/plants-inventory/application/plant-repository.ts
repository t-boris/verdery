import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { GroupingKind, Plant } from '../domain/plant.js';
import type { LifecycleStage, PlantStatus } from '../domain/plant-lifecycle.js';

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
}

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
