/**
 * Placeholder for the not-yet-built photo-identification capability.
 *
 * No real image-analysis or ML service exists yet for plant photos this
 * pass — this always returns "no suggestion, zero confidence" rather than
 * fabricating a plausible-looking guess. `AddPlantFromPhoto` is the only
 * caller; it must not (and does not) treat this as a real identification
 * signal, matching this module's own instruction: "This pass has no real
 * photo-identification service — stub it with a pure, clearly-labeled
 * placeholder function." The honest, always-zero result is what keeps
 * `plant.taxonomyReferenceId` null on a photo-created plant — identification
 * never auto-confirms.
 */

import type { Uuid } from '../../../shared/identifiers/uuid.js';

export interface PhotoIdentificationSuggestion {
  readonly suggestedTaxonomyId: Uuid | null;
  readonly confidenceScore: number;
}

export function identifyPlantFromPhoto(_mediaId: Uuid): PhotoIdentificationSuggestion {
  return { suggestedTaxonomyId: null, confidenceScore: 0 };
}
