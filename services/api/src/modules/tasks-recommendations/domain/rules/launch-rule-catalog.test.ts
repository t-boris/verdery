/**
 * The launch catalog's own guarantees: safety posture, honest review
 * state, template/evaluator agreement, and the explicit-version content
 * discipline — the pinned hashes below make "changed rule content without
 * a version bump" a CI failure, the in-code half of the registrar's
 * database-side tier check.
 *
 * HASH BOUNDARY, deliberately: the hash covers every DECLARATIVE content
 * field (identity, tier, category, texts, urgency, timing, weather
 * policy, required evidence, template, parameters). It excludes `review`
 * (P7-SAFE-01's sign-off approves content AS IT STANDS — approval must
 * not force a version bump) and the `evaluate` function body (behavior is
 * pinned per version by the fixture suite in `tests/rule-fixtures/`;
 * every tunable the evaluator consults must live in `parameters`, which
 * IS hashed).
 *
 * WHEN THIS TEST FAILS after an intentional content change: ship the
 * change as a NEW version appended to the catalog and add its hash here —
 * never update a shipped version's hash in place.
 */

import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { RuleDefinition } from '../rule-definition.js';
import { listExplanationPlaceholders } from '../rule-explanation.js';
import { createLaunchRuleCatalog } from './launch-rule-catalog.js';

/** JSON with recursively sorted object keys — a canonical, order-independent serialization. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
}

function ruleContentHash(definition: RuleDefinition): string {
  const content = {
    ruleKey: definition.ruleKey,
    version: definition.version,
    safetyTier: definition.safetyTier,
    careCategory: definition.careCategory,
    actionTitle: definition.actionTitle,
    description: definition.description,
    urgency: definition.urgency,
    timing: definition.timing,
    weatherPolicy: definition.weatherPolicy,
    requiredEvidenceKinds: definition.requiredEvidenceKinds,
    explanationTemplate: definition.explanationTemplate,
    parameters: definition.parameters,
  };
  return createHash('sha256').update(canonicalJson(content)).digest('hex');
}

const PINNED_CONTENT_HASHES: Record<string, string> = {
  'watering.dry-spell-check@1': '99a7407134405aae6d90487b03dc7f572c94b158a618602571867e26c14d63cc',
  // v2 decides on accumulated rainfall instead of one latest reading. v1's
  // own hash above is unchanged by that work, which is the guarantee this
  // map exists to give: new content ships as a new version, never as an
  // edit to a shipped one.
  'watering.dry-spell-check@2': 'e6b38b4e6e673c5e0400991eae286535867dddd4f45a3f6e02be6d6dd1f88f56',
  'observation.routine-check-reminder@1':
    '82a6c832311b9704d78d293eb16b93e6331e7a29353b73ffef21f07de4c8d96f',
  'lifecycle.harvest-readiness-check@1':
    '37faefd86a7579b8a777e6824813ccc4e4705660b8fe2e7eeec2cabd493fb3b9',
  'weather.frost-watch@1': '81393cbcad700f43db7d5f140edf3b861a4edb536529a4f2df8d4cecb10fc7a8',
  'seasonal.sowing-window-check@1':
    'f87b787ee5811637d130b73c29473b871c3021795eddda843b1e19b640025324',
  'succession.replanting-reminder@1':
    '5a2045ca6adbc597fdac72071c343456edd1290fc6bf7fc9fb367626a57b4456',
  'rotation.crop-rotation-caution@1':
    'a44565f74c0bec6fb5112c14387aeda0ef18b4b509256892bfdaf00d5c1e8382',
};

/** `awaitingReviewBy` by rule key — the original four launch rules under `P7-SAFE-01`, the three P9D-SEASON-RULES-01 seasonal rules under their own work package (`RuleReviewMetadata`'s widened type). */
const EXPECTED_AWAITING_REVIEW_BY: Record<string, string> = {
  'watering.dry-spell-check': 'P7-SAFE-01',
  'observation.routine-check-reminder': 'P7-SAFE-01',
  'lifecycle.harvest-readiness-check': 'P7-SAFE-01',
  'weather.frost-watch': 'P7-SAFE-01',
  'seasonal.sowing-window-check': 'P9D-SEASON-RULES-01',
  'succession.replanting-reminder': 'P9D-SEASON-RULES-01',
  'rotation.crop-rotation-caution': 'P9D-SEASON-RULES-01',
};

