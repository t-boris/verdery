/**
 * A single geographic distribution/regulatory-status claim about a taxon
 * (native, introduced, invasive, or regulated in one region) — anchored to
 * `(providerKey, providerTaxonId)` for the same reason `PlantFactAssertion`
 * is; see that file's own header. Regulatory and invasive status are not
 * ADR-0013's toxicity/edibility exclusion (that list is edibility, toxicity,
 * and chemical-application guidance specifically) — the ordinary extraction-
 * with-review path applies, and `reviewStatus` is what design doc section
 * 3.1's "only from approved reviewed sources" actually rests on here.
 *
 * Source: migrations/1787700000000_plant-taxon-knowledge-profile.sql,
 * `integrations.plant_distribution_assertion`.
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

export type DistributionStatus = 'native' | 'introduced' | 'invasive' | 'regulated';

const DISTRIBUTION_STATUSES: readonly DistributionStatus[] = [
  'native',
  'introduced',
  'invasive',
  'regulated',
];

export type PlantDistributionAssertionProvenance = PlantAssertionAuthoring & PlantAssertionReview;

export interface PlantDistributionAssertion {
  readonly id: Uuid;
  readonly providerTaxonId: string;
  readonly region: string;
  readonly status: DistributionStatus;
  readonly confidence: number | null;
  readonly provenance: PlantDistributionAssertionProvenance;
  readonly fetchedAt: Date | null;
  readonly createdAt: Date;
}

function invalid(message: string, code: string, pointer: string): ValidationError {
  return new ValidationError(SharedErrorCode.RequestInvalid, message, {
    details: [{ code, pointer }],
  });
}

export interface CreatePlantDistributionAssertionInput {
  readonly id: Uuid;
  readonly rawProviderTaxonId: string;
  readonly rawRegion: string;
  readonly rawStatus: string;
  readonly confidence: number | null;
  readonly authoring: PlantAssertionAuthoringCandidate;
  readonly review: PlantAssertionReviewCandidate;
  readonly fetchedAt: Date | null;
  readonly now: Date;
}

export function createPlantDistributionAssertion(
  input: CreatePlantDistributionAssertionInput,
): PlantDistributionAssertion {
  const providerTaxonId = input.rawProviderTaxonId.trim();
  if (providerTaxonId.length === 0) {
    throw invalid(
      'providerTaxonId must not be blank.',
      'integrations.plant_distribution_assertion.provider_taxon_id.blank',
      '/providerTaxonId',
    );
  }

  const region = input.rawRegion.trim();
  if (region.length === 0) {
    throw invalid(
      'region must not be blank.',
      'integrations.plant_distribution_assertion.region.blank',
      '/region',
    );
  }

  if (!DISTRIBUTION_STATUSES.includes(input.rawStatus as DistributionStatus)) {
    throw invalid(
      `status must be one of: ${DISTRIBUTION_STATUSES.join(', ')}.`,
      'integrations.plant_distribution_assertion.status.invalid',
      '/status',
    );
  }

  if (input.confidence !== null && (input.confidence < 0 || input.confidence > 1)) {
    throw invalid(
      'confidence must be between 0 and 1.',
      'integrations.plant_distribution_assertion.confidence.out_of_range',
      '/confidence',
    );
  }

  return {
    id: input.id,
    providerTaxonId,
    region,
    status: input.rawStatus as DistributionStatus,
    confidence: input.confidence,
    provenance: {
      ...validatePlantAssertionAuthoring(input.authoring),
      ...validatePlantAssertionReview(input.review),
    },
    fetchedAt: input.fetchedAt,
    createdAt: input.now,
  };
}
