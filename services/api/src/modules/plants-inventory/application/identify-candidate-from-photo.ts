/** Re-runs species identification for an existing candidate's primary photo. */

import { VISION_ANALYSIS_SOURCE_MAX_BYTES } from '@verdery/api-contracts';
import type { FastifyBaseLogger } from 'fastify';

import type { IdempotencyStore } from '../../../platform/idempotency/idempotency-store.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { Clock } from '../../../shared/time/clock.js';
import type { GardenAuthorization } from '../../gardens-mapping/public.js';
import type { IdentifyPlantSpecies } from '../../integrations/public.js';
import { pickAnalysisSource } from '../../media/public.js';
import { updateCandidateDetails } from '../domain/plant-candidate.js';
import { applyCandidateRevisionGuardedUpdate } from './apply-candidate-revision-guarded-update.js';
import {
  candidateIdentificationNoMatchError,
  candidateIdentificationNoPhotoError,
  candidateIdentificationSourceNotReadyError,
  invalidCandidateMediaReferenceError,
} from './candidate-errors.js';
import { toCandidateResource, type CandidateResource } from './candidate-view.js';
import { identifyPlantFromPhoto } from './identify-plant-from-photo.js';
import type { PlantCandidateRepository } from './plant-candidate-repository.js';
import type { PlantsInventoryUnitOfWork } from './plants-inventory-unit-of-work.js';
import { requireCandidateAndAuthorize } from './require-candidate-and-authorize.js';
import { runIdempotentCommand } from './run-idempotent-command.js';
import type { TaxonomyReferenceRepository } from './taxonomy-reference-repository.js';

const OPERATION = 'plants.identifyCandidateFromPhoto';

export class IdentifyCandidateFromPhoto {
  constructor(
    private readonly candidates: PlantCandidateRepository,
    private readonly idempotency: IdempotencyStore,
    private readonly unitOfWork: PlantsInventoryUnitOfWork,
    private readonly authorization: GardenAuthorization,
    private readonly clock: Clock,
    private readonly identifyPlantSpecies: IdentifyPlantSpecies,
    private readonly taxonomyReferences: TaxonomyReferenceRepository,
    private readonly logger: FastifyBaseLogger,
  ) {}

  async execute(
    candidateId: Uuid,
    profileId: Uuid,
    expectedRevision: number,
    idempotencyKey: string,
  ): Promise<CandidateResource> {
    const existing = await requireCandidateAndAuthorize(
      this.candidates,
      this.authorization,
      candidateId,
      profileId,
    );

    const idempotencyInput = {
      actorProfileId: profileId,
      operation: OPERATION,
      idempotencyKey,
      requestFingerprint: JSON.stringify({ candidateId, expectedRevision }),
    };

    return runIdempotentCommand(
      this.idempotency,
      this.unitOfWork,
      idempotencyInput,
      200,
      async (context) => {
        const photos = await context.candidatePhotos.findAllForCandidate(candidateId);
        const photo = photos.find((candidatePhoto) => candidatePhoto.isPrimary) ?? photos[0];
        if (photo === undefined) {
          throw candidateIdentificationNoPhotoError();
        }

        const media = await context.media.getForShare(photo.mediaId);
        if (media === null || media.gardenId !== existing.gardenId) {
          throw invalidCandidateMediaReferenceError('/candidateId');
        }
        const analysisSource = pickAnalysisSource(
          media,
          await context.media.listDisplayDerivatives(media.id),
          VISION_ANALYSIS_SOURCE_MAX_BYTES,
        );
        if (analysisSource === null) {
          throw candidateIdentificationSourceNotReadyError();
        }

        const suggestion = await identifyPlantFromPhoto(
          this.identifyPlantSpecies,
          this.taxonomyReferences,
          analysisSource,
          this.logger,
        );
        if (suggestion.confidenceScore <= 0) {
          throw candidateIdentificationNoMatchError();
        }

        const matchedReference =
          suggestion.suggestedTaxonomyId === null
            ? null
            : await this.taxonomyReferences.findById(suggestion.suggestedTaxonomyId);
        const displayName =
          matchedReference?.commonName ??
          matchedReference?.scientificName ??
          suggestion.suggestedCommonName;
        if (displayName === null) {
          throw candidateIdentificationNoMatchError();
        }

        const updated = await applyCandidateRevisionGuardedUpdate(
          context.candidates,
          candidateId,
          expectedRevision,
          (candidate) =>
            updateCandidateDetails(
              candidate,
              {
                displayName,
                taxonomyReferenceId: suggestion.suggestedTaxonomyId,
                varietyLabel: suggestion.suggestedVarietyLabel,
              },
              this.clock.now(),
            ),
        );

        this.logger.info(
          {
            event: 'plants.candidate_identification_retried',
            hasCatalogMatch: suggestion.suggestedTaxonomyId !== null,
          },
          'Existing candidate identified from its primary photo.',
        );
        return toCandidateResource(updated);
      },
    );
  }
}
