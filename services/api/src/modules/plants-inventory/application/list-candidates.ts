/**
 * Lists a garden's candidates — trigram-fuzzy matching on `displayName`
 * when a `query` is given, combined with optional structured filters
 * (`status`, `priority`, `identified`), cursor-paginated exactly the way
 * `SearchPlants` already paginates (P11-SEARCH-01, closing the gap this
 * file's own header used to name: "full-text/relevance search over
 * candidates is P11-SEARCH-01's job").
 */

import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { GardenAuthorization } from '../../gardens-mapping/public.js';
import type { CandidatePriority, CandidateStatus } from '../domain/plant-candidate.js';
import { toCandidateResource, type CandidateResource } from './candidate-view.js';
import type {
  CandidateListFilters,
  PlantCandidateRepository,
} from './plant-candidate-repository.js';

/** Caller-facing filter shape: every field optional/undefined-friendly, the same normalization boundary `SearchPlantsFilters` draws against `PlantSearchFilters`. */
export interface ListCandidatesFilters {
  readonly query?: string | null;
  readonly status?: readonly CandidateStatus[];
  readonly priority?: readonly CandidatePriority[];
  readonly identified?: boolean | null;
}

export interface CandidateListResourcePage {
  readonly items: readonly CandidateResource[];
  readonly nextCursor: string | null;
}

function normalizeMultiValue<T>(values: readonly T[] | undefined): readonly T[] | null {
  return values !== undefined && values.length > 0 ? values : null;
}

export class ListCandidates {
  constructor(
    private readonly candidates: PlantCandidateRepository,
    private readonly authorization: GardenAuthorization,
  ) {}

  async execute(
    gardenId: Uuid,
    profileId: Uuid,
    filters: ListCandidatesFilters,
    cursor: string | null,
    limit: number,
  ): Promise<CandidateListResourcePage> {
    await this.authorization.requireCapability(gardenId, profileId, 'viewGarden');

    const trimmedQuery =
      filters.query === undefined || filters.query === null ? null : filters.query.trim();
    const repositoryFilters: CandidateListFilters = {
      query: trimmedQuery === null || trimmedQuery === '' ? null : trimmedQuery,
      status: normalizeMultiValue(filters.status),
      priority: normalizeMultiValue(filters.priority),
      identified: filters.identified ?? null,
    };

    const page = await this.candidates.list(gardenId, repositoryFilters, cursor, limit);
    return { items: page.items.map(toCandidateResource), nextCursor: page.nextCursor };
  }
}
