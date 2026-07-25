/**
 * Versioned rule identity: the immutable `(ruleKey, version)` row a
 * recommendation candidate pins so that "Every recommendation references
 * structured evidence and a rule version" (recommendations-and-ai.md,
 * section 19) is a foreign key, not a convention.
 *
 * Deliberately identity-plus-tier ONLY — section 5's rule contents
 * (eligibility conditions, evidence requirements, time windows, priority
 * inputs, exclusions, action templates, explanation facts, applicability,
 * reviewer metadata) are the rule ENGINE's catalog, owned by P7-RULE-01.
 * `safetyTier` is the one piece of rule metadata the data model itself
 * depends on: `recommendation-candidate.ts` structurally excludes
 * `'restricted'`-tier rules from ever producing a candidate (section 13),
 * so the tier must live on this versioned, immutable identity row.
 *
 * Immutable and append-only: "Rules execute deterministically for the same
 * versioned inputs" (section 5) — changed rule content means a new
 * `(ruleKey, version)` row, never an update, so no update or transition
 * function exists here.
 *
 * Source: migrations/1785600000000_recommendations-baseline.sql,
 * `tasks_recommendations.rule_version`;
 * architecture/recommendations-and-ai.md, sections "5. Rule Engine" and
 * "13. Safety Tiers".
 */

import { SharedErrorCode } from '@verdery/api-contracts';
import { ValidationError } from '../../../platform/errors/application-error.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';

/** Section 13's own three tier headings: "Ordinary Care", "Elevated Risk", "Restricted". */
export type RecommendationSafetyTier = 'ordinary_care' | 'elevated_risk' | 'restricted';

export interface RuleVersion {
  readonly id: Uuid;
  /** Stable rule identity across versions — free text under a non-blank CHECK, not an enumerated set, because the launch rule catalog does not exist yet (P7-RULE-01, gated on horticulture review). */
  readonly ruleKey: string;
  readonly version: number;
  readonly safetyTier: RecommendationSafetyTier;
  readonly createdAt: Date;
}

const MAX_RULE_KEY_LENGTH = 200;

/**
 * Trims and validates a proposed rule key — the same gap
 * `validateTaskTitle` closes for its own required-text column: the
 * migration's CHECK only rejects the empty string, so an all-spaces key
 * would satisfy it while still being useless as an identity.
 */
export function validateRuleKey(rawRuleKey: string): string {
  const ruleKey = rawRuleKey.trim();

  if (ruleKey.length === 0) {
    throw new ValidationError(SharedErrorCode.RequestInvalid, 'ruleKey must not be blank.', {
      details: [{ code: 'tasks_recommendations.rule_version.rule_key.blank', pointer: '/ruleKey' }],
    });
  }

  if (ruleKey.length > MAX_RULE_KEY_LENGTH) {
    throw new ValidationError(
      SharedErrorCode.RequestInvalid,
      `ruleKey must be at most ${String(MAX_RULE_KEY_LENGTH)} characters.`,
      {
        details: [
          { code: 'tasks_recommendations.rule_version.rule_key.too_long', pointer: '/ruleKey' },
        ],
      },
    );
  }

  return ruleKey;
}

/** Mirrors the migration's `rule_version_version_positive_check`, raising a clean `ValidationError` instead of a raw CHECK violation — the same judgment `validateReservedBytes` documents for its own positive-integer column. */
export function validateRuleVersionNumber(rawVersion: number): number {
  if (!Number.isInteger(rawVersion) || rawVersion <= 0) {
    throw new ValidationError(
      SharedErrorCode.RequestInvalid,
      'version must be a positive integer.',
      {
        details: [
          { code: 'tasks_recommendations.rule_version.version.invalid', pointer: '/version' },
        ],
      },
    );
  }

  return rawVersion;
}

export interface CreateRuleVersionInput {
  readonly id: Uuid;
  readonly rawRuleKey: string;
  readonly rawVersion: number;
  readonly safetyTier: RecommendationSafetyTier;
  readonly now: Date;
}

/** Constructs a new, immutable rule-version identity row. Uniqueness of `(ruleKey, version)` is the database's job (`rule_version_rule_key_version_key`), not this pure function's. */
export function createRuleVersion(input: CreateRuleVersionInput): RuleVersion {
  return {
    id: input.id,
    ruleKey: validateRuleKey(input.rawRuleKey),
    version: validateRuleVersionNumber(input.rawVersion),
    safetyTier: input.safetyTier,
    createdAt: input.now,
  };
}
