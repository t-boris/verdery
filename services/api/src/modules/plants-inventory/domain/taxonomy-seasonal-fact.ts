/**
 * Per-hemisphere seasonal timing facts for a taxon (P9D-SEASON-DATA-01): one
 * row per `(taxonomyReferenceId, hemisphere)` — sowing/transplant/harvest
 * windows genuinely differ by hemisphere, so hemisphere is part of the
 * natural key, not a modifier column.
 *
 * Every timing/duration field is nullable — never fabricate a window a crop
 * does not have. A root vegetable with no transplant stage, or a crop with
 * no known succession benefit, is a fully legitimate row with those fields
 * left `null`.
 *
 * ADR-0013 COMPLIANCE, STRUCTURAL, applied here the same way
 * `RuleReviewMetadata` (tasks-recommendations/domain/rule-definition.ts)
 * applies it to RULE content: two independent, orthogonal provenance axes,
 * each a discriminated union that makes the wrong shape unrepresentable.
 *
 * - `TaxonomySeasonalAuthoring`: HOW the content came to exist.
 *   `sourceCitation` is required exactly when `authoringMethod =
 *   'ai_extracted_from_source'` (ADR-0013's "Permitted: extraction from
 *   licensed source text" — the citation records the licensed source
 *   parsed). `human_authored` and `ai_proposed_reviewed` carry no citation:
 *   an accepted AI proposal becomes the project's OWN authored content per
 *   ADR-0013's "Permitted: proposal into a human review queue", not a
 *   borrowed source.
 * - `TaxonomySeasonalReview`: WHETHER a horticultural reviewer has signed
 *   off. `reviewedBy`/`reviewedOn` are required exactly when `reviewStatus =
 *   'horticulturally_reviewed'` — the identical shape every launch rule's
 *   own `review` field already carries, applied here to data instead of
 *   rule logic. Seed fixtures ship `awaiting_horticultural_review` by
 *   default, the same "ship honestly unreviewed" precedent every launch
 *   rule already sets.
 *
 * `validateTaxonomySeasonalFactProvenance` re-checks both correlations at
 * runtime against an untrusted candidate — defense in depth alongside the
 * migration's own `taxonomy_seasonal_fact_source_citation_linkage_check`/
 * `taxonomy_seasonal_fact_reviewed_linkage_check`/
 * `taxonomy_seasonal_fact_reviewed_on_linkage_check`, mirroring
 * `validateGardenContextFactProvenance`'s identical role one layer up
 * (gardens-mapping/domain/garden-context-fact.ts).
 *
 * No update function and no `CreateTaxonomySeasonalFact` command in this
 * pass: like `taxonomy_reference` itself, every row is seed/fixture
 * content, immutable after insert (see the migration's own "NO `revision`
 * COLUMN, NO UPDATE PATH" note). The validators exist for the seed/fixture
 * authoring path and as the runtime check a later authoring command would
 * reuse, not because a command calls them today.
 *
 * Source: migrations/1787100000000_taxonomy-seasonal-facts-and-bed-history.sql;
 * docs/architecture/decisions/ADR-0013-ai-assisted-care-content-authoring.md;
 * tasks-recommendations/domain/rule-definition.ts, `RuleReviewMetadata`.
 */

import { SharedErrorCode } from '@verdery/api-contracts';
import { ValidationError } from '../../../platform/errors/application-error.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';

/**
 * Same two-value vocabulary `GardenFacts.hemisphere`
 * (tasks-recommendations/domain/garden-facts.ts) carries — kept as an
 * independent literal type per module, not a shared cross-module export,
 * since it is a trivial two-value string union each module already owns its
 * own copy of the same way `TaxonomySource`/`GardenContextSource` are not
 * shared despite both being "provenance" vocabularies.
 */
export type Hemisphere = 'northern' | 'southern';

export const HEMISPHERES: readonly Hemisphere[] = ['northern', 'southern'];

export type TaxonomySeasonalAuthoringMethod =
  'human_authored' | 'ai_extracted_from_source' | 'ai_proposed_reviewed';

export type TaxonomySeasonalReviewStatus =
  'awaiting_horticultural_review' | 'horticulturally_reviewed';

