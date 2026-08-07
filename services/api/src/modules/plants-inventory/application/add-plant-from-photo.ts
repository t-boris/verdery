/**
 * Creates a plant whose `displayName` is prefilled from a photo-identification
 * result, and inserts one `plant_photo` and one `plant_identification` row in
 * the same transaction.
 *
 * Always creates an `'individual'` plant: unlike `AddPlant`, this command
 * takes no `groupingKind`/`quantity` — identifying a row or group from a
 * single photo is not a meaningful operation this pass.
 *
 * `plant.taxonomyReferenceId` stays `null` on the created plant no matter
 * what the identification stub returns — identification never
 * auto-confirms; a caller must separately call `ConfirmPlantIdentification`.
 */

import type { FastifyBaseLogger } from 'fastify';
import { VISION_ANALYSIS_SOURCE_MAX_BYTES } from '@verdery/api-contracts';
import { pickAnalysisSource } from '../../media/public.js';
import type { IdempotencyStore } from '../../../platform/idempotency/idempotency-store.js';
import { generateUuidV7 } from '../../../shared/identifiers/uuid.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { Clock } from '../../../shared/time/clock.js';
import type { GardenAuthorization } from '../../gardens-mapping/public.js';
import type {
  AnalyzePlantCondition,
  IdentifyPlantSpecies,
  PlantPhotoReference,
} from '../../integrations/public.js';
import {
  createPlant,
  UNIDENTIFIED_PLANT_DISPLAY_NAME,
  type PlantPlacement,
} from '../domain/plant.js';
import { createPlantIdentification } from '../domain/plant-identification.js';
import { createPlantPhoto } from '../domain/plant-photo.js';
import { identifyPlantFromPhoto } from './identify-plant-from-photo.js';
import {
  invalidMediaReferenceError,
  mediaNotAvailableForAttachmentError,
  plantIdentificationSourceNotReadyError,
} from './plant-errors.js';
import { toPlantResource, type PlantResource } from './plant-view.js';
import type { PlantsInventoryUnitOfWork } from './plants-inventory-unit-of-work.js';
import { requirePlacementReferencesGardenObjects } from './require-plant-placement-in-garden.js';
import { runIdempotentCommand } from './run-idempotent-command.js';
import type { TaxonomyReferenceRepository } from './taxonomy-reference-repository.js';

const OPERATION = 'plants.addPlantFromPhoto';

export interface AddPlantFromPhotoInput {
  /** Client-generated id for the new plant, when supplied — see `AddPlantInput.plantId`'s own doc comment for why this is optional and additive. */
  readonly plantId?: Uuid;
  readonly gardenAreaMapObjectId?: Uuid;
  readonly placementMapObjectId?: Uuid;
  readonly photoMediaId: Uuid;
}

function normalizedPlacement(input: AddPlantFromPhotoInput): PlantPlacement {
  return {
    gardenAreaMapObjectId: input.gardenAreaMapObjectId ?? null,
    placementMapObjectId: input.placementMapObjectId ?? null,
  };
}

/**
 * P11-OBS-01: buckets a continuous `confidenceScore` (`[0, 1]`) into a
 * closed, privacy-safe vocabulary for telemetry — never the raw float,
 * which (unlike a bucket) could in principle be correlated across log
 * lines to fingerprint a specific identification attempt.
 */
export type ConfidenceBucket = 'none' | 'low' | 'medium' | 'high';

/** Exported so `AddCandidateFromPhoto` can log the same closed-vocabulary bucket for its own identification attempt, without duplicating the thresholds. */
export function confidenceBucket(confidenceScore: number): ConfidenceBucket {
  if (confidenceScore <= 0) {
    return 'none';
  }
  if (confidenceScore < 0.5) {
    return 'low';
  }
  if (confidenceScore < 0.8) {
    return 'medium';
  }
  return 'high';
}

export class AddPlantFromPhoto {
  constructor(
    private readonly idempotency: IdempotencyStore,
    private readonly unitOfWork: PlantsInventoryUnitOfWork,
    private readonly authorization: GardenAuthorization,
    private readonly clock: Clock,
    private readonly identifyPlantSpecies: IdentifyPlantSpecies,
    private readonly taxonomyReferences: TaxonomyReferenceRepository,
    private readonly logger: FastifyBaseLogger,
    private readonly analyzePlantCondition: AnalyzePlantCondition,
  ) {}

