import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { TaxonomyNameKind } from '../domain/taxonomy-name.js';
import type { TaxonomyReference } from '../domain/taxonomy-reference.js';

/** Which name form matched a search query — `nameKind`/`locale` mirror `TaxonomyName`'s own vocabulary; the reference's own `scientificName`/`commonName` are represented as `'accepted_scientific'`/`'common'` (with `locale: null`, since the legacy column carries none) so every match has one shared shape regardless of source. */
export interface TaxonomyNameMatch {
  readonly nameKind: TaxonomyNameKind;
  readonly nameText: string;
  readonly locale: string | null;
}

/** A search result: the canonical reference, plus which name form the query actually matched — `null` for a plain (query-less) listing, where no single field explains the row's presence. */
export interface TaxonomySearchResult {
  readonly reference: TaxonomyReference;
  readonly matchedName: TaxonomyNameMatch | null;
}

export interface ProviderTaxonomySuggestion {
  readonly scientificName: string;
  readonly commonName: string;
  readonly familyName: string;
  readonly genusName: string;
}

export interface TaxonomyReferenceRepository {
  /**
   * A single reference by id, or `null` when unknown. P9D-SEASON-RULES-01's
   * read path for `family` (`crop-rotation-caution`'s own input) and for
   * resolving a bed's past occupant's taxon — the same `findById(id):
   * Promise<T | null>` shape `PlantRepository`/`TaskRepository` already
   * carry, added here because nothing needed a single-row lookup by id
   * before this stage (`search` was the only read path).
   */
  findById(id: Uuid): Promise<TaxonomyReference | null>;

  /**
   * `query === null` lists the catalog (most recent first, by `scientificName`
   * ascending). A non-null query matches `scientificName` or `commonName` by
   * `pg_trgm` trigram similarity — misspelling- and word-order-tolerant,
   * unlike the plain `ILIKE '%query%'` substring match this replaced in
   * P4-SEARCH-01 — ranked most-similar first. `varietyName` is deliberately
   * not part of the matching algorithm (no index backs it either — see
   * `migrations/1784950000000_search-indexes.sql`): the field is sparse and
   * narrower than `commonName`/`scientificName`, and adding it did not
   * change any real query in practice while adding a third field to every
   * ranking comparison.
   *
   * `identify-plant-from-photo.ts`'s own only read path — kept unchanged
   * (scientificName/commonName only) rather than widened to `searchAcrossNames`
   * below: that caller matches a model's own raw common-name guess against
   * the catalog, not a user's typed query, and gains nothing from synonym/
   * cultivar matching.
   */
  search(query: string | null, limit: number): Promise<TaxonomyReference[]>;

  /**
   * `SearchTaxonomyReferences`'s own read path (P11-SEARCH-01): the same
   * trigram matching as `search`, extended to also match every
   * `taxonomy_name` row (synonyms, cultivar names, localized common names) —
   * closing the gap `search`'s own header names ("`taxonomy_name`... added
   * but unread"). `query === null` lists the catalog exactly like `search`
   * does, with `matchedName: null` on every result — a listing has no single
   * field to credit. A taxon with more than one matching name form (its own
   * `scientificName`/`commonName` and one or more `taxonomy_name` rows)
   * appears exactly ONCE, carrying only its single BEST-scoring match — never
   * duplicated per matching name, the same "one identity, one row" rule
   * `PlantTaxonomyMapping`'s own uniqueness already enforces for a different
   * table.
   */
  searchAcrossNames(query: string | null, limit: number): Promise<TaxonomySearchResult[]>;

  /**
   * Resolves a confident model suggestion to an existing canonical reference,
   * or creates an explicitly provider-sourced reference when the reviewed
   * catalog has no row for the scientific name. Attaching it to a real plant
   * still requires the existing human confirmation step.
   */
  resolveProviderSuggestion(suggestion: ProviderTaxonomySuggestion): Promise<TaxonomyReference>;
}
