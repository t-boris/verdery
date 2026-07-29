/**
 * The suitability finding vocabulary design doc section 10 names verbatim:
 * "The result separates blockers, cautions, matches, unknowns, and
 * assumptions. Missing context never becomes a positive match." This module
 * gives that already-named product vocabulary a typed shape — it is new
 * code, but not new naming; nothing here is invented.
 *
 * `axis` is a closed vocabulary drawn from section 10's own evaluation list
 * (hardiness, sun/shade, soil, drainage, mature space, growing context,
 * structural conflict, regulatory/invasive, user preference) — mirrors
 * `RecommendationEvidenceKind`/`RecommendationPriorityFactorKind` being
 * closed string unions rather than free text, the same discipline applied
 * here to a different vocabulary.
 *
 * "Missing context never becomes a positive match" is enforced by
 * CONSTRUCTION, not by convention: `SuitabilityFinding` has no variant that
 * lets `category: 'match'` carry a null/unknown value — a finding is either
 * a real match with a real comparison, or it is `'unknown'`. There is no
 * third option that could accidentally read as positive.
 *
 * Source: architecture/plant-intelligence-and-visual-journal.md, section
 * "10. Suitability Assessment".
 */

import type { Uuid } from '../../../shared/identifiers/uuid.js';

export type SuitabilityAxis =
  | 'hardiness'
  | 'sun_exposure'
  | 'soil_ph'
  | 'drainage'
  | 'mature_space'
  | 'growing_context'
  | 'structural_conflict'
  | 'regulatory_status'
  | 'user_preference';

export const SUITABILITY_AXES: readonly SuitabilityAxis[] = [
  'hardiness',
  'sun_exposure',
  'soil_ph',
  'drainage',
  'mature_space',
  'growing_context',
  'structural_conflict',
  'regulatory_status',
  'user_preference',
];

/** Why an axis could not be evaluated — always distinguishable from a real match, never silently defaulted to one. */
export type SuitabilityUnknownReason =
  'garden_context_missing' | 'plant_fact_missing' | 'placement_missing';

/** One piece of cited support for a finding — a fact key and the value read, with its own provenance already resolved (a garden context fact's source, or a plant profile's winning provider), never re-derived later even if the underlying fact changes. */
export interface SuitabilityEvidence {
  readonly factKey: string;
  readonly value: unknown;
  /** `null` for garden-declared facts with no external citation (e.g. a user-declared sun exposure). */
  readonly sourceCitation: string | null;
}

export type SuitabilityFinding =
  | {
      readonly category: 'match';
      readonly axis: SuitabilityAxis;
      readonly explanation: string;
      readonly evidence: readonly SuitabilityEvidence[];
    }
  | {
      readonly category: 'caution';
      readonly axis: SuitabilityAxis;
      readonly explanation: string;
      readonly evidence: readonly SuitabilityEvidence[];
    }
  | {
      readonly category: 'blocker';
      readonly axis: SuitabilityAxis;
      readonly explanation: string;
      readonly evidence: readonly SuitabilityEvidence[];
    }
  | {
      readonly category: 'unknown';
      readonly axis: SuitabilityAxis;
      readonly reason: SuitabilityUnknownReason;
    }
  | {
      readonly category: 'assumption';
      readonly axis: SuitabilityAxis;
      readonly explanation: string;
      /** What was assumed, in place of the missing fact — e.g. "treated as full sun, the most common requirement, pending a real hardiness source." */
      readonly assumedValue: unknown;
    };

export interface SuitabilityAssessmentResult {
  readonly candidateId: Uuid;
  readonly findings: readonly SuitabilityFinding[];
}

/** Convenience readers over an assembled result — every consumer (persistence, transport, tests) filters by category the same way instead of re-implementing the same `.filter`. */
export function findingsOfCategory<C extends SuitabilityFinding['category']>(
  result: SuitabilityAssessmentResult,
  category: C,
): readonly Extract<SuitabilityFinding, { category: C }>[] {
  return result.findings.filter(
    (finding): finding is Extract<SuitabilityFinding, { category: C }> =>
      finding.category === category,
  );
}
