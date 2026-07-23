import type { Garden as GardenResource } from '@verdery/api-contracts';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { GardenRepository } from './garden-repository.js';
import { toGardenResource } from './garden-view.js';

export interface GardenListResult {
  readonly items: readonly GardenResource[];
  readonly nextCursor: string | null;
}

export class ListGardens {
  constructor(private readonly gardens: GardenRepository) {}

  /**
   * `nameQuery` was added by P4-SEARCH-01. Omitted or `null`/blank, behavior
   * is exactly what it was before: every garden the profile has active
   * membership on, most recently created first — no existing call site or
   * test needs to change. A real, non-blank `nameQuery` instead trigram-fuzzy
   * matches `name`, ranked most-similar first — the same trim/blank-to-null
   * normalization `SearchTaxonomyReferences.execute` already applies to its
   * own `query` parameter.
   */
  async execute(
    profileId: Uuid,
    cursor: string | null,
    limit: number,
    nameQuery?: string | null,
  ): Promise<GardenListResult> {
    const trimmedQuery = nameQuery === undefined || nameQuery === null ? null : nameQuery.trim();
    const page = await this.gardens.listForProfile(
      profileId,
      cursor,
      limit,
      trimmedQuery === '' ? null : trimmedQuery,
    );

    return {
      items: page.items.map((garden) => toGardenResource(garden, garden.callerRole)),
      nextCursor: page.nextCursor,
    };
  }
}
