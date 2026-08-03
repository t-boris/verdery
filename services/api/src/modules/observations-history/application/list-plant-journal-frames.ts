import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { GardenAuthorization } from '../../gardens-mapping/public.js';
import type { ObservationPhotoPurpose } from '../domain/observation-photo.js';
import type { ObservationPhotoRepository } from './observation-photo-repository.js';

/** One frame as the transport shape sees it — timestamps as ISO strings, the same conversion every other resource view in this module performs. */
export interface PlantJournalFrameResource {
  readonly observationId: Uuid;
  readonly mediaId: Uuid;
  readonly observedAt: string;
  readonly purpose: ObservationPhotoPurpose | null;
}

/**
 * A plant's photographs as an ordered sequence for side-by-side and
 * before/after reading (P11-MEDIA-01, comparison sets).
 *
 * NOT A GENERATED TIME-LAPSE. No derivative is produced and no encoder is
 * involved; this returns the photographs that already exist, in the order they
 * were observed, and leaves presentation to the client. That is a deliberate
 * scope decision by the repository owner, recorded here because the
 * implementation plan's surface matrix still names a generated time-lapse and
 * a later reader will otherwise take this for an unfinished version of it.
 *
 * The `limit` is a real bound rather than pagination: a comparison view shows
 * a sequence, and a plant with two thousand photographs wants the sequence
 * thinned, not paged. Thinning belongs to whoever decides what to show and is
 * not invented here.
 *
 * Source: architecture/plant-intelligence-and-visual-journal.md, section 8.2;
 * implementation-plan.md work package P11-MEDIA-01.
 */
export class ListPlantJournalFrames {
  /** Enough for a decade of monthly photographs of one plant; a sequence longer than this is being browsed, not compared. */
  static readonly MAX_FRAMES = 200;

  constructor(
    private readonly photos: ObservationPhotoRepository,
    private readonly authorization: GardenAuthorization,
  ) {}

  async execute(
    gardenId: Uuid,
    plantId: Uuid,
    profileId: Uuid,
    purpose: ObservationPhotoPurpose | null,
    limit: number,
  ): Promise<readonly PlantJournalFrameResource[]> {
    await this.authorization.requireCapability(gardenId, profileId, 'viewGarden');

    const frames = await this.photos.listJournalFramesForPlant(
      plantId,
      purpose,
      Math.min(limit, ListPlantJournalFrames.MAX_FRAMES),
    );

    return frames.map((frame) => ({
      observationId: frame.observationId,
      mediaId: frame.mediaId,
      observedAt: frame.observedAt.toISOString(),
      purpose: frame.purpose,
    }));
  }
}
