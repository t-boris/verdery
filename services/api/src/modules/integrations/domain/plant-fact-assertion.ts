/**
 * A single structured fact assertion about a taxon (hardiness, soil, mature
 * size, phenology, and anything else `plant_content_record`'s free-text
 * `careGuidance` cannot express as a queryable value) — the structured
 * counterpart to `PlantContentRecord`, anchored to `(providerKey,
 * providerTaxonId)` for the identical re-identification-protection reason
 * that file's header explains. For a human-authored row, the caller passes
 * the taxon's own `taxonomyReferenceId` (as text) for `providerTaxonId` —
 * there is no live provider mapping to resolve identity through for content
 * this project authored itself (see the migration's own header).
 *
 * ADR-0013's toxicity/edibility exclusion is enforced HERE too, not only by
 * the migration's `plant_fact_assertion_toxicity_edibility_human_only_check`:
 * `createPlantFactAssertion` throws before such a row can even be built if
 * anything other than a human authored it. Two independent layers agreeing
 * is the point — this module's own `plant-content-record.ts` does not need
 * the equivalent because it carries no toxicity/edibility fields at all;
 * this table's `factKey` is open-vocabulary, so the exclusion has to be a
 * runtime check instead of an absent column.
 *
 * Source: migrations/1787700000000_plant-taxon-knowledge-profile.sql,
 * `integrations.plant_fact_assertion`;
 * architecture/decisions/ADR-0013-ai-assisted-care-content-authoring.md.
 */

import { SharedErrorCode } from '@verdery/api-contracts';
import { ValidationError } from '../../../platform/errors/application-error.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type {
  PlantAssertionAuthoring,
  PlantAssertionAuthoringCandidate,
  PlantAssertionReview,
  PlantAssertionReviewCandidate,
} from './plant-assertion-provenance.js';
import {
  validatePlantAssertionAuthoring,
  validatePlantAssertionReview,
} from './plant-assertion-provenance.js';

/** Fact keys ADR-0013 excludes from every AI authoring path, structurally. */
const HUMAN_ONLY_FACT_KEYS = new Set(['toxicity', 'edibility']);

export type PlantFactAssertionProvenance = PlantAssertionAuthoring & PlantAssertionReview;

export interface PlantFactAssertion {
  readonly id: Uuid;
  readonly providerTaxonId: string;
  readonly factKey: string;
  readonly factValue: unknown;
  readonly unit: string | null;
  readonly confidence: number | null;
  /** Null means globally applicable; non-null narrows to a region. */
  readonly geographicScope: string | null;
  readonly provenance: PlantFactAssertionProvenance;
  /** Null for human-authored facts with no provider fetch behind them. */
  readonly fetchedAt: Date | null;
  readonly createdAt: Date;
}

function invalid(message: string, code: string, pointer: string): ValidationError {
  return new ValidationError(SharedErrorCode.RequestInvalid, message, {
    details: [{ code, pointer }],
  });
}

export interface CreatePlantFactAssertionInput {
  readonly id: Uuid;
  readonly rawProviderTaxonId: string;
  readonly rawFactKey: string;
  readonly factValue: unknown;
  readonly unit: string | null;
  readonly confidence: number | null;
  readonly geographicScope: string | null;
  readonly authoring: PlantAssertionAuthoringCandidate;
  readonly review: PlantAssertionReviewCandidate;
  readonly fetchedAt: Date | null;
  readonly now: Date;
}

/**
 * Constructs a fact assertion, enforcing every migration CHECK — including
 * the toxicity/edibility structural exclusion — before the row exists.
 */
export function createPlantFactAssertion(input: CreatePlantFactAssertionInput): PlantFactAssertion {
  const providerTaxonId = input.rawProviderTaxonId.trim();
  if (providerTaxonId.length === 0) {
    throw invalid(
      'providerTaxonId must not be blank.',
      'integrations.plant_fact_assertion.provider_taxon_id.blank',
      '/providerTaxonId',
    );
  }

  const factKey = input.rawFactKey.trim();
  if (factKey.length === 0) {
    throw invalid(
      'factKey must not be blank.',
      'integrations.plant_fact_assertion.fact_key.blank',
      '/factKey',
    );
  }
  if (input.confidence !== null && (input.confidence < 0 || input.confidence > 1)) {
    throw invalid(
      'confidence must be between 0 and 1.',
      'integrations.plant_fact_assertion.confidence.out_of_range',
      '/confidence',
    );
  }

  const authoring = validatePlantAssertionAuthoring(input.authoring);
  if (HUMAN_ONLY_FACT_KEYS.has(factKey) && authoring.authoringMethod !== 'human_authored') {
    throw invalid(
      `'${factKey}' may only be authored by a human — no AI path, including extraction, may populate it.`,
      'integrations.plant_fact_assertion.toxicity_edibility.human_only',
      '/authoring/authoringMethod',
    );
  }

  return {
    id: input.id,
    providerTaxonId,
    factKey,
    factValue: input.factValue,
    unit: input.unit,
    confidence: input.confidence,
    geographicScope: input.geographicScope,
    provenance: { ...authoring, ...validatePlantAssertionReview(input.review) },
    fetchedAt: input.fetchedAt,
    createdAt: input.now,
  };
}