/** All timing/duration fields nullable — see this file's own header. Months are `1`-`12`. */
export interface TaxonomySeasonalTiming {
  readonly sowIndoorsStartMonth: number | null;
  readonly sowIndoorsEndMonth: number | null;
  readonly sowOutdoorsStartMonth: number | null;
  readonly sowOutdoorsEndMonth: number | null;
  readonly transplantStartMonth: number | null;
  readonly transplantEndMonth: number | null;
  readonly harvestStartMonth: number | null;
  readonly harvestEndMonth: number | null;
  readonly daysToMaturityMin: number | null;
  readonly daysToMaturityMax: number | null;
  /** Null = no succession benefit for this crop. */
  readonly successionIntervalDays: number | null;
  /** Null = no known family-conflict rest period. */
  readonly rotationRestSeasons: number | null;
}

/** `sourceCitation` exists exactly when `authoringMethod` is `'ai_extracted_from_source'` — unrepresentable otherwise at the type level. */
export type TaxonomySeasonalAuthoring =
  | { readonly authoringMethod: 'human_authored' | 'ai_proposed_reviewed' }
  | { readonly authoringMethod: 'ai_extracted_from_source'; readonly sourceCitation: string };

/** `reviewedBy`/`reviewedOn` exist exactly when `reviewStatus` is `'horticulturally_reviewed'` — unrepresentable otherwise at the type level. */
export type TaxonomySeasonalReview =
  | { readonly reviewStatus: 'awaiting_horticultural_review' }
  | {
      readonly reviewStatus: 'horticulturally_reviewed';
      readonly reviewedBy: string;
      /** Calendar date of sign-off, `'YYYY-MM-DD'` — mirrors `RuleReviewMetadata.reviewedOn`/`GardenContextFactProvenance.reviewedOn`. */
      readonly reviewedOn: string;
    };

export type TaxonomySeasonalFactProvenance = TaxonomySeasonalAuthoring & TaxonomySeasonalReview;

/**
 * A type alias, not an `interface extends` clause: `TaxonomySeasonalFactProvenance`
 * is an intersection of two discriminated unions, and TypeScript's `extends`
 * clause only accepts object types or intersections of object types with
 * statically known members — the identical constraint
 * `GardenContextFact`'s own combined type already works around the same way
 * (`gardens-mapping/domain/garden-context-fact.ts`).
 */
export type TaxonomySeasonalFact = TaxonomySeasonalTiming &
  TaxonomySeasonalFactProvenance & {
    readonly id: Uuid;
    readonly taxonomyReferenceId: Uuid;
    readonly hemisphere: Hemisphere;
    readonly createdAt: Date;
  };

/** Loosely-typed candidate `validateTaxonomySeasonalAuthoring` narrows — an untrusted seed/fixture row before it is known to be well-formed. */
export interface TaxonomySeasonalAuthoringCandidate {
  readonly authoringMethod: string;
  readonly sourceCitation?: string | null;
}

/** Loosely-typed candidate `validateTaxonomySeasonalReview` narrows. */
export interface TaxonomySeasonalReviewCandidate {
  readonly reviewStatus: string;
  readonly reviewedBy?: string | null;
  readonly reviewedOn?: string | null;
}

export type TaxonomySeasonalFactProvenanceCandidate = TaxonomySeasonalAuthoringCandidate &
  TaxonomySeasonalReviewCandidate;

const CALENDAR_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const AUTHORING_METHODS: readonly TaxonomySeasonalAuthoringMethod[] = [
  'human_authored',
  'ai_extracted_from_source',
  'ai_proposed_reviewed',
];
const REVIEW_STATUSES: readonly TaxonomySeasonalReviewStatus[] = [
  'awaiting_horticultural_review',
  'horticulturally_reviewed',
];

function factInvalid(code: string, message: string, pointer: string): ValidationError {
  return new ValidationError(SharedErrorCode.RequestInvalid, message, {
    details: [{ code, pointer }],
  });
}

function isValidCalendarDate(candidate: string): boolean {
  if (!CALENDAR_DATE_PATTERN.test(candidate)) {
    return false;
  }
  return !Number.isNaN(Date.parse(candidate));
}

