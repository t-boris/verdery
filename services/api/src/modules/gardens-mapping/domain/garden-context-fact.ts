/**
 * Garden context facts (P9D-CONTEXT-01): reviewed or declared facts about a
 * garden's physical growing environment — sun exposure, soil type, drainage,
 * irrigation method, growing context (open ground / container /
 * greenhouse), and microclimate — each carrying its own source and quality.
 * FR-22 ("Garden Context"): "The source and quality of each context type
 * must be understood before it influences high-impact guidance."
 *
 * One row per `(gardenId, contextKind)`, update-in-place (current value
 * only, no history) — FR-22 asks that the CURRENT value's source/quality be
 * known, not for a timeline of context changes.
 *
 * `value` is a discriminated union keyed by `contextKind`, so it is typed
 * per kind rather than a bare `string`: four kinds have a fixed vocabulary
 * (`sun_exposure`, `drainage`, `irrigation_method`, `growing_context`);
 * `soil_type` and `microclimate` are free text, the same latitude
 * `bed_details.soil_notes` already takes (see
 * migrations/1784800000000_garden-map-baseline.sql).
 *
 * Wire and domain vocabulary values are the SAME snake_case string at every
 * layer (`'sun_exposure'`, `'full_sun'`, `'horticulturally_reviewed_default'`,
 * ...) — no camelCase translation layer. This deliberately does NOT follow
 * `GardenLifecycleState`'s older `deletion_requested` -> `deletionRequested`
 * precedent (`garden-view.ts`): this codebase's more recent additions
 * (`ClientUpdateState`'s `internal_draft`/`ready_for_client`, `SafetyTier`'s
 * `ordinary_care`/`elevated_risk` in openapi.yaml) already expose snake_case
 * enum values directly over the wire, only camelCasing FIELD names — that is
 * the convention followed here.
 *
 * `source`/`reviewedBy`/`reviewedOn` mirror `RuleReviewMetadata`
 * (tasks-recommendations/domain/rule-definition.ts): a discriminated union
 * makes the well-typed shape unrepresentable when wrong, and
 * `validateGardenContextFactProvenance` below re-checks the same
 * correlation at runtime against an untrusted candidate (defense in depth —
 * the migration's own `garden_context_fact_source_reviewed_linkage_check`/
 * `garden_context_fact_reviewed_on_linkage_check` enforce the identical rule
 * one layer down).
 *
 * Deliberately NOT reusing `garden_object.provenance`/`confidence`: those
 * describe how a MAP SHAPE was captured, a different concept from how a
 * soil/sun FACT was sourced.
 *
 * Source: implementation-plan.md §18.2, work package P9D-CONTEXT-01;
 * technical-specification.md FR-22 ("Garden Context").
 */

import { SharedErrorCode } from '@verdery/api-contracts';
import { ValidationError } from '../../../platform/errors/application-error.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';

export type GardenContextKind =
  | 'sun_exposure'
  | 'soil_type'
  | 'drainage'
  | 'irrigation_method'
  | 'growing_context'
  | 'microclimate';

/** Every `contextKind` this table accepts, matching the migration's own `garden_context_fact_context_kind_check` vocabulary exactly. */
export const GARDEN_CONTEXT_KINDS: readonly GardenContextKind[] = [
  'sun_exposure',
  'soil_type',
  'drainage',
  'irrigation_method',
  'growing_context',
  'microclimate',
];

export type SunExposureValue = 'full_sun' | 'partial_sun' | 'partial_shade' | 'full_shade';
export type DrainageValue = 'well_drained' | 'poor_drainage' | 'waterlogged';
export type IrrigationMethodValue = 'manual' | 'drip' | 'sprinkler' | 'none';
export type GrowingContextValue = 'open_ground' | 'container' | 'greenhouse';

const SUN_EXPOSURE_VALUES: readonly SunExposureValue[] = [
  'full_sun',
  'partial_sun',
  'partial_shade',
  'full_shade',
];
const DRAINAGE_VALUES: readonly DrainageValue[] = ['well_drained', 'poor_drainage', 'waterlogged'];
const IRRIGATION_METHOD_VALUES: readonly IrrigationMethodValue[] = [
  'manual',
  'drip',
  'sprinkler',
  'none',
];
const GROWING_CONTEXT_VALUES: readonly GrowingContextValue[] = [
  'open_ground',
  'container',
  'greenhouse',
];

