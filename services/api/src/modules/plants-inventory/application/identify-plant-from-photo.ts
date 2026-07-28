/**
 * Real photo-based species identification (ADR-0015), replacing the
 * historical always-empty stub ("This pass has no real photo-identification
 * service — stub it with a pure, clearly-labeled placeholder function").
 *
 * Calls the bounded `IdentifyPlantSpecies` machinery (integrations module),
 * then resolves any name candidate against this application's OWN reviewed
 * taxonomy catalog (`TaxonomyReferenceRepository.search`, the same
 * trigram-similarity match `SearchTaxonomyReferences` already uses) — the
 * model never supplies a `taxonomyReferenceId` itself, only a common/
 * scientific name guess. `AddPlantFromPhoto` is the only caller.
 *
 * Every non-candidate outcome — the capability disabled or unconfigured,
 * quota exhausted, provider timeout or failure, no confident candidate, a
 * schema-invalid response, a safety-blocked response, or no catalog match
 * for whatever name the model did suggest — collapses to the SAME
 * `{ suggestedTaxonomyId: null, confidenceScore: 0 }` shape the historical
 * stub always returned. `AddPlantFromPhoto` needs no new branching, and a
 * photo-created plant's `taxonomyReferenceId` stays null exactly as before
 * whenever identification cannot produce a confident, catalog-matched
 * answer — identification never auto-confirms, unchanged by this pass.
 */

import type { IdentifyPlantSpecies, PlantPhotoReference } from '../../integrations/public.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { TaxonomyReferenceRepository } from './taxonomy-reference-repository.js';

export interface PhotoIdentificationSuggestion {
  readonly suggestedTaxonomyId: Uuid | null;
  readonly confidenceScore: number;
}

const NO_SUGGESTION: PhotoIdentificationSuggestion = {
  suggestedTaxonomyId: null,
  confidenceScore: 0,
};

/** The catalog is searched by only the top-1 trigram match — a further, lower-ranked match is never a better guess than the model's own top name candidate. */
const TAXONOMY_MATCH_LIMIT = 1;

export async function identifyPlantFromPhoto(
  identifyPlantSpecies: IdentifyPlantSpecies,
  taxonomyReferences: TaxonomyReferenceRepository,
  photo: PlantPhotoReference,
): Promise<PhotoIdentificationSuggestion> {
  const result = await identifyPlantSpecies.execute({ photo });

  if (result.outcome !== 'candidate') {
    return NO_SUGGESTION;
  }

  const matches = await taxonomyReferences.search(
    result.candidate.commonName,
    TAXONOMY_MATCH_LIMIT,
  );
  const bestMatch = matches[0];
  if (bestMatch === undefined) {
    return NO_SUGGESTION;
  }

  return {
    suggestedTaxonomyId: bestMatch.id,
    confidenceScore: result.candidate.confidenceScore,
  };
}