  async execute(
    gardenId: Uuid,
    profileId: Uuid,
    input: AddPlantFromPhotoInput,
    idempotencyKey: string,
  ): Promise<PlantResource> {
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
        // P6-RET-01's attach-side guard — same shape and reasoning as
        // AttachPlantPhoto's own comment on this identical block.
        const media = await context.media.getForShare(input.photoMediaId);
        if (media === null || media.gardenId !== gardenId) {
          throw invalidMediaReferenceError('/photoMediaId');
        }
        if (media.uploadState !== 'available') {
          throw mediaNotAvailableForAttachmentError('/photoMediaId');
        }

        const now = this.clock.now();
        const placement = normalizedPlacement(input);
        await requirePlacementReferencesGardenObjects(context.mapObjects, gardenId, placement);

        const plant = createPlant(
          input.plantId ?? generateUuidV7(),
          gardenId,
          placement,
          UNIDENTIFIED_PLANT_DISPLAY_NAME,
          // `taxonomyReferenceId` stays null: identification never auto-confirms.
          null,
          null,
          null,
          null,
          'individual',
          undefined,
          profileId,
          now,
        );
        await context.plants.insert(plant);

        const photo = createPlantPhoto(generateUuidV7(), plant.id, input.photoMediaId, true, now);
        await context.plantPhotos.insert(photo);

        // The largest stored object the provider will accept — a display
        // derivative when one exists, the original otherwise. `uploadState
        // === 'available'` (checked above) should guarantee a stored location,
        // the paired storage-target CHECK constraint media's own migration
        // enforces; refusing rather than asserting keeps a broken row out of
        // the provider call.
        const analysisSource = pickAnalysisSource(
          media,
          await context.media.listDisplayDerivatives(media.id),
          VISION_ANALYSIS_SOURCE_MAX_BYTES,
        );
        if (analysisSource === null) {
          throw plantIdentificationSourceNotReadyError();
        }
        const photoReference: PlantPhotoReference = analysisSource;
        const suggestion = await identifyPlantFromPhoto(
          this.identifyPlantSpecies,
          this.taxonomyReferences,
          photoReference,
          this.logger,
        );

        // P11-OBS-01: "identification ambiguity and confirmation outcomes"
        // (plant-intelligence-and-visual-journal.md section 17). There is
        // no real "ambiguous" outcome to distinguish (`identifyPlantFromPhoto`
        // collapses every non-candidate case to one shape) — confidence
        // bucket plus catalog-match are the two real, closed-vocabulary
        // signals this attempt actually produced. Never the plant id, the
        // photo, or any guessed name text.
        this.logger.info(
          {
            event: 'plants.identification_suggested',
            hadCandidate: suggestion.confidenceScore > 0,
            hasCatalogMatch: suggestion.suggestedTaxonomyId !== null,
            confidenceBucket: confidenceBucket(suggestion.confidenceScore),
          },
          'Photo-based species identification produced a suggestion.',
        );
        const condition = await this.analyzePlantCondition.execute({
          photo: photoReference,
          priorPhotos: [],
        });
        const conditionNote =
          condition.outcome === 'observation' ? condition.observation.suggestedLabel : null;
        const careGuidanceNote =
          condition.outcome === 'observation' &&
          condition.observation.careGuidanceSuggestion.length > 0
            ? condition.observation.careGuidanceSuggestion
            : null;

        const identification = createPlantIdentification(
          generateUuidV7(),
          plant.id,
          photo.id,
          suggestion.suggestedTaxonomyId,
          suggestion.confidenceScore,
          suggestion.suggestedCommonName,
          suggestion.suggestedScientificName,
          suggestion.suggestedVarietyLabel,
          suggestion.suggestedLifecycleStage,
          conditionNote,
          careGuidanceNote,
          suggestion.suggestedAcquisitionDate,
          now,
        );
        await context.plantIdentifications.insert(identification);

        await context.revisionJournal.record({
          plantId: plant.id,
          revision: plant.revision,
          commandType: 'addPlantFromPhoto',
          lifecycleStage: plant.lifecycleStage,
          status: plant.status,
          // Full snapshot at creation — see `AddPlant`'s identical comment
          // and `PlantRevisionJournalEntry`'s own doc comment.
          gardenAreaMapObjectId: plant.gardenAreaMapObjectId,
          placementMapObjectId: plant.placementMapObjectId,
          taxonomyReferenceId: plant.taxonomyReferenceId,
          actorProfileId: profileId,
        });
        await context.syncChanges.record({
          gardenId: plant.gardenId,
          recordId: plant.id,
          recordType: 'plant',
          operation: 'upsert',
          recordRevision: plant.revision,
        });

        return toPlantResource(plant);
      },
    );
  }
}