/** `value`, typed per `contextKind` — the discriminant is `contextKind` itself, not a separate tag. */
export type GardenContextFactValue =
  | { readonly contextKind: 'sun_exposure'; readonly value: SunExposureValue }
  | { readonly contextKind: 'soil_type'; readonly value: string }
  | { readonly contextKind: 'drainage'; readonly value: DrainageValue }
  | { readonly contextKind: 'irrigation_method'; readonly value: IrrigationMethodValue }
  | { readonly contextKind: 'growing_context'; readonly value: GrowingContextValue }
  | { readonly contextKind: 'microclimate'; readonly value: string };

export type GardenContextSource = 'user_declared' | 'horticulturally_reviewed_default' | 'imported';

/** `reviewedBy`/`reviewedOn` exist exactly when `source` is `'horticulturally_reviewed_default'` — unrepresentable otherwise at the type level. */
export type GardenContextFactProvenance =
  | { readonly source: 'user_declared' }
  | { readonly source: 'imported' }
  | {
      readonly source: 'horticulturally_reviewed_default';
      readonly reviewedBy: string;
      /** Calendar date of sign-off, `'YYYY-MM-DD'` — mirrors `RuleReviewMetadata.reviewedOn`. */
      readonly reviewedOn: string;
    };

export type GardenContextFact = GardenContextFactValue &
  GardenContextFactProvenance & {
    readonly id: Uuid;
    readonly gardenId: Uuid;
    /** Who declared/imported this fact — always a real profile, distinct from `reviewedBy`, a human reviewer name/identifier not necessarily tied to an account. */
    readonly recordedByProfileId: Uuid;
    readonly recordedAt: Date;
    readonly revision: number;
    readonly createdAt: Date;
    readonly updatedAt: Date;
  };

/** Loosely-typed candidate `validateGardenContextFactProvenance` narrows — the shape a parsed request body or a persistence row starts as, before it is known to be well-formed. */
export interface GardenContextFactProvenanceCandidate {
  readonly source: string;
  readonly reviewedBy?: string | null;
  readonly reviewedOn?: string | null;
}

const CALENDAR_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function factInvalid(code: string, message: string, pointer: string): ValidationError {
  return new ValidationError(SharedErrorCode.RequestInvalid, message, {
    details: [{ code, pointer }],
  });
}

function requireNonBlankValue(contextKind: GardenContextKind, value: string): void {
  if (value.trim().length === 0) {
    throw factInvalid(
      'gardens_mapping.garden_context_fact.value.blank',
      `Garden context fact value must not be blank for contextKind '${contextKind}'.`,
      '/value',
    );
  }
}

function requireVocabulary<T extends string>(
  contextKind: GardenContextKind,
  value: T,
  allowed: readonly T[],
): void {
  if (!allowed.includes(value)) {
    throw factInvalid(
      'gardens_mapping.garden_context_fact.value.invalid',
      `Garden context fact value '${value}' is not valid for contextKind '${contextKind}'. Allowed: ${allowed.join(', ')}.`,
      '/value',
    );
  }
}

/**
 * Validates `value` against its own `contextKind`'s vocabulary (or, for the
 * two free-text kinds, that it is not blank). Mirrors the DB CHECK the
 * migration's header explains it deliberately does NOT carry for this
 * field — this function is the one place the per-kind vocabulary is
 * actually enforced, at the application layer, defense in depth against
 * `garden_context_fact_value_not_blank_check` alone.
 */
export function validateGardenContextFactValue(
  input: GardenContextFactValue,
): GardenContextFactValue {
  switch (input.contextKind) {
    case 'sun_exposure':
      requireVocabulary(input.contextKind, input.value, SUN_EXPOSURE_VALUES);
      return input;
    case 'drainage':
      requireVocabulary(input.contextKind, input.value, DRAINAGE_VALUES);
      return input;
    case 'irrigation_method':
      requireVocabulary(input.contextKind, input.value, IRRIGATION_METHOD_VALUES);
      return input;
    case 'growing_context':
      requireVocabulary(input.contextKind, input.value, GROWING_CONTEXT_VALUES);
      return input;
    case 'soil_type':
    case 'microclimate':
      requireNonBlankValue(input.contextKind, input.value);
      return input;
  }
}

