/**
 * Lists a garden's candidates, cursor-paginated most-recently-created
 * first — mirrors `search-plants.ts`'s authorization/pagination shape,
 * without the trigram text-search half: full-text/relevance search over
 * candidates is `P11-SEARCH-01`'s job (the same staging `SearchPlants`
 * itself went through before P4-SEARCH-01 added ranking).
 */

import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { GardenAuthorization } from '../../gardens-mapping/public.js';
import type { CandidateStatus } from '../domain/plant-candidate.js';
import { toCandidateResource, type CandidateResource } from './candidate-view.js';
import type { PlantCandidateRepository } from './plant-candidate-repository.js';

export interface ListCandidatesFilters {
  readonly status: readonly CandidateStatus[] | null;
}

export interface CandidateListResourcePage {
  readonly items: readonly CandidateResource[];
  readonly nextCursor: string | null;
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

    const page = await this.candidates.list(gardenId, filters, cursor, limit);
    return { items: page.items.map(toCandidateResource), nextCursor: page.nextCursor };
  }
}
