/**
 * Shared provenance validation for `plant_fact_assertion` and
 * `plant_distribution_assertion` — sibling tables in this module with the
 * IDENTICAL `authoringMethod`/`sourceCitation`/`reviewStatus`/`reviewedBy`/
 * `reviewedOn` shape, so this is shared within the module rather than
 * duplicated per table. It is NOT shared across modules: `plants-inventory`'s
 * `taxonomy-seasonal-fact.ts` keeps its own independent copy of the same
 * pattern by deliberate house convention (see that file's own header on
 * `Hemisphere` — "not a shared cross-module export... despite both being
 * provenance vocabularies").
 *
 * Also carries the provider-identity pairing every assertion table in this
 * migration adds beyond `taxonomy_seasonal_fact`'s original shape:
 * human-authored rows use the reserved `provider_key = 'human'` sentinel
 * (no live `plant_taxonomy_mapping` row exists for content this project
 * authored itself) — see the migration's own header.
 *
 * Source: migrations/1787700000000_plant-taxon-knowledge-profile.sql;
 *         architecture/decisions/ADR-0013-ai-assisted-care-content-authoring.md.
 */

import { SharedErrorCode } from '@verdery/api-contracts';
import { ValidationError } from '../../../platform/errors/application-error.js';

export type PlantAssertionAuthoringMethod =
  'human_authored' | 'ai_extracted_from_source' | 'ai_proposed_reviewed';

export type PlantAssertionReviewStatus =
  'awaiting_horticultural_review' | 'horticulturally_reviewed';

/** `sourceCitation` exists exactly when `authoringMethod` is `'ai_extracted_from_source'` — unrepresentable otherwise at the type level. */
export type PlantAssertionAuthoring =
  | {
      readonly authoringMethod: 'human_authored' | 'ai_proposed_reviewed';
      readonly providerKey: string;
    }
  | {
      readonly authoringMethod: 'ai_extracted_from_source';
      readonly sourceCitation: string;
      readonly providerKey: string;
    };

/** `reviewedBy`/`reviewedOn` exist exactly when `reviewStatus` is `'horticulturally_reviewed'` — unrepresentable otherwise at the type level. */
export type PlantAssertionReview =
  | { readonly reviewStatus: 'awaiting_horticultural_review' }
  | {
      readonly reviewStatus: 'horticulturally_reviewed';
      readonly reviewedBy: string;
      readonly reviewedOn: string;
    };

export interface PlantAssertionAuthoringCandidate {
  readonly authoringMethod: string;
  readonly providerKey: string;
  readonly sourceCitation?: string | null;
}

export interface PlantAssertionReviewCandidate {
  readonly reviewStatus: string;
  readonly reviewedBy?: string | null;
  readonly reviewedOn?: string | null;
}

const CALENDAR_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const AUTHORING_METHODS: readonly PlantAssertionAuthoringMethod[] = [
  'human_authored',
  'ai_extracted_from_source',
  'ai_proposed_reviewed',
];
const REVIEW_STATUSES: readonly PlantAssertionReviewStatus[] = [
  'awaiting_horticultural_review',
  'horticulturally_reviewed',
];

function assertionInvalid(code: string, message: string, pointer: string): ValidationError {
  return new ValidationError(SharedErrorCode.RequestInvalid, message, {
    details: [{ code, pointer }],
  });
}

function isValidCalendarDate(candidate: string): boolean {
  return CALENDAR_DATE_PATTERN.test(candidate) && !Number.isNaN(Date.parse(candidate));
}

