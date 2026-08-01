/** Maps the domain `PlantCandidatePhoto` to the shape `AddCandidateFromPhoto`/`ListCandidatePhotos` return — mirrors `plant-photo-view.ts`'s identical `toPlantPhotoResource` convention. */
import type { PlantCandidatePhoto } from '../domain/plant-candidate-photo.js';

export interface PlantCandidatePhotoResource {
  readonly id: string;
  readonly candidateId: string;
  readonly mediaId: string;
  readonly isPrimary: boolean;
  readonly createdAt: string;
}

export function toPlantCandidatePhotoResource(
  photo: PlantCandidatePhoto,
): PlantCandidatePhotoResource {
  return {
    id: photo.id,
    candidateId: photo.candidateId,
    mediaId: photo.mediaId,
    isPrimary: photo.isPrimary,
    createdAt: photo.createdAt.toISOString(),
  };
}
