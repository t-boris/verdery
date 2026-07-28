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
 * - A confident candidate with NO catalog match (this application's own
 *   catalog is unseeded today, so this is common for any real species) now
 *   PRESERVES the model's raw `commonName`/`scientificNameGuess` instead of
 *   discarding it — the catalog being unseeded is not the model's fault,
 *   and the raw guess is still useful: see `domain/plant.ts`'s
 *   `confirmPlantIdentification`, which uses it to name the plant directly
 *   when there is no taxonomy row to link.
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
}

const NO_SUGGESTION: PhotoIdentificationSuggestion = {
  suggestedTaxonomyId: null,
  confidenceScore: 0,
  suggestedCommonName: null,
  suggestedScientificName: null,
  suggestedVarietyLabel: null,
  suggestedLifecycleStage: null,
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
    logger.info(
      {
        event: 'plant_species_ai.no_catalog_match',
        commonName: result.candidate.commonName,
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
    };
  }

  return {
    suggestedTaxonomyId: bestMatch.id,
    confidenceScore: result.candidate.confidenceScore,
    suggestedCommonName: null,
    suggestedScientificName: null,
    suggestedVarietyLabel: result.candidate.varietyGuess,
    suggestedLifecycleStage: toLifecycleStage(result.candidate.lifecycleStageGuess),
  };
}