/**
 * Validates the `authoringMethod`/`sourceCitation` correlation against an
 * untrusted candidate — the same triple-correlation rule the migration's
 * `taxonomy_seasonal_fact_source_citation_linkage_check` enforces one layer
 * down. Rejects both directions: extraction missing a citation, and a
 * non-extraction method carrying one.
 */
export function validateTaxonomySeasonalAuthoring(
  input: TaxonomySeasonalAuthoringCandidate,
): TaxonomySeasonalAuthoring {
  if (!AUTHORING_METHODS.includes(input.authoringMethod as TaxonomySeasonalAuthoringMethod)) {
    throw factInvalid(
      'plants_inventory.taxonomy_seasonal_fact.authoring_method.invalid',
      `authoringMethod must be one of: ${AUTHORING_METHODS.join(', ')}.`,
      '/authoringMethod',
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
      throw factInvalid(
        'plants_inventory.taxonomy_seasonal_fact.source_citation.required',
        "authoringMethod 'ai_extracted_from_source' requires sourceCitation.",
        '/sourceCitation',
      );
    }
    return { authoringMethod: 'ai_extracted_from_source', sourceCitation };
  }

  if (sourceCitation !== null) {
    throw factInvalid(
      'plants_inventory.taxonomy_seasonal_fact.source_citation.not_allowed',
      `authoringMethod '${input.authoringMethod}' must not carry sourceCitation.`,
      '/sourceCitation',
    );
  }

  return { authoringMethod: input.authoringMethod as 'human_authored' | 'ai_proposed_reviewed' };
}

/**
 * Validates the `reviewStatus`/`reviewedBy`/`reviewedOn` correlation against
 * an untrusted candidate — the same rule the migration's
 * `taxonomy_seasonal_fact_reviewed_linkage_check`/
 * `taxonomy_seasonal_fact_reviewed_on_linkage_check` enforce one layer down,
 * and the identical shape `validateGardenContextFactProvenance`
 * (gardens-mapping/domain/garden-context-fact.ts) already established for
 * this exact pairing pattern.
 */
export function validateTaxonomySeasonalReview(
  input: TaxonomySeasonalReviewCandidate,
): TaxonomySeasonalReview {
  if (!REVIEW_STATUSES.includes(input.reviewStatus as TaxonomySeasonalReviewStatus)) {
    throw factInvalid(
      'plants_inventory.taxonomy_seasonal_fact.review_status.invalid',
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
    throw factInvalid(
      'plants_inventory.taxonomy_seasonal_fact.reviewed_pairing.invalid',
      'reviewedBy and reviewedOn must be supplied together or both omitted.',
      reviewedBy === null ? '/reviewedBy' : '/reviewedOn',
    );
  }

  if (input.reviewStatus === 'horticulturally_reviewed') {
    if (reviewedBy === null || reviewedOn === null) {
      throw factInvalid(
        'plants_inventory.taxonomy_seasonal_fact.reviewed_by.required',
        "reviewStatus 'horticulturally_reviewed' requires both reviewedBy and reviewedOn.",
        '/reviewedBy',
      );
    }
    if (!isValidCalendarDate(reviewedOn)) {
      throw factInvalid(
        'plants_inventory.taxonomy_seasonal_fact.reviewed_on.invalid',
        "reviewedOn must be a calendar date in 'YYYY-MM-DD' form.",
        '/reviewedOn',
      );
    }
    return { reviewStatus: 'horticulturally_reviewed', reviewedBy, reviewedOn };
  }

  if (reviewedBy !== null) {
    throw factInvalid(
      'plants_inventory.taxonomy_seasonal_fact.reviewed_by.not_allowed',
      `reviewStatus '${input.reviewStatus}' must not carry reviewedBy/reviewedOn.`,
      '/reviewedBy',
    );
  }

  return { reviewStatus: 'awaiting_horticultural_review' };
}

/** Validates both provenance axes together — the full shape a seed/fixture row (or a later authoring command) must satisfy. */
export function validateTaxonomySeasonalFactProvenance(
  input: TaxonomySeasonalFactProvenanceCandidate,
): TaxonomySeasonalFactProvenance {
  return {
    ...validateTaxonomySeasonalAuthoring(input),
    ...validateTaxonomySeasonalReview(input),
  };
}
