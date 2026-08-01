/**
 * A plant candidate's attached photo — mirrors `plant-photo.ts` exactly,
 * retargeted to `plant_candidate`. `AddCandidateFromPhoto` is the only
 * writer today: a candidate never gains a second photo through any command
 * this pass adds.
 *
 * Source: migrations/1788300000000_plant-candidate-photo.sql,
 * `plants_inventory.plant_candidate_photo`.
 */

import type { Uuid } from '../../../shared/identifiers/uuid.js';

export interface PlantCandidatePhoto {
  readonly id: Uuid;
  readonly candidateId: Uuid;
  readonly mediaId: Uuid;
  readonly isPrimary: boolean;
  readonly createdAt: Date;
}

export function createPlantCandidatePhoto(
  id: Uuid,
  candidateId: Uuid,
  mediaId: Uuid,
  isPrimary: boolean,
  now: Date,
): PlantCandidatePhoto {
  return { id, candidateId, mediaId, isPrimary, createdAt: now };
}
