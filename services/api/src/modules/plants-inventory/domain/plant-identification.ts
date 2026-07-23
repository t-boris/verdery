/**
 * A single photo-identification suggestion for a plant: append-only
 * evidence, never edited or superseded in place — "the full suggestion
 * history — including suggestions the user never accepted — is permanently
 * retained here; which one (if any) was accepted lives on `plant.
 * accepted_identification_id`, not as a flag on this table."
 *
 * Source: migrations/1784900000000_plants-observations-tasks-baseline.sql,
 * `plants_inventory.plant_identification`.
 */

import { SharedErrorCode } from '@verdery/api-contracts';
import { ValidationError } from '../../../platform/errors/application-error.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';

export interface PlantIdentification {
  readonly id: Uuid;
  readonly plantId: Uuid;
  readonly plantPhotoId: Uuid;
  /** `null` when the identification pass found no confident candidate. */
  readonly suggestedTaxonomyId: Uuid | null;
  /** Conceptually 0..1, matching `gardens_mapping.garden_object.confidence`'s own documented range, though the migration itself only constrains this column's shape (`numeric(4,3)`), not its range. */
  readonly confidenceScore: number;
  readonly createdAt: Date;
}

export function validateConfidenceScore(rawConfidenceScore: number): number {
  if (!Number.isFinite(rawConfidenceScore) || rawConfidenceScore < 0 || rawConfidenceScore > 1) {
    throw new ValidationError(
      SharedErrorCode.RequestInvalid,
      'confidenceScore must be a number between 0 and 1.',
      {
        details: [
          {
            code: 'plants_inventory.plant_identification.confidence_score.out_of_range',
            pointer: '/confidenceScore',
          },
        ],
      },
    );
  }

  return rawConfidenceScore;
}

export function createPlantIdentification(
  id: Uuid,
  plantId: Uuid,
  plantPhotoId: Uuid,
  suggestedTaxonomyId: Uuid | null,
  rawConfidenceScore: number,
  now: Date,
): PlantIdentification {
  return {
    id,
    plantId,
    plantPhotoId,
    suggestedTaxonomyId,
    confidenceScore: validateConfidenceScore(rawConfidenceScore),
    createdAt: now,
  };
}
