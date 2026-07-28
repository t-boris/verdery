/**
 * Maps a `PlantIdentification` (plus its resolved `TaxonomyReference`, when
 * the suggestion named one) to the shape `GetPlantIdentification` returns —
 * matching `plant-view.ts`'s own convention of a dedicated view file per
 * resource, and `PlantResource`'s reasoning for carrying every field
 * directly, including nulls.
 *
 * `suggestedCommonName`/`suggestedScientificName` carry the AI's own raw
 * name guess when it was confident but found no catalog match —
 * `domain/plant-identification.ts`'s own doc comment covers the full
 * mutual-exclusivity invariant with `suggestedTaxonomy`.
 */

import type { PlantIdentification } from '../domain/plant-identification.js';
import type { TaxonomyReference } from '../domain/taxonomy-reference.js';

export interface PlantIdentificationResource {
  readonly id: string;
  readonly plantId: string;
  readonly plantPhotoId: string;
  readonly confidenceScore: number;
  readonly createdAt: string;
  readonly suggestedTaxonomy: {
    readonly id: string;
    readonly scientificName: string;
    readonly commonName: string | null;
  } | null;
  readonly suggestedCommonName: string | null;
  readonly suggestedScientificName: string | null;
}

export function toPlantIdentificationResource(
  identification: PlantIdentification,
  suggestedTaxonomy: TaxonomyReference | null,
): PlantIdentificationResource {
  return {
    id: identification.id,
    plantId: identification.plantId,
    plantPhotoId: identification.plantPhotoId,
    confidenceScore: identification.confidenceScore,
    createdAt: identification.createdAt.toISOString(),
    suggestedTaxonomy:
      suggestedTaxonomy === null
        ? null
        : {
            id: suggestedTaxonomy.id,
            scientificName: suggestedTaxonomy.scientificName,
            commonName: suggestedTaxonomy.commonName,
          },
    suggestedCommonName: identification.suggestedCommonName,
    suggestedScientificName: identification.suggestedScientificName,
  };
}