function isValidCalendarDate(candidate: string): boolean {
  if (!CALENDAR_DATE_PATTERN.test(candidate)) {
    return false;
  }
  return !Number.isNaN(Date.parse(candidate));
}

/**
 * Validates the `source`/`reviewedBy`/`reviewedOn` correlation against an
 * untrusted candidate, narrowing it into `GardenContextFactProvenance` —
 * the SAME triple-correlation rule the migration's
 * `garden_context_fact_source_reviewed_linkage_check`/
 * `garden_context_fact_reviewed_on_linkage_check` enforce one layer down.
 * Rejects BOTH directions: a `horticulturally_reviewed_default` candidate
 * missing either field, and a `user_declared`/`imported` candidate carrying
 * either field.
 */
export function validateGardenContextFactProvenance(
  input: GardenContextFactProvenanceCandidate,
): GardenContextFactProvenance {
  if (
    input.source !== 'user_declared' &&
    input.source !== 'imported' &&
    input.source !== 'horticulturally_reviewed_default'
  ) {
    throw factInvalid(
      'gardens_mapping.garden_context_fact.source.invalid',
      `source must be one of: user_declared, horticulturally_reviewed_default, imported.`,
      '/source',
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
      'gardens_mapping.garden_context_fact.reviewed_pairing.invalid',
      'reviewedBy and reviewedOn must be supplied together or both omitted.',
      reviewedBy === null ? '/reviewedBy' : '/reviewedOn',
    );
  }

  if (input.source === 'horticulturally_reviewed_default') {
    if (reviewedBy === null || reviewedOn === null) {
      throw factInvalid(
        'gardens_mapping.garden_context_fact.reviewed_by.required',
        "source 'horticulturally_reviewed_default' requires both reviewedBy and reviewedOn.",
        '/reviewedBy',
      );
    }
    if (!isValidCalendarDate(reviewedOn)) {
      throw factInvalid(
        'gardens_mapping.garden_context_fact.reviewed_on.invalid',
        "reviewedOn must be a calendar date in 'YYYY-MM-DD' form.",
        '/reviewedOn',
      );
    }
    return { source: 'horticulturally_reviewed_default', reviewedBy, reviewedOn };
  }

  if (reviewedBy !== null) {
    throw factInvalid(
      'gardens_mapping.garden_context_fact.reviewed_by.not_allowed',
      `source '${input.source}' must not carry reviewedBy/reviewedOn.`,
      '/reviewedBy',
    );
  }

  return { source: input.source };
}

/**
 * Input to `RecordGardenContextFact` — everything a caller supplies, before
 * an id/timestamps/revision are assigned. `RecordGardenContextFact` runs
 * both validators above against it before handing it to the repository,
 * which performs the actual create-or-update as a single atomic
 * `INSERT ... ON CONFLICT (garden_id, context_kind) DO UPDATE` — the same
 * "no prior SELECT, one upsert statement" shape
 * `notification-device-commands.ts`'s `registerOrRefresh` already
 * establishes for this codebase's other natural-key upserts, so there is no
 * separate pure "decide insert vs update" domain function here: the
 * database itself decides, atomically, which branch applies.
 */
export type RecordGardenContextFactInput = GardenContextFactValue &
  GardenContextFactProvenanceCandidate;

/** Validates a full `RecordGardenContextFact` input: per-kind value vocabulary and source/reviewedBy/reviewedOn correlation, together. */
export function validateGardenContextFactInput(
  input: RecordGardenContextFactInput,
): GardenContextFactValue & GardenContextFactProvenance {
  const value = validateGardenContextFactValue({
    contextKind: input.contextKind,
    value: input.value,
  } as GardenContextFactValue);
  const provenance = validateGardenContextFactProvenance(input);

  return { ...value, ...provenance };
}
