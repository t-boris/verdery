import type { TaxonomyNameMatch } from './taxonomy-reference-repository.js';
import type { TaxonomyReference } from '../domain/taxonomy-reference.js';

/** Mirrors `TaxonomyNameMatch` field-for-field, the resource-layer copy every other `*View` file makes of its own domain shape. */
export interface TaxonomyNameMatchResource {
  readonly nameKind: string;
  readonly nameText: string;
  readonly locale: string | null;
}

export interface TaxonomyReferenceResource {
  readonly id: string;
  readonly scientificName: string;
  readonly commonName: string | null;
  readonly varietyName: string | null;
  readonly source: string;
  readonly createdByProfileId: string | null;
  readonly createdAt: string;
  /** Which name form a search query matched (P11-SEARCH-01) — `null` outside a text search (a plain listing, or any OTHER caller of this resource, e.g. `PlantIdentification.suggestedTaxonomy`). */
  readonly matchedName: TaxonomyNameMatchResource | null;
}

export function toTaxonomyReferenceResource(
  reference: TaxonomyReference,
  matchedName: TaxonomyNameMatch | null = null,
): TaxonomyReferenceResource {
  return {
    id: reference.id,
    scientificName: reference.scientificName,
    commonName: reference.commonName,
    varietyName: reference.varietyName,
    source: reference.source,
    createdByProfileId: reference.createdByProfileId,
    createdAt: reference.createdAt.toISOString(),
    matchedName,
  };
}
