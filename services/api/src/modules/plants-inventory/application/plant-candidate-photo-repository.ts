import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { PlantCandidatePhoto } from '../domain/plant-candidate-photo.js';

/** Mirrors `PlantPhotoRepository`, narrowed to what a single-photo-per-candidate flow needs: no `clearPrimaryForPlant`/`setPrimary` — see `plant-candidate-photo.ts`'s own header. */
export interface PlantCandidatePhotoRepository {
  /** Every photo attached to this candidate, primary first, then oldest first — mirrors `PlantPhotoRepository.findAllForPlant`'s own ordering. */
  findAllForCandidate(candidateId: Uuid): Promise<PlantCandidatePhoto[]>;

  insert(photo: PlantCandidatePhoto): Promise<void>;

  /** Removes every photo LINK for a candidate. The `media_record` rows themselves are untouched — they keep their own retention lifecycle, which the media module owns. */
  deleteAllForCandidate(candidateId: Uuid): Promise<void>;
}
