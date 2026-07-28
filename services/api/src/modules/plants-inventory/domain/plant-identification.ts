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
  /**
   * The AI's own raw name guess, preserved when it was confident but its
   * `commonName` matched no row in the `taxonomy_reference` catalog —
   * `application/identify-plant-from-photo.ts`'s own doc comment covers why
   * this can happen for any real species while the catalog remains
   * unseeded. Mutually exclusive with `suggestedTaxonomyId`: never both
   * non-null. Either the AI's name matched the catalog (id set, these two
   * null), or it didn't (id null, these two carry the AI's own guess), or
   * the AI was not confident/available at all (everything null).
   */
  readonly suggestedCommonName: string | null;
  readonly suggestedScientificName: string | null;
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
  suggestedCommonName: string | null,
  suggestedScientificName: string | null,
  now: Date,
): PlantIdentification {
  return {
    id,
    plantId,
    plantPhotoId,
    suggestedTaxonomyId,
    suggestedCommonName,
    suggestedScientificName,
    confidenceScore: validateConfidenceScore(rawConfidenceScore),
    createdAt: now,
  };
}
