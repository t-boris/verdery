import type { FastifyBaseLogger } from 'fastify';

import type {
  AnalyzePlantCondition,
  IdentifyPlantSpecies,
  PlantPhotoReference,
} from '../../integrations/public.js';
import type { CandidatePhotoAnalysis } from '../domain/plant-candidate.js';
import { candidateIdentificationNoMatchError } from './candidate-errors.js';
import { identifyPlantFromPhoto } from './identify-plant-from-photo.js';
import type { TaxonomyReferenceRepository } from './taxonomy-reference-repository.js';

export interface CandidatePhotoAnalysisResult {
  readonly taxonomyReferenceId: string;
  readonly analysis: CandidatePhotoAnalysis;
}

/** Runs both bounded vision passes and preserves their complete structured result. */
export async function analyzeCandidatePhoto(
  identifyPlantSpecies: IdentifyPlantSpecies,
  analyzePlantCondition: AnalyzePlantCondition,
  taxonomyReferences: TaxonomyReferenceRepository,
  photo: PlantPhotoReference,
  logger: FastifyBaseLogger,
  now: Date,
): Promise<CandidatePhotoAnalysisResult> {
  const [identification, conditionResult] = await Promise.all([
    identifyPlantFromPhoto(identifyPlantSpecies, taxonomyReferences, photo, logger),
    analyzePlantCondition.execute({ photo, priorPhotos: [] }),
  ]);

  if (
    identification.suggestedTaxonomyId === null ||
    identification.identifiedCommonName === null ||
    identification.identifiedScientificName === null ||
    identification.identifiedFamilyName === null ||
    identification.identifiedGenusName === null ||
    identification.suggestedLifecycleStage === null ||
    identification.estimatedAgeMonthsMin === null ||
    identification.estimatedAgeMonthsMax === null
  ) {
    throw candidateIdentificationNoMatchError();
  }

  const condition =
    conditionResult.outcome === 'observation'
      ? {
          kind: conditionResult.observation.kind,
          label: conditionResult.observation.suggestedLabel,
          confidenceScore: conditionResult.observation.confidenceScore,
          evidenceSummary: conditionResult.observation.evidenceSummary,
          alternativeExplanations: conditionResult.observation.alternativeExplanations,
          safetyClass: conditionResult.observation.safetyClass,
          requestedAdditionalEvidence: conditionResult.observation.requestedAdditionalEvidence,
          requestedViewPurposes: conditionResult.observation.requestedViewPurposes,
          careGuidance: conditionResult.observation.careGuidanceSuggestion,
        }
      : null;

  return {
    taxonomyReferenceId: identification.suggestedTaxonomyId,
    analysis: {
      commonName: identification.identifiedCommonName,
      scientificName: identification.identifiedScientificName,
      familyName: identification.identifiedFamilyName,
      genusName: identification.identifiedGenusName,
      varietyLabel: identification.suggestedVarietyLabel,
      identificationConfidenceScore: identification.confidenceScore,
      estimatedAgeMonthsMin: identification.estimatedAgeMonthsMin,
      estimatedAgeMonthsMax: identification.estimatedAgeMonthsMax,
      lifecycleStage: identification.suggestedLifecycleStage,
      estimatedAcquisitionDate: identification.suggestedAcquisitionDate,
      condition,
      analyzedAt: now.toISOString(),
    },
  };
}