describe('launch rule catalog', () => {
  const catalog = createLaunchRuleCatalog();

  it('ships every version ever released, and evaluates only the highest of each key', () => {
    expect(catalog.allVersions().map((rule) => `${rule.ruleKey}@${String(rule.version)}`)).toEqual([
      'watering.dry-spell-check@1',
      'watering.dry-spell-check@2',
      'observation.routine-check-reminder@1',
      'lifecycle.harvest-readiness-check@1',
      'weather.frost-watch@1',
      'seasonal.sowing-window-check@1',
      'succession.replanting-reminder@1',
      'rotation.crop-rotation-caution@1',
    ]);

    // v1 is retained but superseded: a stored candidate it produced must
    // still be able to render its own explanation, and an evaluation must
    // not run two versions of one rule against the same garden.
    expect(catalog.activeRules().map((rule) => `${rule.ruleKey}@${String(rule.version)}`)).toEqual([
      'watering.dry-spell-check@2',
      'observation.routine-check-reminder@1',
      'lifecycle.harvest-readiness-check@1',
      'weather.frost-watch@1',
      'seasonal.sowing-window-check@1',
      'succession.replanting-reminder@1',
      'rotation.crop-rotation-caution@1',
    ]);
  });

  it('carries only generatable safety tiers — restricted is unrepresentable and absent', () => {
    for (const rule of catalog.allVersions()) {
      expect(['ordinary_care', 'elevated_risk']).toContain(rule.safetyTier);
    }
    expect(
      catalog.allVersions().filter((rule) => rule.safetyTier === 'elevated_risk'),
    ).toHaveLength(1);
  });

  it('marks EVERY launch rule as awaiting horticultural review, each by its own owning work package', () => {
    for (const rule of catalog.allVersions()) {
      expect(rule.review).toEqual({
        reviewStatus: 'awaiting_horticultural_review',
        awaitingReviewBy: EXPECTED_AWAITING_REVIEW_BY[rule.ruleKey],
      });
    }
  });

  it('declares no excluded content category (enforced again by catalog validation)', () => {
    expect(catalog.allVersions().map((rule) => rule.careCategory)).toEqual([
      'watering',
      'watering',
      'observation',
      'harvest',
      'weather_protection',
      'sowing',
      'succession_planting',
      'crop_rotation',
    ]);
  });

  it('pins every shipped version to its content hash — a content change requires a NEW version', () => {
    const actual = Object.fromEntries(
      catalog
        .allVersions()
        .map((rule) => [`${rule.ruleKey}@${String(rule.version)}`, ruleContentHash(rule)]),
    );
    expect(actual).toEqual(PINNED_CONTENT_HASHES);
  });

  it('references at least one explanation fact in every template', () => {
    for (const rule of catalog.allVersions()) {
      expect(
        listExplanationPlaceholders(rule.explanationTemplate).length,
        rule.ruleKey,
      ).toBeGreaterThan(0);
    }
  });

  it('keeps stale-weather posture per tier: labeled use for the ordinary-care rule, skip for the elevated-risk rule', () => {
    const watering = catalog.find('watering.dry-spell-check', 1);
    const frost = catalog.find('weather.frost-watch', 1);
    expect(watering?.weatherPolicy).toEqual({
      use: 'required',
      kind: 'observation',
      whenStale: 'useLabeledStale',
    });
    expect(frost?.weatherPolicy).toEqual({
      use: 'required',
      kind: 'forecast',
      whenStale: 'skip',
    });
  });

  it('states elevated-risk uncertainty in the frost rule’s own template', () => {
    expect(catalog.find('weather.frost-watch', 1)?.explanationTemplate).toContain('may be');
  });
});
