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
 * `suggestedTaxonomyId`, and the `(suggestedCommonName, suggestedScientificName)`
 * pair, are mutually exclusive — never both non-null:
 * - A genuinely non-candidate outcome (the capability disabled or
 *   unconfigured, quota exhausted, provider timeout or failure, no
 *   confident candidate, a schema-invalid response, a safety-blocked
 *   response) collapses to `NO_SUGGESTION` — everything null, the same
 *   shape the historical stub always returned.
 * - A confident candidate whose `commonName` MATCHES the catalog resolves
 *   `suggestedTaxonomyId`, with the raw fields left null.
 * - A confident candidate with no catalog match but a scientific-name guess
 *   creates an explicitly `provider_sourced` reference. The existing human
 *   confirmation boundary for real plants remains unchanged.
 * - A candidate without a scientific-name guess preserves the raw common
 *   name as the fallback; no stable taxon identity is fabricated from it.
 *
 * `AddPlantFromPhoto` needs no new branching either way, and a
 * photo-created plant's `taxonomyReferenceId` stays null exactly as before
 * whenever identification cannot produce a confident, catalog-matched
 * answer — identification never auto-confirms, unchanged by this pass.
 */

import type { FastifyBaseLogger } from 'fastify';
import type { IdentifyPlantSpecies, PlantPhotoReference } from '../../integrations/public.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { LifecycleStage } from '../domain/plant-lifecycle.js';
import type { TaxonomyReferenceRepository } from './taxonomy-reference-repository.js';

export interface PhotoIdentificationSuggestion {
  readonly suggestedTaxonomyId: Uuid | null;
  readonly confidenceScore: number;
  readonly suggestedCommonName: string | null;
  readonly suggestedScientificName: string | null;
  readonly suggestedVarietyLabel: string | null;
  readonly suggestedLifecycleStage: LifecycleStage | null;
  readonly suggestedAcquisitionDate: string | null;
  readonly identifiedCommonName: string | null;
  readonly identifiedScientificName: string | null;
  readonly identifiedFamilyName: string | null;
  readonly identifiedGenusName: string | null;
  readonly estimatedAgeMonthsMin: number | null;
  readonly estimatedAgeMonthsMax: number | null;
}

const NO_SUGGESTION: PhotoIdentificationSuggestion = {
  suggestedTaxonomyId: null,
  confidenceScore: 0,
  suggestedCommonName: null,
  suggestedScientificName: null,
  suggestedVarietyLabel: null,
  suggestedLifecycleStage: null,
  suggestedAcquisitionDate: null,
  identifiedCommonName: null,
  identifiedScientificName: null,
  identifiedFamilyName: null,
  identifiedGenusName: null,
  estimatedAgeMonthsMin: null,
  estimatedAgeMonthsMax: null,
};

/**
 * `plants-inventory`'s own `LifecycleStage` values, excluding `'planned'` —
 * the model's own response schema (`VertexAiPlantSpeciesIdentificationAdapter`)
 * is separately constrained to never offer it, but this is the boundary
 * where an untyped string from the `integrations` port (kept free of this
 * module's types, see `PlantSpeciesCandidate`'s own doc comment) becomes a
 * real, validated `LifecycleStage` — never trusted without this check.
 */
const PHOTO_LIFECYCLE_STAGE_GUESSES: ReadonlySet<string> = new Set([
  'seed',
  'seedling',
  'transplanted',
  'growing',
  'flowering',
  'fruiting',
  'ready_to_harvest',
]);

function toLifecycleStage(guess: string | null): LifecycleStage | null {
  return guess !== null && PHOTO_LIFECYCLE_STAGE_GUESSES.has(guess)
    ? (guess as LifecycleStage)
    : null;
}

/** The catalog is searched by only the top-1 trigram match — a further, lower-ranked match is never a better guess than the model's own top name candidate. */
const TAXONOMY_MATCH_LIMIT = 1;

