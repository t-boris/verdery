/**
 * Maps the domain `PlantPhoto` to the shape `AttachPlantPhoto` and
 * `SetPrimaryPlantPhoto` return — a `toXxxResource(...)`-style view for the
 * photo aggregate, the same convention `toPlantResource` follows for the
 * plant aggregate itself, since neither of those two commands changes
 * `plant` (see `application/plant-revision-journal-writer.ts`'s doc comment).
 */

import type { PlantPhoto } from '../domain/plant-photo.js';

export interface PlantPhotoResource {
  readonly id: string;
  readonly plantId: string;
  readonly mediaId: string;
  readonly isPrimary: boolean;
  readonly createdAt: string;
}

export function toPlantPhotoResource(photo: PlantPhoto): PlantPhotoResource {
  return {
    id: photo.id,
    plantId: photo.plantId,
    mediaId: photo.mediaId,
    isPrimary: photo.isPrimary,
    createdAt: photo.createdAt.toISOString(),
  };
}
