/**
 * Read-only lookup for a candidate's latest suitability assessment.
 * Mirrors `get-plant-identification.ts`'s "pending-or-absent read" shape:
 * an honest 404 when nothing has ever been computed, never a fabricated
 * empty assessment — `RecalculateCandidateSuitability` is what a client
 * calls first.
 */

import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { GardenAuthorization } from '../../gardens-mapping/public.js';
import { candidateNotFoundError, candidateSuitabilityNotFoundError } from './candidate-errors.js';
import type { CandidateSuitabilityAssessmentRepository } from './candidate-suitability-assessment-repository.js';
import type { PlantCandidateRepository } from './plant-candidate-repository.js';
import type { SuitabilityAssessmentResult } from '../domain/suitability-finding.js';

export class GetCandidateSuitability {
  constructor(
    private readonly candidates: PlantCandidateRepository,
    private readonly assessments: CandidateSuitabilityAssessmentRepository,
    private readonly authorization: GardenAuthorization,
  ) {}

  async execute(
    gardenId: Uuid,
    candidateId: Uuid,
    profileId: Uuid,
  ): Promise<SuitabilityAssessmentResult> {
    await this.authorization.requireCapability(gardenId, profileId, 'viewGarden');

    const candidate = await this.candidates.findById(candidateId);
    if (candidate === null || candidate.gardenId !== gardenId) {
      throw candidateNotFoundError();
    }

    const assessment = await this.assessments.findLatest(candidateId);
    if (assessment === null) {
      throw candidateSuitabilityNotFoundError();
    }

    return assessment;
  }
}
