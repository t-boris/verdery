/**
 * Creates a plant candidate whose `displayName`/`taxonomyReferenceId`/
 * `varietyLabel` are prefilled from a photo-identification result, and
 * inserts one `plant_candidate_photo` row in the same transaction.
 *
 * Unlike `AddPlantFromPhoto`, this command applies the suggestion directly
 * to the created candidate — no separate `plant_identification` proposal row,
 * no confirm step, and no `AnalyzePlantCondition` call. A candidate is a
 * lower-stakes, not-yet-real-plant record (see `plant-candidate.ts`'s own
 * header): the confirm ceremony exists specifically to protect a REAL
 * plant's record from a wrong AI guess, and condition/care analysis is
 * meaningless for something not yet planted. A wrong guess here is edited or
 * deleted like any other candidate field.
 *
 * Always creates an `'individual'` candidate — same reasoning
 * `AddPlantFromPhoto` gives for forcing `groupingKind`: identifying a row or
 * group from a single photo is not a meaningful operation this pass.
 */

import type { FastifyBaseLogger } from 'fastify';
import { VISION_ANALYSIS_SOURCE_MAX_BYTES } from '@verdery/api-contracts';
import { pickAnalysisSource } from '../../media/public.js';
import type { IdempotencyStore } from '../../../platform/idempotency/idempotency-store.js';
import { generateUuidV7 } from '../../../shared/identifiers/uuid.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { Clock } from '../../../shared/time/clock.js';
import type { GardenAuthorization } from '../../gardens-mapping/public.js';
import type { IdentifyPlantSpecies, PlantPhotoReference } from '../../integrations/public.js';
import { confidenceBucket } from './add-plant-from-photo.js';
import {
  candidateIdentificationNoMatchError,
  candidateIdentificationSourceNotReadyError,
  candidateMediaNotAvailableForAttachmentError,
  invalidCandidateMediaReferenceError,
} from './candidate-errors.js';
import { toCandidateResource, type CandidateResource } from './candidate-view.js';
import { createCandidate } from '../domain/plant-candidate.js';
import type { CandidatePlacement } from '../domain/plant-candidate.js';
import { createPlantCandidatePhoto } from '../domain/plant-candidate-photo.js';
import { identifyPlantFromPhoto } from './identify-plant-from-photo.js';
import type { PlantsInventoryUnitOfWork } from './plants-inventory-unit-of-work.js';
import { requireCandidatePlacementReferencesGardenObjects } from './require-candidate-placement-in-garden.js';
import { runIdempotentCommand } from './run-idempotent-command.js';
import type { TaxonomyReferenceRepository } from './taxonomy-reference-repository.js';

const OPERATION = 'plants.addCandidateFromPhoto';

export interface AddCandidateFromPhotoInput {
  /** Client-generated id, optional — same reason `AddCandidateInput.candidateId?` is optional. */
  readonly candidateId?: Uuid;
  readonly proposedGardenAreaMapObjectId?: Uuid;
  readonly proposedPlacementMapObjectId?: Uuid;
  readonly photoMediaId: Uuid;
}

function normalizedPlacement(input: AddCandidateFromPhotoInput): CandidatePlacement {
  return {
    proposedGardenAreaMapObjectId: input.proposedGardenAreaMapObjectId ?? null,
    proposedPlacementMapObjectId: input.proposedPlacementMapObjectId ?? null,
  };
}

export class AddCandidateFromPhoto {
  constructor(
    private readonly idempotency: IdempotencyStore,
    private readonly unitOfWork: PlantsInventoryUnitOfWork,
    private readonly authorization: GardenAuthorization,
    private readonly clock: Clock,
    private readonly identifyPlantSpecies: IdentifyPlantSpecies,
    private readonly taxonomyReferences: TaxonomyReferenceRepository,
    private readonly logger: FastifyBaseLogger,
  ) {}

  async execute(
    gardenId: Uuid,
    profileId: Uuid,
    input: AddCandidateFromPhotoInput,
    idempotencyKey: string,
  ): Promise<CandidateResource> {
    await this.authorization.requireCapability(gardenId, profileId, 'editGardenContent');

    const idempotencyInput = {
      actorProfileId: profileId,
      operation: OPERATION,
      idempotencyKey,
      requestFingerprint: JSON.stringify({ gardenId, input }),
    };

    return runIdempotentCommand(
      this.idempotency,
      this.unitOfWork,
      idempotencyInput,
      201,
      async (context) => {
        // Same attach-side guard AddPlantFromPhoto/AttachPlantPhoto apply.
        const media = await context.media.getForShare(input.photoMediaId);
        if (media === null || media.gardenId !== gardenId) {
          throw invalidCandidateMediaReferenceError('/photoMediaId');
        }
        if (media.uploadState !== 'available') {
          throw candidateMediaNotAvailableForAttachmentError('/photoMediaId');
        }

        const now = this.clock.now();
        const placement = normalizedPlacement(input);
        await requireCandidatePlacementReferencesGardenObjects(
          context.mapObjects,
          gardenId,
          placement,
        );

        // The largest stored object that the identification provider will
        // accept: a display derivative when the pipeline has produced one,
        // and the original otherwise — which is the usual state moments after
        // an upload, and is why the size is carried rather than assumed.
        const analysisSource = pickAnalysisSource(
          media,
          await context.media.listDisplayDerivatives(media.id),
          VISION_ANALYSIS_SOURCE_MAX_BYTES,
        );
        // `uploadState === 'available'` (checked above) should guarantee a
        // stored location; refusing rather than asserting keeps a broken row
        // out of the provider call.
        if (analysisSource === null) {
          throw candidateIdentificationSourceNotReadyError();
        }
        const photoReference: PlantPhotoReference = analysisSource;
        const suggestion = await identifyPlantFromPhoto(
          this.identifyPlantSpecies,
          this.taxonomyReferences,
          photoReference,
          this.logger,
        );
        if (suggestion.confidenceScore <= 0) {
          throw candidateIdentificationNoMatchError();
        }

        this.logger.info(
          {
            event: 'plants.candidate_identification_suggested',
            hadCandidate: suggestion.confidenceScore > 0,
            hasCatalogMatch: suggestion.suggestedTaxonomyId !== null,
            confidenceBucket: confidenceBucket(suggestion.confidenceScore),
          },
          'Photo-based species identification produced a suggestion for a new candidate.',
        );

        const matchedReference =
          suggestion.suggestedTaxonomyId !== null
            ? await this.taxonomyReferences.findById(suggestion.suggestedTaxonomyId)
            : null;
        const displayName =
          matchedReference?.commonName ??
          matchedReference?.scientificName ??
          suggestion.suggestedCommonName;

        if (displayName === null) {
          throw candidateIdentificationNoMatchError();
        }

        const candidate = createCandidate(
          input.candidateId ?? generateUuidV7(),
          gardenId,
          placement,
          displayName,
          suggestion.suggestedTaxonomyId,
          suggestion.suggestedVarietyLabel,
          'individual',
          undefined,
          null,
          null,
          { priceAmount: null, priceCurrency: null, purchaseSource: null },
          null,
          profileId,
          now,
        );
        await context.candidates.insert(candidate);

        const photo = createPlantCandidatePhoto(
          generateUuidV7(),
          candidate.id,
          input.photoMediaId,
          true,
          now,
        );
        await context.candidatePhotos.insert(photo);

        // No syncChanges.record call — mirrors AddCandidate's own deferral;
        // see that command's identical comment for the full reasoning.

        return toCandidateResource(candidate);
      },
    );
  }
}
