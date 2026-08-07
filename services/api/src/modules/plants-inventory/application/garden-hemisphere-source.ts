/**
 * Reads which half of the world a garden is in.
 *
 * WHY A PORT RATHER THAN A DIRECT CALL. The derivation already exists —
 * `deriveHemisphere` over the garden's georeference — but it lives in
 * `tasks-recommendations`, and that module already imports this one
 * (`gather-seasonal-facts.ts` consumes `TaxonomySeasonalFactRepository`).
 * Importing it back would close a cycle. A one-method port declared here and
 * satisfied in the composition root keeps the single derivation without
 * copying it and without the cycle.
 *
 * `null` means the garden has no location yet, which is a real and common
 * state, not a failure. Sowing months are meaningless without it: a window
 * is opposite in the two hemispheres, so guessing one would be worse than
 * saying nothing. Callers surface "not known" rather than defaulting.
 */

import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { Hemisphere } from '../domain/taxonomy-seasonal-fact.js';

export interface GardenHemisphereSource {
  /** The garden's hemisphere, or `null` when it has no georeference to derive one from. */
  findHemisphere(gardenId: Uuid): Promise<Hemisphere | null>;
}
