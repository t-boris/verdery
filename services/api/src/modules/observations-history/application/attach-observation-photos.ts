/**
 * Validates and attaches `photos` (media id plus purpose label) to a just-inserted observation:
 * per entry, confirms the media record exists, inserts one
 * `observation_photo` row, and runs the real `AnalyzeObservationPhoto` pass
 * (ADR-0015) to insert its `image_analysis_result` row — all in the
 * caller's transaction. Shared by `RecordObservation` and
 * `CorrectObservation`, the only two places this module ever writes these
 * two tables.
 */

import { generateUuidV7 } from '../../../shared/identifiers/uuid.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { AnalyzePlantCondition, PlantPhotoReference } from '../../integrations/public.js';
import { createImageAnalysisResult } from '../domain/image-analysis-result.js';
import { createObservationPhoto } from '../domain/observation-photo.js';
import { photoMediaNotAvailableError, photoMediaNotFoundError } from './observation-errors.js';
import type { ObservationPhotoWithAnalysis } from './observation-repository.js';
import type { ObservationsHistoryTransactionContext } from './observations-history-unit-of-work.js';

/** One requested photo attachment: which media, and which of the design doc's purpose labels (§8.2) it fills. `rawPurpose` is validated by `createObservationPhoto` against `OBSERVATION_PHOTO_PURPOSES` — not re-validated here. */
export interface ObservationPhotoAttachmentInput {
  readonly mediaId: Uuid;
  readonly rawPurpose: string;
}

export async function attachObservationPhotos(
  context: ObservationsHistoryTransactionContext,
  analyzePlantCondition: AnalyzePlantCondition,
  gardenId: Uuid,
  observationId: Uuid,
  photoInputs: readonly ObservationPhotoAttachmentInput[],
  now: Date,
): Promise<ObservationPhotoWithAnalysis[]> {
  const photos: ObservationPhotoWithAnalysis[] = [];

  for (const { mediaId, rawPurpose } of photoInputs) {
    // P6-RET-01's attach-side guard — same shape and reasoning as
    // AttachPlantPhoto's own comment on this identical block (garden
    // scoping, availability, and the `FOR SHARE` lock the
    // attach-versus-delete protocol needs).
    const mediaRecord = await context.media.getForShare(mediaId);
    if (mediaRecord === null || mediaRecord.gardenId !== gardenId) {
      throw photoMediaNotFoundError(mediaId);
    }
    if (mediaRecord.uploadState !== 'available') {
      throw photoMediaNotAvailableError(mediaId);
    }

    const photo = createObservationPhoto(generateUuidV7(), observationId, mediaId, rawPurpose, now);
    await context.observationPhotos.insert(photo);

    // `uploadState === 'available'` guarantees both are set — the paired
    // storage-target CHECK constraint media's own migration enforces.
    const photoReference: PlantPhotoReference = {
      bucketName: mediaRecord.bucketName as string,
      objectKey: mediaRecord.objectKey as string,
      mimeType: mediaRecord.verifiedContentType ?? mediaRecord.declaredContentType,
    };
    const analysisResult = await createImageAnalysisResult(
      analyzePlantCondition,
      generateUuidV7(),
      photo.id,
      photoReference,
      now,
    );
    await context.imageAnalysisResults.insert(analysisResult);

    photos.push({ photo, analysisResults: [analysisResult] });
  }

  return photos;
}
