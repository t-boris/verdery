/**
 * Validates and attaches `photos` (media id plus purpose label) to a just-inserted observation:
 * per entry, confirms the media record exists, inserts one
 * `observation_photo` row, and runs the real `AnalyzeObservationPhoto` pass
 * (ADR-0015) to insert its `image_analysis_result` row — all in the
 * caller's transaction. Shared by `RecordObservation` and
 * `CorrectObservation`, the only two places this module ever writes these
 * two tables.
 *
 * When `plantId` is not null (P11-HEALTH-01), each analysis is compared
 * against the plant's own prior analyzed photos — every OTHER observation
 * of the SAME plant's attached photos, oldest first, capped at
 * `MAX_PRIOR_PHOTOS_FOR_ANALYSIS` — resolved once per call (shared across
 * every photo attached in this same call, since they all belong to the
 * same observation and therefore the same "history so far").
 */

import { generateUuidV7 } from '../../../shared/identifiers/uuid.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type {
  AnalyzePlantCondition,
  PlantConditionHistoryEntry,
  PlantPhotoReference,
} from '../../integrations/public.js';
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

/** A bounded history window: enough for the model to judge a real trend without an unbounded multi-image call. */
const MAX_PRIOR_PHOTOS_FOR_ANALYSIS = 5;

/**
 * The condition analyser is given the same kind of reference the species
 * identifier is, size included: every vision provider has a file-size limit,
 * and a request above it fails in a way indistinguishable from "the model saw
 * nothing".
 *
 * No derivative lookup here, unlike the two "from photo" commands: this path
 * analyses a WINDOW of prior photos, and reading each one's derivatives would
 * be a query per photo for a bounded, best-effort call. Prior photos are old
 * enough that their derivatives exist, and that improvement belongs with a
 * batched lookup rather than a loop.
 */
function toPhotoReference(mediaRecord: {
  bucketName: unknown;
  objectKey: unknown;
  verifiedContentType: string | null;
  declaredContentType: string;
  declaredByteSize: number;
  verifiedByteSize: number | null;
}): PlantPhotoReference {
  return {
    bucketName: mediaRecord.bucketName as string,
    objectKey: mediaRecord.objectKey as string,
    mimeType: mediaRecord.verifiedContentType ?? mediaRecord.declaredContentType,
    byteSize: mediaRecord.verifiedByteSize ?? mediaRecord.declaredByteSize,
  };
}

async function resolvePriorPhotos(
  context: ObservationsHistoryTransactionContext,
  plantId: Uuid | null,
  observationId: Uuid,
): Promise<readonly PlantConditionHistoryEntry[]> {
  if (plantId === null) {
    return [];
  }

  const history = await context.observationPhotos.listAnalysisHistoryForPlant(
    plantId,
    observationId,
    MAX_PRIOR_PHOTOS_FOR_ANALYSIS,
  );

  const entries: PlantConditionHistoryEntry[] = [];
  for (const entry of history) {
    // Defensive, not expected: every prior photo was already attached
    // through this same guarded path, so its media record should always
    // still resolve. A media record this module can no longer find or
    // trust is simply left out of the comparison set rather than failing
    // the CURRENT observation's own analysis over a past photo's state.
    const mediaRecord = await context.media.get(entry.mediaId);
    if (mediaRecord === null || mediaRecord.uploadState !== 'available') {
      continue;
    }
    entries.push({
      photo: toPhotoReference(mediaRecord),
      observedAt: entry.observedAt.toISOString(),
    });
  }
  return entries;
}

export async function attachObservationPhotos(
  context: ObservationsHistoryTransactionContext,
  analyzePlantCondition: AnalyzePlantCondition,
  gardenId: Uuid,
  observationId: Uuid,
  plantId: Uuid | null,
  photoInputs: readonly ObservationPhotoAttachmentInput[],
  now: Date,
): Promise<ObservationPhotoWithAnalysis[]> {
  if (photoInputs.length === 0) {
    return [];
  }

  const priorPhotos = await resolvePriorPhotos(context, plantId, observationId);
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
    const photoReference = toPhotoReference(mediaRecord);
    const analysisResult = await createImageAnalysisResult(
      analyzePlantCondition,
      generateUuidV7(),
      photo.id,
      photoReference,
      priorPhotos,
      now,
    );
    await context.imageAnalysisResults.insert(analysisResult);

    photos.push({ photo, analysisResults: [analysisResult] });
  }

  return photos;
}
