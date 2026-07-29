import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { CandidateStatus, PlantCandidate } from '../domain/plant-candidate.js';

/** `null` means "no restriction on this field" — the same convention `PlantSearchFilters` uses. */
export interface CandidateListFilters {
  readonly status: readonly CandidateStatus[] | null;
}

export interface CandidateListPage {
  readonly items: readonly PlantCandidate[];
  /** Opaque. `null` means no further page exists. */
  readonly nextCursor: string | null;
}

export interface PlantCandidateRepository {
  findById(candidateId: Uuid): Promise<PlantCandidate | null>;
  insert(candidate: PlantCandidate): Promise<void>;

  /**
   * Writes the candidate's new state guarded by `expectedRevision`. Returns
   * `false` when the stored revision no longer matches, without throwing —
   * the same `boolean`-return contract `PlantRepository.update` follows.
   */
  update(candidate: PlantCandidate, expectedRevision: number): Promise<boolean>;

  /**
   * Every candidate in the garden matching `filters`, cursor-paginated most
   * recently created first. Full-text/relevance search is deferred to
   * `P11-SEARCH-01`, the same staging `SearchPlants` went through before its
   * own trigram ranking existed — this is a listing, not a search.
   */
  list(
    gardenId: Uuid,
    filters: CandidateListFilters,
    cursor: string | null,
    limit: number,
  ): Promise<CandidateListPage>;
}
