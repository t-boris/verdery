import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type {
  CandidatePriority,
  CandidateStatus,
  PlantCandidate,
} from '../domain/plant-candidate.js';

/** `null` means "no restriction on this field" — the same convention `PlantSearchFilters` uses. */
export interface CandidateListFilters {
  /** Trigram-fuzzy match against `displayName` (P11-SEARCH-01). `null` means no text query — every candidate matching the other filters, most recently created first. */
  readonly query: string | null;
  readonly status: readonly CandidateStatus[] | null;
  readonly priority: readonly CandidatePriority[] | null;
  /** `true` = has a resolved `taxonomyReferenceId`; `false` = does not; `null` = no restriction (P11-SEARCH-01's "identity" filter). */
  readonly identified: boolean | null;
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
   * Every candidate in the garden matching `filters`, cursor-paginated —
   * ranked most-similar-first when `filters.query` is set, most recently
   * created first otherwise, the exact `PlantRepository.search` dual-mode
   * shape (P11-SEARCH-01, closing the gap this method's own header used to
   * name: "full-text/relevance search... is a listing, not a search").
   */
  list(
    gardenId: Uuid,
    filters: CandidateListFilters,
    cursor: string | null,
    limit: number,
  ): Promise<CandidateListPage>;
}