export async function identifyPlantFromPhoto(
  identifyPlantSpecies: IdentifyPlantSpecies,
  taxonomyReferences: TaxonomyReferenceRepository,
  photo: PlantPhotoReference,
  logger: FastifyBaseLogger,
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
    if (result.candidate.scientificNameGuess !== null) {
      const providerReference = await taxonomyReferences.resolveProviderSuggestion({
        scientificName: result.candidate.scientificNameGuess,
        commonName: result.candidate.commonName,
        familyName: result.candidate.familyNameGuess ?? '',
        genusName: result.candidate.genusNameGuess ?? '',
      });
      logger.info(
        {
          event: 'plant_species_ai.provider_reference_resolved',
          confidenceScore: result.candidate.confidenceScore,
        },
        'Model candidate resolved to a provider-sourced taxonomy reference.',
      );
      return {
        suggestedTaxonomyId: providerReference.id,
        confidenceScore: result.candidate.confidenceScore,
        suggestedCommonName: null,
        suggestedScientificName: null,
        suggestedVarietyLabel: result.candidate.varietyGuess,
        suggestedLifecycleStage: toLifecycleStage(result.candidate.lifecycleStageGuess),
        suggestedAcquisitionDate: result.candidate.acquisitionDateGuess,
        identifiedCommonName: result.candidate.commonName,
        identifiedScientificName: result.candidate.scientificNameGuess,
        identifiedFamilyName: result.candidate.familyNameGuess,
        identifiedGenusName: result.candidate.genusNameGuess,
        estimatedAgeMonthsMin: result.candidate.estimatedAgeMonthsMin,
        estimatedAgeMonthsMax: result.candidate.estimatedAgeMonthsMax,
      };
    }

    // P11-OBS-01: a real, pre-existing prohibited-content violation found
    // and fixed while instrumenting this pass — `commonName` is content
    // (the model's own guessed plant name text), not a privacy-safe
    // operational signal, and must never appear in a log line
    // (observability-and-analytics.md section 6). `confidenceScore` alone
    // already answers "how confident was the model when the catalog had
    // nothing to match."
    logger.info(
      {
        event: 'plant_species_ai.no_catalog_match',
        confidenceScore: result.candidate.confidenceScore,
      },
      'Model produced a confident candidate with no matching taxonomy catalog entry.',
    );
    return {
      suggestedTaxonomyId: null,
      confidenceScore: result.candidate.confidenceScore,
      suggestedCommonName: result.candidate.commonName,
      suggestedScientificName: result.candidate.scientificNameGuess,
      suggestedVarietyLabel: result.candidate.varietyGuess,
      suggestedLifecycleStage: toLifecycleStage(result.candidate.lifecycleStageGuess),
      suggestedAcquisitionDate: result.candidate.acquisitionDateGuess,
      identifiedCommonName: result.candidate.commonName,
      identifiedScientificName: result.candidate.scientificNameGuess,
      identifiedFamilyName: result.candidate.familyNameGuess,
      identifiedGenusName: result.candidate.genusNameGuess,
      estimatedAgeMonthsMin: result.candidate.estimatedAgeMonthsMin,
      estimatedAgeMonthsMax: result.candidate.estimatedAgeMonthsMax,
    };
  }

  return {
    suggestedTaxonomyId: bestMatch.id,
    confidenceScore: result.candidate.confidenceScore,
    suggestedCommonName: null,
    suggestedScientificName: null,
    suggestedVarietyLabel: result.candidate.varietyGuess,
    suggestedLifecycleStage: toLifecycleStage(result.candidate.lifecycleStageGuess),
    suggestedAcquisitionDate: result.candidate.acquisitionDateGuess,
    identifiedCommonName: result.candidate.commonName,
    identifiedScientificName: result.candidate.scientificNameGuess ?? bestMatch.scientificName,
    identifiedFamilyName: result.candidate.familyNameGuess ?? bestMatch.family,
    identifiedGenusName: result.candidate.genusNameGuess ?? bestMatch.genus,
    estimatedAgeMonthsMin: result.candidate.estimatedAgeMonthsMin,
    estimatedAgeMonthsMax: result.candidate.estimatedAgeMonthsMax,
  };
}
