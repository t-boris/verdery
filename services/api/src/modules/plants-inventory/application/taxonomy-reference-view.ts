import type { TaxonomyReference } from '../domain/taxonomy-reference.js';

export interface TaxonomyReferenceResource {
  readonly id: string;
  readonly scientificName: string;
  readonly commonName: string | null;
  readonly varietyName: string | null;
  readonly source: string;
  readonly createdByProfileId: string | null;
  readonly createdAt: string;
}

export function toTaxonomyReferenceResource(
  reference: TaxonomyReference,
): TaxonomyReferenceResource {
  return {
    id: reference.id,
    scientificName: reference.scientificName,
    commonName: reference.commonName,
    varietyName: reference.varietyName,
    source: reference.source,
    createdByProfileId: reference.createdByProfileId,
    createdAt: reference.createdAt.toISOString(),
  };
}