/** Validates the `authoringMethod`/`providerKey`/`sourceCitation` correlation — mirrors `taxonomy_seasonal_fact_source_citation_linkage_check` plus this migration's own `_human_authored_identity_check`. */
export function validatePlantAssertionAuthoring(
  input: PlantAssertionAuthoringCandidate,
): PlantAssertionAuthoring {
  if (!AUTHORING_METHODS.includes(input.authoringMethod as PlantAssertionAuthoringMethod)) {
    throw assertionInvalid(
      'integrations.plant_assertion.authoring_method.invalid',
      `authoringMethod must be one of: ${AUTHORING_METHODS.join(', ')}.`,
      '/authoringMethod',
    );
  }
  if (input.providerKey.trim().length === 0) {
    throw assertionInvalid(
      'integrations.plant_assertion.provider_key.blank',
      'providerKey must not be blank.',
      '/providerKey',
    );
  }
  if (input.authoringMethod === 'human_authored' && input.providerKey !== 'human') {
    throw assertionInvalid(
      'integrations.plant_assertion.provider_key.human_authored_mismatch',
      "authoringMethod 'human_authored' requires providerKey 'human'.",
      '/providerKey',
    );
  }

  const sourceCitation =
    input.sourceCitation !== undefined &&
    input.sourceCitation !== null &&
    input.sourceCitation.trim().length > 0
      ? input.sourceCitation.trim()
      : null;

  if (input.authoringMethod === 'ai_extracted_from_source') {
    if (sourceCitation === null) {
      throw assertionInvalid(
        'integrations.plant_assertion.source_citation.required',
        "authoringMethod 'ai_extracted_from_source' requires sourceCitation.",
        '/sourceCitation',
      );
    }
    return {
      authoringMethod: 'ai_extracted_from_source',
      sourceCitation,
      providerKey: input.providerKey,
    };
  }

  if (sourceCitation !== null) {
    throw assertionInvalid(
      'integrations.plant_assertion.source_citation.not_allowed',
      `authoringMethod '${input.authoringMethod}' must not carry sourceCitation.`,
      '/sourceCitation',
    );
  }

  return {
    authoringMethod: input.authoringMethod as 'human_authored' | 'ai_proposed_reviewed',
    providerKey: input.providerKey,
  };
}

/** Validates the `reviewStatus`/`reviewedBy`/`reviewedOn` correlation — mirrors `taxonomy_seasonal_fact_reviewed_linkage_check`/`_reviewed_on_linkage_check`. */
export function validatePlantAssertionReview(
  input: PlantAssertionReviewCandidate,
): PlantAssertionReview {
  if (!REVIEW_STATUSES.includes(input.reviewStatus as PlantAssertionReviewStatus)) {
    throw assertionInvalid(
      'integrations.plant_assertion.review_status.invalid',
      `reviewStatus must be one of: ${REVIEW_STATUSES.join(', ')}.`,
      '/reviewStatus',
    );
  }

  const reviewedBy =
    input.reviewedBy !== undefined &&
    input.reviewedBy !== null &&
    input.reviewedBy.trim().length > 0
      ? input.reviewedBy.trim()
      : null;
  const reviewedOn =
    input.reviewedOn !== undefined &&
    input.reviewedOn !== null &&
    input.reviewedOn.trim().length > 0
      ? input.reviewedOn.trim()
      : null;

  if ((reviewedBy === null) !== (reviewedOn === null)) {
    throw assertionInvalid(
      'integrations.plant_assertion.reviewed_pairing.invalid',
      'reviewedBy and reviewedOn must be supplied together or both omitted.',
      reviewedBy === null ? '/reviewedBy' : '/reviewedOn',
    );
  }

  if (input.reviewStatus === 'horticulturally_reviewed') {
    if (reviewedBy === null || reviewedOn === null) {
      throw assertionInvalid(
        'integrations.plant_assertion.reviewed_by.required',
        "reviewStatus 'horticulturally_reviewed' requires both reviewedBy and reviewedOn.",
        '/reviewedBy',
      );
    }
    if (!isValidCalendarDate(reviewedOn)) {
      throw assertionInvalid(
        'integrations.plant_assertion.reviewed_on.invalid',
        "reviewedOn must be a calendar date in 'YYYY-MM-DD' form.",
        '/reviewedOn',
      );
    }
    return { reviewStatus: 'horticulturally_reviewed', reviewedBy, reviewedOn };
  }

  if (reviewedBy !== null) {
    throw assertionInvalid(
      'integrations.plant_assertion.reviewed_by.not_allowed',
      `reviewStatus '${input.reviewStatus}' must not carry reviewedBy/reviewedOn.`,
      '/reviewedBy',
    );
  }

  return { reviewStatus: 'awaiting_horticultural_review' };
}
